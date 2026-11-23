import type Database from 'better-sqlite3';
import type { FunRepo, FortuneRecord } from '../db/repositories/funRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { ShopRepo } from '../db/repositories/shopRepo.js';
import { getDateKey } from './economyService.js';

export type InteractionAction = 'pat' | 'hug' | 'cuddle' | 'poke' | 'feed' | 'snowball';

export interface FortuneDrawResult {
  alreadyDrawn: boolean;
  record: FortuneRecord;
  balance: number;
}

export interface InteractionResult {
  action: InteractionAction;
  label: string;
  emoji: string;
  verbPhrase: string;
  count: number;
}

const LUCK_TIERS: ReadonlyArray<{ tier: string; minBonus: number; maxBonus: number }> = [
  { tier: '大吉', minBonus: 60, maxBonus: 80 },
  { tier: '中吉', minBonus: 45, maxBonus: 65 },
  { tier: '小吉', minBonus: 30, maxBonus: 50 },
  { tier: '吉', minBonus: 25, maxBonus: 40 },
  { tier: '末吉', minBonus: 15, maxBonus: 30 },
  { tier: '小凶', minBonus: 10, maxBonus: 20 },
];

const GOOD_FOR_LIST = [
  '语音吹水',
  '尝试抽奖',
  '买经验卡冲榜',
  '给好友转账',
  '水群聊到热度 2x',
  '玩一局二十一点',
  '领取每日签到',
];

const AVOID_LIST = [
  '强行打劫榜一大佬',
  '梭哈老虎机',
  '熬夜掉头发',
  '在禁经验频道水字数',
  '忘记领签到断连击',
  '冲动买空商店',
];

const ACTION_META: Record<
  InteractionAction,
  { label: string; emoji: string; verbPhrase: string }
> = {
  pat: { label: '摸头', emoji: '🫂', verbPhrase: '轻轻摸了摸' },
  hug: { label: '抱抱', emoji: '🤗', verbPhrase: '给了大大的拥抱' },
  cuddle: { label: '贴贴', emoji: '🥰', verbPhrase: '开心贴贴了' },
  poke: { label: '戳一戳', emoji: '👉', verbPhrase: '调皮地戳了戳' },
  feed: { label: '投喂', emoji: '🍰', verbPhrase: '投喂了一块小蛋糕给' },
  snowball: { label: '丢雪球', emoji: '❄️', verbPhrase: '朝其丢了一颗雪球' },
};

function pickFrom<T>(list: readonly T[], rng: () => number): T {
  const idx = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)));
  return list[idx]!;
}

export class FunService {
  constructor(
    private readonly db: Database.Database,
    private readonly profileRepo: ProfileRepo,
    private readonly shopRepo: ShopRepo,
    private readonly funRepo: FunRepo,
    private readonly timezone = 'Asia/Shanghai',
  ) {}

  drawDailyFortune(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): FortuneDrawResult {
    const dateKey = getDateKey(nowMs, this.timezone);

    return this.db.transaction((): FortuneDrawResult => {
      const existing = this.funRepo.getFortune(guildId, userId, dateKey);
      if (existing) {
        const balance = this.profileRepo.getOrCreate(guildId, userId).coins;
        return { alreadyDrawn: true, record: existing, balance };
      }

      const tierInfo = pickFrom(LUCK_TIERS, rng);
      const goodFor = pickFrom(GOOD_FOR_LIST, rng);
      const avoid = pickFrom(AVOID_LIST, rng);
      const luckyNumber = 1 + Math.min(98, Math.floor(rng() * 99));
      const bonusCoins =
        tierInfo.minBonus +
        Math.floor(rng() * (tierInfo.maxBonus - tierInfo.minBonus + 1));

      const record: FortuneRecord = {
        guildId,
        userId,
        dateKey,
        luckTier: tierInfo.tier,
        goodFor,
        avoid,
        luckyNumber,
        bonusCoins,
        createdAt: nowMs,
      };

      this.funRepo.saveFortune(record);
      const updated = this.profileRepo.addCoins(guildId, userId, bonusCoins);

      return { alreadyDrawn: false, record, balance: updated.coins };
    })();
  }

  performInteraction(
    guildId: string,
    actorId: string,
    targetId: string,
    action: InteractionAction,
  ): InteractionResult {
    const count = this.funRepo.incrementInteraction(guildId, actorId, targetId, action);
    const meta = ACTION_META[action];
    return {
      action,
      label: meta.label,
      emoji: meta.emoji,
      verbPhrase: meta.verbPhrase,
      count,
    };
  }

  listTitles(guildId: string, userId: string): string[] {
    return this.shopRepo
      .listInventory(guildId, userId)
      .filter((i) => i.itemType === 'title')
      .map((i) => i.itemName);
  }

  grantTitle(guildId: string, userId: string, titleText: string): { created: boolean } {
    const clean = titleText.trim();
    const existing = this.shopRepo.findInventoryByTypeAndName(
      guildId,
      userId,
      'title',
      clean,
    );
    if (existing) {
      return { created: false };
    }

    this.shopRepo.addInventoryItem({
      guildId,
      userId,
      itemType: 'title',
      itemName: clean,
      payloadJson: JSON.stringify({ titleText: clean }),
      quantity: 1,
    });
    return { created: true };
  }

  equipTitle(
    guildId: string,
    userId: string,
    titleText: string,
  ): { ok: true; title: string } | { ok: false } {
    const owned = this.shopRepo.findInventoryByTypeAndName(
      guildId,
      userId,
      'title',
      titleText.trim(),
    );
    if (!owned) {
      return { ok: false };
    }
    const profile = this.profileRepo.getOrCreate(guildId, userId);
    this.profileRepo.save({ ...profile, equippedTitle: owned.itemName });
    return { ok: true, title: owned.itemName };
  }

  clearTitle(guildId: string, userId: string): void {
    const profile = this.profileRepo.getOrCreate(guildId, userId);
    this.profileRepo.save({ ...profile, equippedTitle: null });
  }
}
