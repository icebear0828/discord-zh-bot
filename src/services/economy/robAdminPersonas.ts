import {
  DEFAULT_SLOTS_VIP_KEYWORDS,
  ROB_ADMIN_PERSONA_RULES,
  ROB_ADMIN_PERSONA_STORIES,
  type RobAdminPersonaKey,
} from '../../config/economyConstants.js';
import type { RobTargetHints } from './economyTypesAndDates.js';

export function isRobProtectedAdmin(
  targetId: string,
  guildCfg: { adminUserIds: readonly string[] },
  targetHints?: RobTargetHints,
): boolean {
  if (targetHints?.isAdmin) {
    return true;
  }
  return guildCfg.adminUserIds.includes(targetId);
}

function matchesProfileKeywords(
  targetProfile: { equippedTitle: string | null; cardNickname: string | null },
  targetHints: RobTargetHints | undefined,
  keywords: readonly string[],
): boolean {
  const loweredKeywords = keywords
    .map((kw) => kw.trim().toLowerCase())
    .filter((kw) => kw.length > 0);
  if (loweredKeywords.length === 0) return false;

  const candidates: string[] = [];
  if (targetProfile.equippedTitle) candidates.push(targetProfile.equippedTitle);
  if (targetProfile.cardNickname) candidates.push(targetProfile.cardNickname);
  if (targetHints?.displayNames) {
    for (const name of targetHints.displayNames) {
      if (name) candidates.push(name);
    }
  }
  if (targetHints?.roleNames) {
    for (const roleName of targetHints.roleNames) {
      if (roleName) candidates.push(roleName);
    }
  }

  for (const raw of candidates) {
    const normalized = raw.toLowerCase();
    for (const kw of loweredKeywords) {
      if (normalized.includes(kw)) {
        return true;
      }
    }
  }
  return false;
}

export function matchesSlotsVipPlayer(
  playerProfile: { equippedTitle: string | null; cardNickname: string | null },
  playerHints?: RobTargetHints,
  keywords: readonly string[] = DEFAULT_SLOTS_VIP_KEYWORDS,
): boolean {
  return matchesProfileKeywords(playerProfile, playerHints, keywords);
}

export function resolveRobAdminPersona(
  targetProfile: { equippedTitle: string | null; cardNickname: string | null },
  targetHints?: RobTargetHints,
): RobAdminPersonaKey {
  for (const rule of ROB_ADMIN_PERSONA_RULES) {
    if (matchesProfileKeywords(targetProfile, targetHints, rule.keywords)) {
      return rule.key;
    }
  }
  return 'generic';
}

export function renderRobEasterEggStory(
  attackerId: string,
  targetId: string,
  fine: number,
  currencyName: string,
  rng: () => number,
  mode: 'pocket' | 'bank',
  persona: RobAdminPersonaKey,
): string {
  const pool = ROB_ADMIN_PERSONA_STORIES[persona][mode];
  const raw = rng();
  const r = Number.isFinite(raw) ? Math.min(0.999999, Math.max(0, raw)) : 0;
  const idx = Math.min(pool.length - 1, Math.floor(r * pool.length));
  const template = pool[idx]!;
  return template
    .replaceAll('{attacker}', `<@${attackerId}>`)
    .replaceAll('{target}', `<@${targetId}>`)
    .replaceAll('{fine}', `**${fine}**`)
    .replaceAll('{currency}', currencyName);
}
