import type { Guild } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { getDuelArenaService } from '../../services/duelArenaService.js';
import { formatDurationZh } from '../../ui/embeds.js';

export interface WinnerRenameExecutionResult {
  ok: boolean;
  fallback: boolean;
  nickname?: string;
  expiresAt?: number;
  privateText: string;
  publicText?: string;
}

export async function applyWinnerNicknameRename(input: {
  ctx: AppContext;
  guild: Guild | null;
  guildId: string;
  winnerId: string;
  winnerName: string;
  targetId: string;
  rawNickname: string;
  nowMs?: number;
}): Promise<WinnerRenameExecutionResult> {
  const nowMs = input.nowMs ?? Date.now();
  const arena = getDuelArenaService(input.ctx);
  const validation = arena.validateWinnerRename(
    input.guildId,
    input.winnerId,
    input.targetId,
    input.rawNickname,
    nowMs,
  );

  if (!validation.ok) {
    if (validation.reason === 'invalid_nickname') {
      return {
        ok: false,
        fallback: false,
        privateText: '新昵称长度必须在 1 ~ 32 个字符之间。',
      };
    }
    if (validation.reason === 'cooldown') {
      return {
        ok: false,
        fallback: false,
        privateText: `操作太快啦！每 10 秒可改名一次，请 **${validation.retryAfterSec ?? 1}** 秒后再试。`,
      };
    }
    return {
      ok: false,
      fallback: false,
      privateText: '你当前没有针对该成员的有效改名权（可能已过期或已被其他胜者接管）。',
    };
  }

  const newNick = validation.nickname;
  const targetMember = input.guild
    ? await input.guild.members.fetch(input.targetId).catch(() => null)
    : null;
  const isOwner = input.guild?.ownerId === input.targetId;

  if (!isOwner && targetMember) {
    const previousServerNick = targetMember.nickname ?? null;
    try {
      await targetMember.setNickname(newNick, `决斗胜者 ${input.winnerName} 行使限时改名权`);
      arena.commitDiscordRename(
        input.guildId,
        input.targetId,
        previousServerNick,
        newNick,
        nowMs,
      );
      const expUnix = Math.floor(validation.lock.expiresAt / 1000);
      return {
        ok: true,
        fallback: false,
        nickname: newNick,
        expiresAt: validation.lock.expiresAt,
        privateText: `🎭 已将 <@${input.targetId}> 的服务器昵称锁定为 **「${newNick}」**（有效至 <t:${expUnix}:R>，期间内可反复改名）！`,
        publicText: `🎭 **决斗胜者赐名！**<@${input.winnerId}> 行使胜利权利，将败方 <@${input.targetId}> 的服务器昵称改成了 **「${newNick}」**（持续至 <t:${expUnix}:R>）！`,
      };
    } catch {
      // Fall through to fallback card/title lock when Discord hierarchy/50013 blocks nickname edit
    }
  }

  arena.commitFallbackRename(input.guildId, input.targetId, newNick, nowMs);
  const expUnix = Math.floor(validation.lock.expiresAt / 1000);
  return {
    ok: true,
    fallback: true,
    nickname: newNick,
    expiresAt: validation.lock.expiresAt,
    privateText: `🎭 因对方为群主或身份组高于 Bot，无法改其 Discord 昵称；已自动降级为**强制锁定 Bot 名片昵称/称号「${newNick}」并全群挂牌通告**（至 <t:${expUnix}:R>）！`,
    publicText: `📢 **公开挂牌处刑！**败方 <@${input.targetId}> 身份组高于 Bot（或为群主）无法强改服务器昵称，已由胜者 <@${input.winnerId}> 强行锁定 Bot 名片昵称与专属称号为 **「${newNick}」**（持续至 <t:${expUnix}:R>）！`,
  };
}

export async function applyRouletteTimeoutPenalty(input: {
  guild: Guild | null;
  targetId: string;
  timeoutDurationMs: number;
  winnerName: string;
}): Promise<string | null> {
  if (input.timeoutDurationMs <= 0) return null;
  const durationLabel = formatDurationZh(input.timeoutDurationMs);

  const isOwner = input.guild?.ownerId === input.targetId;
  const member = input.guild
    ? await input.guild.members.fetch(input.targetId).catch(() => null)
    : null;

  if (!isOwner && member) {
    try {
      await member.timeout(
        input.timeoutDurationMs,
        `1v1 俄罗斯轮盘败给 ${input.winnerName} 的限时禁言惩罚`,
      );
      return `已对 <@${input.targetId}> 执行 **${durationLabel}** 禁言惩罚！`;
    } catch {
      // Fall through to public shame fallback on 50013 / role hierarchy
    }
  }

  return `⚠️ <@${input.targetId}> 为群主或身份组高于 Bot 无法禁言，已改由系统**全群公开挂牌处刑**（原定禁言 ${durationLabel}）！`;
}
