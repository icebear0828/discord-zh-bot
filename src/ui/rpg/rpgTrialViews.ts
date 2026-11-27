import { ButtonStyle, EmbedBuilder } from 'discord.js';
import type { EconomyConfig } from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import type { RpgTrial } from '../../db/repositories/rpgRepo.js';
import {
  GUARD_ELIXIR_DAILY_LIMIT,
  GUARD_ELIXIR_PRICE,
  MAX_TRIAL_PILLS,
  MAX_TRIAL_SABOTEURS,
  MAX_TRIAL_SUPPORTERS,
  PITY_BONUS_PER_FAIL_PCT,
  PROMO_PILL_BONUS_PCT,
  PROMO_PILL_DAILY_LIMIT,
  PROMO_PILL_PRICE,
  RPG_TIER_MAP,
  SABOTEUR_PENALTY_PCT,
  SABOTEUR_POOL_BONUS_PCT,
  SUPPORTER_BONUS_PCT,
  computeTrialEffectiveRate,
  getRpgRealmInfo,
  type SupporterPayout,
} from '../../services/rpgService.js';
import { COLORS } from '../embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuFeedback,
} from '../menuShared.js';
import { buildClassOnboardingView } from './rpgHomeAndClassViews.js';

export function buildRpgTrialView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
  if (!character.classSelected) {
    return buildClassOnboardingView(actor, feedback);
  }

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const economy = guildCfg.economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const btPreview = ctx.services.rpg.computeBreakthroughPreview(guildId, actor.id, nowMs);
  const pendingTrial = ctx.services.rpg.getPendingTrialForUser(guildId, actor.id);
  const pillBuysLeft = Math.max(0, PROMO_PILL_DAILY_LIMIT - character.pillBuysToday);
  const elixirBuysLeft = Math.max(0, GUARD_ELIXIR_DAILY_LIMIT - character.elixirBuysToday);

  const lines: string[] = [
    `🏅 当前境界：**${btPreview.fromRealm.fullLabel}**（Lv.${character.level}） → 冲击目标：${
      btPreview.targetTierDef
        ? `**${btPreview.targetTierDef.emoji} ${btPreview.targetTierDef.name}·一重**`
        : '👑 **已达最高神座阶**'
    }`,
    `${economy.currencyEmoji} 口袋余额：**${profile.coins.toLocaleString('en-US')}** ${economy.currencyName} ｜ ✨ 突破经验：**${btPreview.currentXp.toLocaleString('en-US')} / ${btPreview.needXp.toLocaleString('en-US')} XP**（${
      btPreview.atMaxTier
        ? '已满阶'
        : btPreview.eligible
          ? '✅ 已达破境门槛'
          : '⏳ 需当前阶九重经验满额'
    }）`,
  ];

  if (pendingTrial) {
    const expSec = Math.floor(pendingTrial.expiresAt / 1000);
    lines.push(
      '',
      `🔥 **公开试炼进行中**：已在 <#${pendingTrial.channelId}> 发起渡劫，截止 <t:${expSec}:R>（助威 ${pendingTrial.supporters.length}/${MAX_TRIAL_SUPPORTERS} ｜ 起哄 ${pendingTrial.saboteurs.length}/${MAX_TRIAL_SABOTEURS}），请在试炼卡片中等待天劫或提前引动！`,
    );
  }

  if (!btPreview.atMaxTier) {
    const creditSign = btPreview.creditBonusPct >= 0 ? '+' : '';
    lines.push(
      '',
      '📊 **破境成功率明细（综合上限 5%~95%）**',
      `• 阶位基础率：**${btPreview.baseRatePct}%**`,
      `• 晋升秘药：**+${btPreview.pillBonusPct}%**（上阵 **${btPreview.pillsUsed}/${MAX_TRIAL_PILLS}** 颗，每颗 +${PROMO_PILL_BONUS_PCT}%）`,
      `• 战宠协同：**+${btPreview.petBonusPct}%**（${btPreview.petName ? `🐾 ${btPreview.petName}` : '未出战宠物'}）`,
      `• 信用分影响：**${creditSign}${btPreview.creditBonusPct}%**（当前信用分 ${btPreview.creditScore}）`,
      `• 连败保底：**+${btPreview.pityBonusPct}%**（已累计失败 ${character.breakthroughPity} 次，每次 +${PITY_BONUS_PER_FAIL_PCT}%）`,
      `• 🎯 **预计单人成功率：${btPreview.totalRatePct}%**`,
      `• 🛡️ 护魂圣水配置：**${btPreview.usedGuard ? '已开启' : '未开启'}**（${
        btPreview.usedGuard
          ? '失败仅扣 10% 经验且免疫 1 小时重伤'
          : '未开启时失败扣 40% 经验并重伤 1 小时（挂机 0.5x）'
      }）`,
    );
  }

  lines.push(
    '',
    '⚗️ **秘药工坊（每天刷新限购）**',
    `• 🧪 **晋升秘药**：库存 **${character.promoPills}** 颗 ｜ 单价 ${economy.currencyEmoji} **${PROMO_PILL_PRICE.toLocaleString('en-US')}** ｜ 今日限购余 **${pillBuysLeft}/${PROMO_PILL_DAILY_LIMIT}**`,
    `• 🛡️ **护魂圣水**：库存 **${character.guardElixirs}** 瓶 ｜ 单价 ${economy.currencyEmoji} **${GUARD_ELIXIR_PRICE.toLocaleString('en-US')}** ｜ 今日限购余 **${elixirBuysLeft}/${GUARD_ELIXIR_DAILY_LIMIT}**`,
    '',
    '📣 **60秒公开渡劫规则（#游戏聊天）**：',
    `> • 助威（≤${MAX_TRIAL_SUPPORTERS}人）：每人成功率 **+${SUPPORTER_BONUS_PCT}%**，破境成功每人获赠 **${(btPreview.targetTierDef?.tier ?? 2) * 600}** 喜糖 ${economy.currencyName}！`,
    `> • 起哄（≤${MAX_TRIAL_SABOTEURS}人）：每人成功率 **-${SABOTEUR_PENALTY_PCT}%**，但破境成功总奖池额外 **+${SABOTEUR_POOL_BONUS_PCT}%**！`,
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 炼金工坊与破境试炼`, iconURL: actor.avatarUrl })
    .setTitle('⚡ 炼金秘药工坊 & 十阶破境试炼')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '发起破境时将消耗已上阵的晋升秘药与护魂圣水；连败每次提供 +10% 永久保底直至成功' })
    .setTimestamp();

  const locked = Boolean(pendingTrial);

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(
          'rpg:alchemy:buy_pill',
          `🧪 买秘药 (${PROMO_PILL_PRICE})`,
          ButtonStyle.Primary,
          pillBuysLeft === 0,
        ),
        makeButton(
          'rpg:alchemy:buy_elixir',
          `🛡️ 买护魂 (${GUARD_ELIXIR_PRICE})`,
          ButtonStyle.Primary,
          elixirBuysLeft === 0,
        ),
        makeButton(
          'rpg:trial:cycle_pills',
          `💊 上阵秘药 (${btPreview.pillsUsed}/${MAX_TRIAL_PILLS})`,
          ButtonStyle.Secondary,
          locked || (character.promoPills === 0 && btPreview.pillsUsed === 0),
        ),
        makeButton(
          'rpg:trial:toggle_guard',
          `🛡️ 护魂: ${btPreview.usedGuard ? '已开' : '关'}`,
          btPreview.usedGuard ? ButtonStyle.Success : ButtonStyle.Secondary,
          locked || (character.guardElixirs === 0 && !btPreview.usedGuard),
        ),
      ),
      buttonRow(
        makeButton(
          'rpg:trial:solo',
          '⚡ 单人立即破境',
          ButtonStyle.Primary,
          !btPreview.eligible || btPreview.hasPendingTrial || btPreview.atMaxTier,
        ),
        makeButton(
          'rpg:trial:public',
          '📣 发起60秒公开渡劫',
          ButtonStyle.Success,
          !btPreview.eligible || btPreview.hasPendingTrial || btPreview.atMaxTier,
        ),
      ),
      buttonRow(
        makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
        makeButton('rpg:nav:gear', '🎒 铁匠与装备', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildPublicTrialCard(
  trial: RpgTrial,
  economy: EconomyConfig,
  supporterPayouts?: readonly SupporterPayout[],
  _nowMs = Date.now(),
): BuiltButtonMessage {
  const fromRealm = getRpgRealmInfo(trial.fromLevel);
  const toTier = RPG_TIER_MAP.get(trial.targetTier);
  const targetLabel = toTier ? `${toTier.emoji} ${toTier.name}·一重` : `第 ${trial.targetTier} 阶`;
  const effectiveRate = computeTrialEffectiveRate(
    trial.baseChanceBp,
    trial.supporters.length,
    trial.saboteurs.length,
  );
  const basePct = Math.round(trial.baseChanceBp / 100);
  const candyPool = trial.targetTier * 600;
  const expSec = Math.floor(trial.expiresAt / 1000);

  const supporterList =
    trial.supporters.length > 0 ? trial.supporters.map((u) => `<@${u}>`).join('、') : '暂无（快来助威！）';
  const saboteurList =
    trial.saboteurs.length > 0 ? trial.saboteurs.map((u) => `<@${u}>`).join('、') : '暂无';

  const statusHeading =
    trial.status === 'pending'
      ? '🌩️ 天劫正在凝聚中！全服围观助威或起哄加奖'
      : trial.status === 'succeeded'
        ? '🎉 破境成功 · 金榜题名！'
        : trial.status === 'failed'
          ? '💥 渡劫失败 · 灵力反噬'
          : '⚪ 试炼已取消';

  const color =
    trial.status === 'succeeded'
      ? COLORS.SUCCESS
      : trial.status === 'failed'
        ? COLORS.ERROR
        : trial.status === 'cancelled'
          ? COLORS.PRIMARY
          : COLORS.GOLD;

  const lines: string[] = [
    `⚔️ 渡劫勇者：<@${trial.userId}>`,
    `🏅 冲击境界：**${fromRealm.fullLabel}** → **${targetLabel}**`,
    `🎯 当前成功率：**${effectiveRate}%**（个人底率 ${basePct}% ｜ 助威 +${trial.supporters.length * SUPPORTER_BONUS_PCT}% ｜ 起哄 -${trial.saboteurs.length * SABOTEUR_PENALTY_PCT}%）`,
    `⚗️ 已投入：🧪 晋升秘药 **${trial.pillsUsed}** 颗 ｜ 🛡️ 护魂圣水：**${trial.usedGuard ? '✅ 已防护' : '未开启'}**`,
    `🙏 助威团（${trial.supporters.length}/${MAX_TRIAL_SUPPORTERS} · 成功每人获赠 ${economy.currencyEmoji} **${candyPool.toLocaleString('en-US')}** 喜糖）：${supporterList}`,
    `😈 起哄团（${trial.saboteurs.length}/${MAX_TRIAL_SABOTEURS} · 每人 +${SABOTEUR_POOL_BONUS_PCT}% 成功赏金池）：${saboteurList}`,
  ];

  if (trial.status === 'pending') {
    lines.push(`⏱️ 倒计时：将在 <t:${expSec}:R> 自动结算（本人可点击下方按钮立刻引动天劫）`);
  } else if (trial.resultSummary) {
    lines.push('', `📜 **试炼结果**：${trial.resultSummary}`);
  }

  if (supporterPayouts && supporterPayouts.length > 0) {
    const payoutTags = supporterPayouts.map((p) => `<@${p.userId}> +${p.amount}`).join('、');
    lines.push(`🍬 **助威喜糖发放**：${payoutTags}`);
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⚡ 全服破境试炼 #${trial.id} — ${statusHeading}`)
    .setDescription(truncateText(lines.join('\n'), 4096))
    .setFooter({ text: '试炼仅在 #游戏聊天 举办 · 每名围观玩家仅可选择助威或起哄一次' })
    .setTimestamp(trial.resolvedAt || trial.createdAt);

  if (trial.status !== 'pending') {
    return { embeds: [embed], components: [] };
  }

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(
          `rpg:trial_help:${trial.id}`,
          `🙏 助威加运 (${trial.supporters.length}/${MAX_TRIAL_SUPPORTERS})`,
          ButtonStyle.Success,
          trial.supporters.length >= MAX_TRIAL_SUPPORTERS,
        ),
        makeButton(
          `rpg:trial_jeer:${trial.id}`,
          `😈 起哄加奖 (${trial.saboteurs.length}/${MAX_TRIAL_SABOTEURS})`,
          ButtonStyle.Danger,
          trial.saboteurs.length >= MAX_TRIAL_SABOTEURS,
        ),
        makeButton(`rpg:trial_settle:${trial.id}`, '⚡ 立刻引动天劫', ButtonStyle.Primary),
      ),
    ],
  };
}
