import { Events, type Client, type Message } from 'discord.js';
import { sendToChannel } from '../interactions/menuHelpers.js';
import { resolveDiscordUserMentions } from '../services/aiRegex.js';
import {
  stripBotMention,
  type ContextMentionedUser,
  type DiscordAttachmentLike,
  type RawContextMessage,
} from '../services/aiService.js';
import type { AppContext } from '../ui/embeds.js';
import { buildWorldBossCard, buildWorldChestCard } from '../ui/worldEventMenuBuilder.js';
import { sendLevelUpNotice, syncLevelRewardRoles } from './ready.js';

const AI_USER_COOLDOWN_MS = 5_000;
export const AI_CHANNEL_MAX_PENDING = 4;
const AI_QUEUE_TASK_TTL_MS = 300_000;
const AI_MAX_REPLY_CHAIN_DEPTH = 6;
const AI_MAX_USER_INPUT_CHARS = 4_000;

interface QueuedAiTask {
  message: Message;
  ctx: AppContext;
  botId: string;
  guildId: string;
  userDisplayName: string;
  userHandle: string;
  directRef: Message | null;
  userContent: string;
  attachments: DiscordAttachmentLike[];
  enqueuedAt: number;
  resolve: () => void;
}

interface ChannelAiQueueState {
  running: boolean;
  pending: QueuedAiTask[];
}

const userAiCooldowns = new Map<string, number>();
const channelAiQueues = new Map<string, ChannelAiQueueState>();

export function resetAiRuntimeGuards(): void {
  userAiCooldowns.clear();
  for (const state of channelAiQueues.values()) {
    for (const task of state.pending) {
      task.resolve();
    }
    state.pending.length = 0;
  }
  channelAiQueues.clear();
}

function pruneCooldownMap(nowMs: number): void {
  if (userAiCooldowns.size <= 1000) return;
  for (const [key, ts] of userAiCooldowns.entries()) {
    if (nowMs - ts >= AI_USER_COOLDOWN_MS) {
      userAiCooldowns.delete(key);
    }
  }
}

function resolveMessageUserMentionName(msg: Message, userId: string): string | null {
  const fromMentionMember = msg.mentions?.members?.get(userId)?.displayName;
  if (fromMentionMember?.trim()) return fromMentionMember.trim();
  const fromGuildCache = msg.guild?.members?.cache?.get(userId)?.displayName;
  if (fromGuildCache?.trim()) return fromGuildCache.trim();
  const mentionedUser = msg.mentions?.users?.get(userId);
  const fromUser = mentionedUser?.displayName ?? mentionedUser?.username;
  return fromUser?.trim() ? fromUser.trim() : null;
}

function getMessageAuthorName(msg: Message): string {
  return msg.member?.displayName ?? msg.author.displayName ?? msg.author.username;
}

function extractNonBotMentionedUsers(msg: Message, botId: string): ContextMentionedUser[] {
  const users = msg.mentions?.users;
  if (!users || users.size === 0) return [];
  const list: ContextMentionedUser[] = [];
  for (const user of users.values()) {
    if (user.id === botId || user.bot) continue;
    const name =
      resolveMessageUserMentionName(msg, user.id) ?? user.displayName ?? user.username ?? user.id;
    list.push({ id: user.id, name });
  }
  return list;
}

function toRawContextMessage(
  msg: Message,
  botId: string,
  refLookup?: ReadonlyMap<string, Message>,
): RawContextMessage {
  const hasImages = [...msg.attachments.values()].some((att) =>
    Boolean(att.contentType?.startsWith('image/')),
  );
  const content = resolveDiscordUserMentions(msg.content, botId, (userId) =>
    resolveMessageUserMentionName(msg, userId),
  );
  const replyToMessageId = msg.reference?.messageId;
  const replyTarget = replyToMessageId ? refLookup?.get(replyToMessageId) : undefined;
  return {
    id: msg.id,
    authorId: msg.author.id,
    authorName: getMessageAuthorName(msg),
    isBot: msg.author.bot,
    content,
    createdTimestamp: msg.createdTimestamp,
    hasImages,
    hasEmbeds: Array.isArray(msg.embeds) && msg.embeds.length > 0,
    ...(replyToMessageId ? { replyToMessageId } : {}),
    ...(replyTarget
      ? {
          replyToAuthorId: replyTarget.author.id,
          replyToAuthorName: getMessageAuthorName(replyTarget),
        }
      : {}),
    mentionedUsers: extractNonBotMentionedUsers(msg, botId),
  };
}

