import { Events, type Client, type Message } from 'discord.js';
import { sendToChannel } from '../interactions/menuHelpers.js';
import {
  stripBotMention,
  type DiscordAttachmentLike,
  type RawContextMessage,
} from '../services/aiService.js';
import type { AppContext } from '../ui/embeds.js';
import { buildWorldBossCard, buildWorldChestCard } from '../ui/worldEventMenuBuilder.js';
import { sendLevelUpNotice, syncLevelRewardRoles } from './ready.js';

function toRawContextMessage(msg: Message): RawContextMessage {
  const hasImages = msg.attachments.some((att) => Boolean(att.contentType?.startsWith('image/')));
  return {
    id: msg.id,
    authorId: msg.author.id,
    authorName: msg.member?.displayName ?? msg.author.displayName ?? msg.author.username,
    isBot: msg.author.bot,
    content: msg.content,
    createdTimestamp: msg.createdTimestamp,
    hasImages,
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

async function collectReplyChain(
  startMessage: Message,
  maxDepth = 10,
): Promise<{ chain: RawContextMessage[]; directRef: Message | null }> {
  const chain: RawContextMessage[] = [];
  let current: Message | null = startMessage;
  let directRef: Message | null = null;

  for (let i = 0; i < maxDepth && current?.reference?.messageId; i++) {
    try {
      const referenced = await current.fetchReference();
      if (i === 0) {
        directRef = referenced;
      }
      chain.unshift(toRawContextMessage(referenced));
      current = referenced;
    } catch {
      break;
    }
  }

  return { chain, directRef };
}

async function handleAiMessage(client: Client, message: Message, ctx: AppContext): Promise<void> {
  if (!message.guild || !message.member) return;
  const botId = client.user?.id;
  if (!botId) return;

  const isMentioned = message.mentions.users.has(botId);
  let replyChain: RawContextMessage[] = [];
  let directRef: Message | null = null;
  if (message.reference?.messageId) {
    const collected = await collectReplyChain(message);
    replyChain = collected.chain;
    directRef = collected.directRef;
  }

  const isReplyToBot = directRef?.author.id === botId;
  const triggered = ctx.services.ai.shouldTrigger({
    guildId: message.guild.id,
    channelId: message.channelId,
    isMentioned,
    isReplyToBot,
  });
  if (!triggered) return;

  if (!ctx.services.ai.isConfigured()) {
    if (isMentioned || isReplyToBot) {
      await message.reply({
        content: '⚠️ AI 功能尚未配置网关密钥，请联系管理员检查 `.env` 中的 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`。',
        allowedMentions: { parse: [], repliedUser: true },
      });
    }
    return;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(message.guild.id);
  const channelWindow: RawContextMessage[] = [];
  if (cfg.ai.contextWindowMessages > 0 && message.channel.isTextBased()) {
    try {
      const fetched = await message.channel.messages.fetch({
        limit: Math.min(30, cfg.ai.contextWindowMessages + 2),
        before: message.id,
      });
      for (const m of fetched.values()) {
        channelWindow.push(toRawContextMessage(m));
      }
    } catch {
      // Missing ReadMessageHistory permission — fall back to reply chain only
    }
  }

  const ownAttachments = toAttachmentLikes(message);
  const refAttachments =
    ownAttachments.length === 0 && directRef ? toAttachmentLikes(directRef) : [];
  const attachments = ownAttachments.length > 0 ? ownAttachments : refAttachments;

  const userContent = stripBotMention(message.content, botId);

  if (message.channel.isSendable()) {
    await message.channel.sendTyping().catch(() => undefined);
  }
  const typingTimer = setInterval(() => {
    if (message.channel.isSendable()) {
      void message.channel.sendTyping().catch(() => undefined);
    }
  }, 8000);

  try {
    const res = await ctx.services.ai.generateReply(
      {
        guildId: message.guild.id,
        channelId: message.channelId,
        userId: message.author.id,
        userName: message.member.displayName,
        messageId: message.id,
        userContent,
        replyChain,
        channelWindow,
        attachments,
      },
      botId,
    );

    if (!res.ok) {
      await message.reply({
        content: `⚠️ ${res.errorMessage}`,
        allowedMentions: { parse: [], repliedUser: true },
      });
      return;
    }

    for (let i = 0; i < res.chunks.length; i++) {
      const chunk = res.chunks[i];
      if (!chunk) continue;
      if (i === 0) {
        await message.reply({
          content: chunk,
          allowedMentions: { parse: [], repliedUser: true },
        });
      } else if (message.channel.isSendable()) {
        await message.channel.send({
          content: chunk,
          allowedMentions: { parse: [] },
        });
      }
    }
  } finally {
    clearInterval(typingTimer);
  }
}

export function registerMessageCreateEvent(client: Client, ctx: AppContext): void {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild || !message.member) {
      return;
    }

    const res = ctx.services.leveling.awardMessageXp(
      message.guild.id,
      message.author.id,
      message.channelId,
    );
    if (res.awarded && res.leveledUp) {
      await syncLevelRewardRoles(message.member, res);
      await sendLevelUpNotice(message.guild, message.channelId, message.member, res, ctx);
    }

    const spawned = ctx.services.worldEvent.tryAutoSpawnOnMessage(
      message.guild.id,
      message.channelId,
    );
    if (spawned) {
      const cfg = ctx.repos.guildConfig.getOrCreate(message.guild.id).economy;
      const payload =
        spawned.eventType === 'chest'
          ? {
              content: `🎁 群聊热闹起来了！天降 **${spawned.name}**，快来抢先开箱！`,
              ...buildWorldChestCard(spawned, [], cfg),
            }
          : {
              content: `👹 警报！世界 Boss **${spawned.name}** 被热闹气氛吸引降临本频道，快来集火讨伐！`,
              ...buildWorldBossCard(spawned, [], cfg),
            };
      const msgId = await sendToChannel(client, spawned.channelId, payload);
      if (msgId) {
        ctx.services.worldEvent.bindWorldEventMessage(spawned.id, msgId);
      } else {
        ctx.repos.worldEvent.saveWorldEvent({ ...spawned, status: 'expired' });
      }
    }

    try {
      await handleAiMessage(client, message, ctx);
    } catch (err) {
      console.error('[ai] 处理对话消息失败:', err);
    }
  });
}
