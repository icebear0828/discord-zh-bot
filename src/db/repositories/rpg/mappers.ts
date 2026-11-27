import { parseAffixesJson, parseLegendaryEffect } from '../../../services/rpgAffixes.js';
import type {
  RpgCharacter,
  RpgCharacterSqlRow,
  RpgClassKey,
  RpgDuel,
  RpgDuelSqlRow,
  RpgItem,
  RpgItemRarity,
  RpgItemSlot,
  RpgItemSqlRow,
  RpgRaid,
  RpgRaidDroppedItem,
  RpgRaidPayout,
  RpgRaidSqlRow,
  RpgTrial,
  RpgTrialSqlRow,
} from './types.js';

const VALID_CLASS_KEYS: ReadonlySet<string> = new Set<RpgClassKey>([
  'warrior',
  'mage',
  'ranger',
  'paladin',
]);

const VALID_RARITIES: ReadonlySet<string> = new Set<RpgItemRarity>([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
]);

const VALID_SLOTS: ReadonlySet<string> = new Set<RpgItemSlot>(['weapon', 'armor', 'accessory']);

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function parseRaidPayouts(raw: string | null | undefined): RpgRaidPayout[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RpgRaidPayout[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.userId !== 'string') continue;
      const classKey: RpgClassKey =
        typeof rec.classKey === 'string' && VALID_CLASS_KEYS.has(rec.classKey)
          ? (rec.classKey as RpgClassKey)
          : 'warrior';
      const itemsDropped: RpgRaidDroppedItem[] = [];
      if (Array.isArray(rec.itemsDropped)) {
        for (const rawItem of rec.itemsDropped) {
          if (typeof rawItem !== 'object' || rawItem === null) continue;
          const itemRec = rawItem as Record<string, unknown>;
          if (
            typeof itemRec.id === 'number' &&
            typeof itemRec.name === 'string' &&
            typeof itemRec.rarity === 'string' &&
            VALID_RARITIES.has(itemRec.rarity) &&
            typeof itemRec.slot === 'string' &&
            VALID_SLOTS.has(itemRec.slot)
          ) {
            itemsDropped.push({
              id: itemRec.id,
              name: itemRec.name,
              rarity: itemRec.rarity as RpgItemRarity,
              slot: itemRec.slot as RpgItemSlot,
            });
          }
        }
      }
      out.push({
        userId: rec.userId,
        name: typeof rec.name === 'string' ? rec.name : rec.userId,
        classKey,
        level:
          typeof rec.level === 'number' && Number.isFinite(rec.level) ? Math.floor(rec.level) : 1,
        isLeader: Boolean(rec.isLeader),
        isMercenary: Boolean(rec.isMercenary),
        isMvp: Boolean(rec.isMvp),
        damageDealt:
          typeof rec.damageDealt === 'number' && Number.isFinite(rec.damageDealt)
            ? Math.floor(rec.damageDealt)
            : 0,
        damageTaken:
          typeof rec.damageTaken === 'number' && Number.isFinite(rec.damageTaken)
            ? Math.floor(rec.damageTaken)
            : 0,
        grossCoins:
          typeof rec.grossCoins === 'number' && Number.isFinite(rec.grossCoins)
            ? Math.floor(rec.grossCoins)
            : 0,
        garnishedCoins:
          typeof rec.garnishedCoins === 'number' && Number.isFinite(rec.garnishedCoins)
            ? Math.floor(rec.garnishedCoins)
            : 0,
        netCoins:
          typeof rec.netCoins === 'number' && Number.isFinite(rec.netCoins)
            ? Math.floor(rec.netCoins)
            : 0,
        dustEarned:
          typeof rec.dustEarned === 'number' && Number.isFinite(rec.dustEarned)
            ? Math.floor(rec.dustEarned)
            : 0,
        xpEarned:
          typeof rec.xpEarned === 'number' && Number.isFinite(rec.xpEarned)
            ? Math.floor(rec.xpEarned)
            : 0,
        itemsDropped,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function mapCharacter(row: RpgCharacterSqlRow): RpgCharacter {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    classKey: row.class_key,
    classSelected: (row.class_selected ?? 0) === 1,
    level: row.level,
    xp: row.xp,
    stamina: row.stamina,
    lastStaminaDate: row.last_stamina_date,
    staminaBuysToday: row.stamina_buys_today,
    maxChapterCleared: row.max_chapter_cleared,
    totalClears: row.total_clears,
    totalBossKills: row.total_boss_kills,
    lastIdleClaimAt: row.last_idle_claim_at ?? 0,
    injuredUntil: row.injured_until ?? 0,
    breakthroughPity: row.breakthrough_pity ?? 0,
    totalBreakthroughs: row.total_breakthroughs ?? 0,
    promoPills: row.promo_pills ?? 0,
    guardElixirs: row.guard_elixirs ?? 0,
    pillBuysToday: row.pill_buys_today ?? 0,
    elixirBuysToday: row.elixir_buys_today ?? 0,
    trialPillsStaged: row.trial_pills_staged ?? 0,
    trialUseGuard: (row.trial_use_guard ?? 0) === 1,
    arcaneDust: row.arcane_dust ?? 0,
    dustBackfilled: (row.dust_backfilled ?? 0) === 1,
    abyssClearedTier: row.abyss_cleared_tier ?? 0,
    arenaRating: row.arena_rating ?? 1000,
    arenaFightsToday: row.arena_fights_today ?? 0,
    arenaRewardDate: row.arena_reward_date ?? null,
    coopTicketsToday: row.coop_tickets_today ?? 0,
    updatedAt: row.updated_at,
  };
}

export function mapItem(row: RpgItemSqlRow): RpgItem {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    name: row.name,
    slot: row.slot,
    rarity: row.rarity,
    baseHp: row.base_hp,
    baseAtk: row.base_atk,
    baseDef: row.base_def,
    baseCritBp: row.base_crit_bp,
    enhanceLevel: row.enhance_level,
    equipped: row.equipped === 1,
    affixes: parseAffixesJson(row.affixes_json),
    legendaryEffect: parseLegendaryEffect(row.legendary_effect),
    locked: (row.locked ?? 0) === 1,
    affixesAwakened: (row.affixes_awakened ?? 0) === 1,
    createdAt: row.created_at,
  };
}

export function mapTrial(row: RpgTrialSqlRow): RpgTrial {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    userId: row.user_id,
    fromLevel: row.from_level,
    targetTier: row.target_tier,
    pillsUsed: row.pills_used,
    usedGuard: row.used_guard === 1,
    baseChanceBp: row.base_chance_bp,
    supporters: parseStringArray(row.supporters_json),
    saboteurs: parseStringArray(row.saboteurs_json),
    status: row.status,
    resultSummary: row.result_summary,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

export function mapDuel(row: RpgDuelSqlRow): RpgDuel {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    challengerId: row.challenger_id,
    opponentId: row.opponent_id,
    rulesMode: row.rules_mode,
    betAmount: row.bet_amount,
    status: row.status,
    winnerId: row.winner_id,
    resultSummary: row.result_summary,
    highlights: parseStringArray(row.highlights_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

export function mapRaid(row: RpgRaidSqlRow): RpgRaid {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    leaderId: row.leader_id,
    tier: row.tier,
    bossName: row.boss_name,
    bossMaxHp: row.boss_max_hp ?? 0,
    bossRemainingHp: row.boss_remaining_hp ?? 0,
    members: parseStringArray(row.members_json),
    mercIds: parseStringArray(row.merc_ids_json),
    status: row.status,
    mvpUserId: row.mvp_user_id,
    resultSummary: row.result_summary,
    highlights: parseStringArray(row.highlights_json),
    payouts: parseRaidPayouts(row.payouts_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}