function toAttachmentLikes(msg: Message): DiscordAttachmentLike[] {
  return [...msg.attachments.values()].map((att) => ({
    url: att.url,
    contentType: att.contentType,
    size: att.size,
    name: att.name,
  }));
}

async function collectDeeperReplyChain(
  directRef: Message,
  botId: string,
  maxDepth = AI_MAX_REPLY_CHAIN_DEPTH,
): Promise<{ chain: RawContextMessage[]; fetchedMessages: Map<string, Message> }> {
  const fetchedMessages = new Map<string, Message>([[directRef.id, directRef]]);
  const orderedMessages: Message[] = [directRef];
  let current: Message | null = directRef;

  for (let i = 1; i < maxDepth && current?.reference?.messageId; i++) {
    try {
      const referenced = await current.fetchReference();
      fetchedMessages.set(referenced.id, referenced);
      orderedMessages.unshift(referenced);
      current = referenced;
    } catch {
      break;
    }
  }

  return {
    chain: orderedMessages.map((m) => toRawContextMessage(m, botId, fetchedMessages)),
    fetchedMessages,
  };
}

async function executeAiTask(task: QueuedAiTask): Promise<void> {
  const { message, ctx, botId, guildId, userDisplayName, userHandle, directRef, userContent, attachments } =
    task;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  if (!cfg.modules.ai) return;

  let typingTimer: NodeJS.Timeout | null = null;
  try {
    // Only fetch deeper reply chain AFTER trigger + guards pass
    const replyData = directRef
      ? await collectDeeperReplyChain(directRef, botId, AI_MAX_REPLY_CHAIN_DEPTH)
      : { chain: [], fetchedMessages: new Map<string, Message>() };
    const replyChain = replyData.chain;

    const channelWindow: RawContextMessage[] = [];
    if (cfg.ai.contextWindowMessages > 0 && message.channel.isTextBased()) {
      try {
        const fetched = await message.channel.messages.fetch({
          limit: Math.min(30, cfg.ai.contextWindowMessages + 2),
          before: message.id,
        });
        const lookup = new Map<string, Message>(replyData.fetchedMessages);
        for (const m of fetched.values()) {
          lookup.set(m.id, m);
        }
        for (const m of fetched.values()) {
          channelWindow.push(toRawContextMessage(m, botId, lookup));
        }
      } catch {
        // Missing ReadMessageHistory permission — fall back to reply chain only
      }
    }

    if (message.channel.isSendable()) {
      await message.channel.sendTyping().catch(() => undefined);
    }
    typingTimer = setInterval(() => {
      if (message.channel.isSendable()) {
        void message.channel.sendTyping().catch(() => undefined);
      }
    }, 8000);

    const mentionedUsers = extractNonBotMentionedUsers(message, botId);
    const res = await ctx.services.ai.generateReply(
      {
        guildId,
        channelId: message.channelId,
        userId: message.author.id,
        userName: userDisplayName,
        userHandle,
        messageId: message.id,
        userContent,
        ...(directRef
          ? {
              replyToAuthorId: directRef.author.id,
              replyToAuthorName: getMessageAuthorName(directRef),
            }
          : {}),
        mentionedUsers,
        replyChain,
        channelWindow,
        attachments,
      },
      botId,
    );

    if (!res.ok) {
      const detailPart = res.errorDetail
        ? ` detail=${res.errorDetail.replace(/\s+/g, ' ').slice(0, 300)}`
        : '';
      console.warn(
        `[ai:error] code=${res.errorCode} user=${userHandle}(${message.author.id}) guild=${guildId} channel=${message.channelId} msg=${res.errorMessage}${detailPart}`,
      );
      await message.reply({
        content: `⚠️ ${res.errorMessage}`,
        allowedMentions: { parse: [], repliedUser: true },
        failIfNotExists: false,
      });
      return;
    }

    console.log(
      `[ai:ok] model=${res.model}${res.fallbackUsed ? ' fallback=true' : ''} user=${userHandle}(${message.author.id}) guild=${guildId} channel=${message.channelId} tokens=${res.usage.promptTokens}+${res.usage.completionTokens}=${res.usage.totalTokens}${res.usage.estimated ? '(est)' : ''} cost=$${res.usage.costUsd.toFixed(6)} latency=${res.usage.latencyMs}ms attempts=${res.attempts}`,
    );

    for (let i = 0; i < res.chunks.length; i++) {
      const chunk = res.chunks[i];
      if (!chunk) continue;
      const chunkAllowedUsers = res.allowedMentionUserIds.filter((id) =>
        chunk.includes(`<@${id}>`),
      );
      if (i === 0) {
        await message.reply({
          content: chunk,
          allowedMentions: { parse: [], users: chunkAllowedUsers, repliedUser: true },
          failIfNotExists: false,
        });
      } else if (message.channel.isSendable()) {
        await message.channel.send({
          content: chunk,
          allowedMentions: { parse: [], users: chunkAllowedUsers },
        });
      }
    }
  } finally {
    if (typingTimer) {
      clearInterval(typingTimer);
    }
  }
}

