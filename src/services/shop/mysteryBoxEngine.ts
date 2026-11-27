import type { PropKey } from '../../db/repositories/chaosRepo.js';
import type { MemberProfile } from '../../db/repositories/profileRepo.js';
import type { ShopItem } from '../../db/repositories/shopRepo.js';
import { PROP_CATALOG } from '../chaosService.js';
import { applyPetXp } from '../socialPetService.js';
import {
  randomIntInclusive,
  type BoostPayload,
  type BuyResult,
  type MysteryBoxReward,
  type ShopOpsContext,
} from './shopTypesAndPayloads.js';

const PROP_KEYS: readonly PropKey[] = ['trap', 'lockpick', 'shield', 'curse', 'nickname'];

function getStatMeta(
  ctx: ShopOpsContext,
  guildId: string,
): { statName: string; statUnit: string; currencyName: string } {
  if (!ctx.guildConfigRepo) {
    return { statName: '成长值', statUnit: '点', currencyName: '星币' };
  }
  const cfg = ctx.guildConfigRepo.getOrCreate(guildId);
  return {
    statName: cfg.leveling.statName,
    statUnit: cfg.leveling.statUnit,
    currencyName: cfg.economy.currencyName,
  };
}

export function openMysteryBoxInTx(
  ctx: ShopOpsContext,
  guildId: string,
  userId: string,
  item: ShopItem,
  profile: MemberProfile,
  finalPrice: number,
  nowMs: number,
  rng: () => number,
): BuyResult {
  const meta = getStatMeta(ctx, guildId);
  const tierScale =
    item.price <= 2000 ? 1 : Math.max(1, Math.min(10, Math.round(item.price / 3000)));
  ctx.shopRepo.decrementStock(guildId, item.id);
  let nextCoins = profile.coins - finalPrice;
  let nextStat = profile.statValue;
  const roll = rng();
  let reward: MysteryBoxReward;

  if (roll < 0.03) {
    const mult = randomIntInclusive(3, 5, rng);
    const prize = Math.max(0, Math.floor(finalPrice * mult));
    nextCoins += prize;
    reward = {
      kind: 'coins_jackpot',
      isJackpot: true,
      coinsDelta: prize,
      summary: `💥 **超级金奖！** 开出 **${mult}x** 暴击返币 **+${prize}** ${meta.currencyName}！`,
    };
  } else if (roll < 0.05) {
    const minStat = tierScale === 1 ? 8 : Math.min(40, 8 * tierScale);
    const maxStat = tierScale === 1 ? 15 : Math.min(80, 15 * tierScale);
    const gain = randomIntInclusive(minStat, maxStat, rng);
    nextStat += gain;
    reward = {
      kind: 'stat_jackpot',
      isJackpot: true,
      statDelta: gain,
      newStatValue: nextStat,
      summary: `🌟 **天选奇迹！** ${meta.statName}暴涨 **+${gain}** ${meta.statUnit}（现 **${nextStat}** ${meta.statUnit}）！`,
    };
  } else if (roll < 0.25) {
    const boostMult = tierScale >= 5 ? 3.0 : 2.0;
    const boostDur = tierScale >= 5 ? 7200 : 3600;
    const boostName =
      boostMult >= 3.0 ? '🔥 盲盒三倍经验卡' : '⚡ 盲盒双倍经验卡';
    const boostPayload: BoostPayload = { multiplier: boostMult, durationSec: boostDur };
    ctx.shopRepo.addInventoryItem({
      guildId,
      userId,
      itemType: 'xp_boost',
      itemName: boostName,
      payloadJson: JSON.stringify(boostPayload),
      quantity: 1,
      acquiredAt: nowMs,
    });
    reward = {
      kind: 'xp_boost',
      isJackpot: false,
      boostMultiplier: boostMult,
      boostDurationSec: boostDur,
      summary: `⚡ 开出 **${boostMult.toFixed(1)}x 经验加成卡（${Math.round(boostDur / 60)}分钟）**，已存入背包！`,
    };
  } else if (roll < 0.45 && ctx.chaosRepo) {
    const propKey = PROP_KEYS[Math.floor(rng() * PROP_KEYS.length)] ?? 'shield';
    const propMeta = PROP_CATALOG[propKey];
    ctx.chaosRepo.addProp(guildId, userId, propKey, 1);
    reward = {
      kind: 'chaos_prop',
      isJackpot: false,
      propKey,
      summary: `${propMeta.emoji} 开出黑市道具 **【${propMeta.name}】× 1**，已放入黑市背包！`,
    };
  } else if (roll < 0.60 && ctx.socialPetRepo) {
    const activePet = ctx.socialPetRepo.getActivePet(guildId, userId);
    if (activePet) {
      const petXpGain = 120 * tierScale;
      const applied = applyPetXp(activePet, petXpGain);
      ctx.socialPetRepo.savePet(applied.updatedPet);
      reward = {
        kind: 'pet_xp',
        isJackpot: false,
        petName: applied.updatedPet.nickname,
        petXpGained: petXpGain,
        petLevelsGained: applied.levelsGained,
        summary: `🐾 出战宠物 **${applied.updatedPet.nickname}** 获得 **+${petXpGain} XP**${applied.levelsGained > 0 ? `（连升 ${applied.levelsGained} 级至 Lv.${applied.updatedPet.level}！）` : ''}！`,
      };
    } else {
      const prize = Math.max(0, Math.floor(finalPrice * 0.7));
      nextCoins += prize;
      reward = {
        kind: 'coins_refund',
        isJackpot: false,
        coinsDelta: prize,
        summary: `🪙 暂无出战宠物，折算返还 **+${prize}** ${meta.currencyName}！`,
      };
    }
  } else if (roll < 0.72) {
    const minSmall = tierScale === 1 ? 1 : Math.min(12, tierScale);
    const maxSmall = tierScale === 1 ? 3 : Math.min(25, 3 * tierScale);
    const gain = randomIntInclusive(minSmall, maxSmall, rng);
    nextStat += gain;
    reward = {
      kind: 'stat_small',
      isJackpot: false,
      statDelta: gain,
      newStatValue: nextStat,
      summary: `📈 ${meta.statName}提升 **+${gain}** ${meta.statUnit}（现 **${nextStat}** ${meta.statUnit}）！`,
    };
  } else {
    const ratio = 0.25 + rng() * 0.55;
    const prize = Math.max(0, Math.floor(finalPrice * ratio));
    nextCoins += prize;
    reward = {
      kind: 'coins_refund',
      isJackpot: false,
      coinsDelta: prize,
      summary: `🪙 开出小金库返利，返还 **+${prize}** ${meta.currencyName}！`,
    };
  }

  ctx.profileRepo.save({
    ...profile,
    coins: nextCoins,
    statValue: nextStat,
  });

  return {
    ok: true,
    item,
    finalPrice,
    balance: nextCoins,
    grantRoleId: null,
    equippedTitle: null,
    addedInventory: null,
    mysteryBoxResult: reward,
  };
}
