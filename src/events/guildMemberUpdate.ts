import { Events, type Client, type GuildMember, type PartialGuildMember } from 'discord.js';
import { getDuelArenaService } from '../services/duelArenaService.js';
import type { AppContext } from '../ui/embeds.js';

const REVERT_COOLDOWN_MS = 3_000;
const recentReverts = new Map<string, number>();

export function clearNicknameRevertCooldownForTest(): void {
  recentReverts.clear();
}

export async function handleGuildMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
  ctx: AppContext,
  nowMs = Date.now(),
): Promise<void> {
  if (oldMember.nickname === newMember.nickname) return;

  const lock = getDuelArenaService(ctx).getActiveNicknameLock(
    newMember.guild.id,
    newMember.id,
    nowMs,
  );
  if (!lock || lock.fallbackMode || lock.lockedNickname === null) return;
  if (newMember.nickname === lock.lockedNickname) return;

  const key = `${newMember.guild.id}:${newMember.id}`;
  const lastAt = recentReverts.get(key) ?? 0;
  if (nowMs - lastAt < REVERT_COOLDOWN_MS) return;

  recentReverts.set(key, nowMs);
  await newMember
    .setNickname(lock.lockedNickname, '决斗败方改名锁生效中，自动还原')
    .catch(() => undefined);
}

export function registerGuildMemberUpdateEvent(client: Client, ctx: AppContext): void {
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    void handleGuildMemberUpdate(oldMember, newMember, ctx).catch((err) => {
      console.error('[event:guildMemberUpdate]', err);
    });
  });
}