async function drainChannelAiQueue(channelId: string): Promise<void> {
  const state = channelAiQueues.get(channelId);
  if (!state || state.running) return;
  state.running = true;

  try {
    while (state.pending.length > 0) {
      const task = state.pending.shift();
      if (!task) continue;

      const waitedMs = Date.now() - task.enqueuedAt;
      if (waitedMs > AI_QUEUE_TASK_TTL_MS) {
        console.info(
          `[ai:skip] reason=queue_expired waitedMs=${waitedMs} user=${task.userHandle}(${task.message.author.id}) guild=${task.guildId} channel=${task.message.channelId}`,
        );
        task.resolve();
        continue;
      }

      try {
        await executeAiTask(task);
      } catch (err) {
        console.error('[ai] 处理对话消息失败:', err);
      } finally {
        task.resolve();
      }
    }
  } finally {
    state.running = false;
    const current = channelAiQueues.get(channelId);
    if (current === state && state.pending.length === 0) {
      channelAiQueues.delete(channelId);
    } else if (current === state && state.pending.length > 0) {
      void drainChannelAiQueue(channelId);
    }
  }
}

async function handleAiMessage(client: Client, message: Message, ctx: AppContext): Promise<void> {
  if (!message.guild || !message.member) return;
  const botId = client.user?.id;
  if (!botId) return;

  // Check module & channel filters BEFORE any Discord REST calls
  const cfg = ctx.repos.guildConfig.getOrCreate(message.guild.id);
  if (!cfg.modules.ai) return;
  if (cfg.ai.ignoredChannelIds.includes(message.channelId)) return;
  if (
    cfg.ai.allowedChannelIds.length > 0 &&
    !cfg.ai.allowedChannelIds.includes(message.channelId)
  ) {
    return;
  }

  const isMentioned = message.mentions.users.has(botId);
  const isFreeChat = cfg.ai.freeChatChannelIds.includes(message.channelId);

  // If neither mentioned nor in free-chat channel and not replying to anything, exit with 0 REST calls
  if (!isMentioned && !isFreeChat && !message.reference?.messageId) {
    return;
  }

  // Only fetch 1-level direct reference first to determine whether this is a reply to the Bot
  let directRef: Message | null = null;
  if (message.reference?.messageId) {
    try {
      directRef = await message.fetchReference();
    } catch {
      directRef = null;
    }
  }

  const isReplyToBot = directRef?.author.id === botId;
  const triggered = ctx.services.ai.shouldTrigger({
    guildId: message.guild.id,
    channelId: message.channelId,
    isMentioned,
    isReplyToBot,
  });
  if (!triggered) return;

  const ownAttachments = toAttachmentLikes(message);
  const refAttachments =
    ownAttachments.length === 0 && directRef ? toAttachmentLikes(directRef) : [];
  const attachments = ownAttachments.length > 0 ? ownAttachments : refAttachments;

  const strippedUserContent = stripBotMention(message.content, botId);
  const resolvedUserContent = resolveDiscordUserMentions(strippedUserContent, botId, (userId) =>
    resolveMessageUserMentionName(message, userId),
  );
  if (!resolvedUserContent && attachments.length === 0) {
    // Do not fall back to '你好' on empty messages without attachments
    return;
  }
  const userContent = resolvedUserContent.slice(0, AI_MAX_USER_INPUT_CHARS);

  if (!ctx.services.ai.isConfigured()) {
    if (isMentioned || isReplyToBot) {
      await message.reply({
        content: '⚠️ AI 对话功能暂未配置完成，请联系服务器管理员检查服务设置。',
        allowedMentions: { parse: [], repliedUser: true },
        failIfNotExists: false,
      });
    }
    return;
  }

  // Per-user cooldown & bounded per-channel FIFO queue
  const nowMs = Date.now();
  pruneCooldownMap(nowMs);
  const cooldownKey = `${message.guild.id}:${message.author.id}`;
  const lastTriggeredAt = userAiCooldowns.get(cooldownKey) ?? 0;
  const elapsedMs = nowMs - lastTriggeredAt;
  if (elapsedMs < AI_USER_COOLDOWN_MS) {
    const remainingMs = AI_USER_COOLDOWN_MS - elapsedMs;
    console.info(
      `[ai:skip] reason=cooldown waitMs=${remainingMs} user=${message.author.username}(${message.author.id}) guild=${message.guild.id} channel=${message.channelId}`,
    );
    return;
  }

  let state = channelAiQueues.get(message.channelId);
  if (!state) {
    state = { running: false, pending: [] };
    channelAiQueues.set(message.channelId, state);
  }
  if (state.running && state.pending.length >= AI_CHANNEL_MAX_PENDING) {
    console.info(
      `[ai:skip] reason=queue_full pending=${state.pending.length} user=${message.author.username}(${message.author.id}) guild=${message.guild.id} channel=${message.channelId}`,
    );
    return;
  }

  userAiCooldowns.set(cooldownKey, nowMs);

  let resolveTask!: () => void;
  const donePromise = new Promise<void>((resolve) => {
    resolveTask = resolve;
  });

  state.pending.push({
    message,
    ctx,
    botId,
    guildId: message.guild.id,
    userDisplayName: message.member.displayName,
    userHandle: message.author.username,
    directRef,
    userContent,
    attachments,
    enqueuedAt: nowMs,
    resolve: resolveTask,
  });

  if (state.running) {
    console.info(
      `[ai:queue] pos=${state.pending.length} user=${message.author.username}(${message.author.id}) guild=${message.guild.id} channel=${message.channelId}`,
    );
  } else {
    void drainChannelAiQueue(message.channelId);
  }

  await donePromise;
}

export async function handleMessageCreate(
  client: Client,
  message: Message,
  ctx: AppContext,
): Promise<void> {
  if (message.author.bot || !message.guild || !message.member) {
    return;
  }

  // 1. Leveling XP (isolated)
  try {
    const res = ctx.services.leveling.awardMessageXp(
      message.guild.id,
      message.author.id,
      message.channelId,
    );
    if (res.awarded && res.leveledUp) {
      await syncLevelRewardRoles(message.member, res);
      await sendLevelUpNotice(message.guild, message.channelId, message.member, res, ctx);
    }
  } catch (err) {
    console.error('[leveling] 处理消息经验失败:', err);
  }

  // 2. World Event auto-spawn (isolated; checks both worldEvents & economy, skips tickets & ignored channels)
  try {
    const cfg = ctx.repos.guildConfig.getOrCreate(message.guild.id);
    const isTicketChannel = Boolean(ctx.repos.ticket.getByChannel(message.channelId));
    const isIgnoredChannel = cfg.leveling.ignoredChannelIds.includes(message.channelId);

    if (
      cfg.modules.worldEvents &&
      cfg.modules.economy &&
      !isTicketChannel &&
      !isIgnoredChannel
    ) {
      const spawned = ctx.services.worldEvent.tryAutoSpawnOnMessage(
        message.guild.id,
        message.channelId,
      );
      if (spawned) {
        const payload =
          spawned.eventType === 'chest'
            ? {
                content: `🎁 群聊热闹起来了！天降 **${spawned.name}**，快来抢先开箱！`,
                ...buildWorldChestCard(spawned, [], cfg.economy),
              }
            : {
                content: `👹 警报！世界 Boss **${spawned.name}** 被热闹气氛吸引降临本频道，快来集火讨伐！`,
                ...buildWorldBossCard(spawned, [], cfg.economy),
              };
        const msgId = await sendToChannel(client, spawned.channelId, payload);
        if (msgId) {
          ctx.services.worldEvent.bindWorldEventMessage(spawned.id, msgId);
        } else {
          ctx.repos.worldEvent.saveWorldEvent({ ...spawned, status: 'expired' });
        }
      }
    }
  } catch (err) {
    console.error('[worldEvent] 自动触发世界事件失败:', err);
  }

  // 3. AI chat (isolated)
  try {
    await handleAiMessage(client, message, ctx);
  } catch (err) {
    console.error('[ai] 处理对话消息失败:', err);
  }
}

export function registerMessageCreateEvent(client: Client, ctx: AppContext): void {
  client.on(Events.MessageCreate, async (message) => {
    await handleMessageCreate(client, message, ctx);
  });
}
