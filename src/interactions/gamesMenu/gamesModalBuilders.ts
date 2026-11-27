import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { GuildConfig } from '../../config/defaults.js';
import { PREDICTION_MAX_BET } from '../../config/economyConstants.js';
import { truncateText } from '../../ui/menuBuilder.js';
import { prefilledField } from '../menuHelpers.js';

export function buildTextModal(input: {
  customId: string;
  title: string;
  fieldId: string;
  label: string;
  placeholder: string;
  maxLength?: number;
  defaultValue?: string;
}): ModalBuilder {
  const field = new TextInputBuilder()
    .setCustomId(input.fieldId)
    .setLabel(truncateText(input.label, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(input.maxLength ?? 32)
    .setPlaceholder(input.placeholder)
    .setRequired(true);

  if (input.defaultValue !== undefined) {
    field.setValue(input.defaultValue);
  }

  return new ModalBuilder()
    .setCustomId(input.customId)
    .setTitle(truncateText(input.title, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(field));
}

export function buildCreatePredictionModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:pred_create')
    .setTitle(truncateText('📊 发起全群吃瓜盘口', 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel(truncateText('盘口问题 / 吃瓜标题（1~100字）', 45))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(100)
          .setPlaceholder('例如：今晚群主会不会发大红包？')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('opt1')
          .setLabel(truncateText('选项 1', 45))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(40)
          .setPlaceholder('例如：一定会发')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('opt2')
          .setLabel(truncateText('选项 2', 45))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(40)
          .setPlaceholder('例如：绝对鸽了')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('extraOpts')
          .setLabel(truncateText('额外选项（可选，用 / 分隔最多再填2个）', 45))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80)
          .setPlaceholder('例如：只发1块钱/半夜才发')
          .setRequired(false),
      ),
      prefilledField('closeMinutes', '封盘倒计时分钟（1 ~ 10080）', 60, 8),
    );
}

export function buildRouletteModal(currencyName: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:roulette')
    .setTitle(truncateText('🔫 创建自定义轮盘房间', 45))
    .addComponents(
      prefilledField('entryFee', `入场费（50 ~ 1000000000 ${currencyName}）`, 200, 12),
      prefilledField('maxPlayers', '最大座位数（2 ~ 6 人）', 6, 2),
    );
}

export function buildNumberBombModal(currencyName: string): ModalBuilder {
  return buildTextModal({
    customId: 'menu:modal_sub:bomb',
    title: '💣 投放数字炸弹',
    fieldId: 'penalty',
    label: `踩雷罚金（100 ~ 1000000000 ${currencyName}）`,
    placeholder: '例如：300',
    maxLength: 12,
    defaultValue: '200',
  });
}

export function buildPetRenameModal(currentNickname: string): ModalBuilder {
  return buildTextModal({
    customId: 'menu:modal_sub:pet_rename',
    title: '✏️ 修改出战宠物昵称',
    fieldId: 'nickname',
    label: '新宠物昵称（1 ~ 20 字）',
    placeholder: '例如：旺财大魔王',
    maxLength: 20,
    defaultValue: currentNickname,
  });
}

export function buildPetOpenBattleModal(currencyName: string): ModalBuilder {
  return buildTextModal({
    customId: 'menu:modal_sub:pet_open_battle',
    title: '🏟️ 全群公开宠物摆擂台',
    fieldId: 'bet',
    label: `擂台赌注（${currencyName}，0 = 友谊赛）`,
    placeholder: '例如：200',
    maxLength: 12,
    defaultValue: '200',
  });
}

export function buildAdminPropsModal(g: GuildConfig['games']): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_props')
    .setTitle(truncateText('🧰 修改黑市道具定价', 45))
    .addComponents(
      prefilledField('trap', '捕兽夹价格', g.propTrapPrice),
      prefilledField('lockpick', '万能撬锁价格', g.propLockpickPrice),
      prefilledField('shield', '防盗保险价格', g.propShieldPrice),
      prefilledField('curse', '衰神符价格', g.propCursePrice),
      prefilledField('nickname', '改昵称卡价格', g.propNicknamePrice),
    );
}

export function buildAdminEventsModal(g: GuildConfig['games']): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_events')
    .setTitle(truncateText('🎁 修改世界事件/Boss/宝箱', 45))
    .addComponents(
      prefilledField('threshold', '自动触发发言数（5~500）', g.eventMsgThreshold),
      prefilledField('cooldown', '事件冷却秒数（60~86400）', g.eventCooldownSec),
      prefilledField('bossHp', 'Boss基础血量（100~100000）', g.bossBaseHp),
      prefilledField('bossPool', 'Boss讨伐奖池（100~1000000000）', g.bossRewardPool),
      prefilledField('chestRange', '宝箱总额范围(min-max)', `${g.chestRewardMin}-${g.chestRewardMax}`, 24),
    );
}

export function buildAdminPetsCpModal(g: GuildConfig['games']): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_pets_cp')
    .setTitle(truncateText('🐾 修改宠物与CP参数', 45))
    .addComponents(
      prefilledField('petGachaPrice', '盲盒抽宠价格（0~100000）', g.petGachaPrice),
      prefilledField('petFeedPrice', '每日喂食费用（0~10000）', g.petFeedPrice),
      prefilledField('petMaxOwned', '单人宠物上限（1~25）', g.petMaxOwned),
      prefilledField('cpProposeCost', '求婚/结拜仪式费（0~100000）', g.cpProposeCost),
      prefilledField('cpMaxSworn', '最多结拜人数（1~10）', g.cpMaxSworn),
    );
}

export function buildAdminBountyModal(g: GuildConfig['games']): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_bounty')
    .setTitle(truncateText('🎯 修改悬赏通缉参数', 45))
    .addComponents(
      prefilledField('minAmount', '最低悬赏金额（1~100000）', g.bountyMinAmount),
      prefilledField('clearMult', '自费撤单倍率（1.0~5.0）', g.bountyClearMultiplier),
    );
}

export function buildPredBetModal(
  predId: number,
  optIdx: number,
  optLabel: string,
  currencyName: string,
): ModalBuilder {
  return buildTextModal({
    customId: `menu:modal_sub:pred_bet:${predId}:${optIdx}`,
    title: '📊 吃瓜盘口押注',
    fieldId: 'amount',
    label: `押注「${optLabel.slice(0, 14)}」金额 (${currencyName})`,
    placeholder: `1 ~ ${PREDICTION_MAX_BET.toLocaleString()}`,
    maxLength: 12,
  });
}

export function buildPropNickModal(targetId: string): ModalBuilder {
  return buildTextModal({
    customId: `menu:modal_sub:prop_nick:${targetId}`,
    title: '🎭 强制修改群友昵称',
    fieldId: 'nickname',
    label: '输入想整蛊的新昵称（1 ~ 32 字）',
    placeholder: '例如：我是超级大显眼包',
    maxLength: 32,
  });
}

export function buildBountyTargetModal(targetId: string, minAmt: number): ModalBuilder {
  return buildTextModal({
    customId: `menu:modal_sub:bounty:${targetId}`,
    title: '🎯 发布悬赏通缉令',
    fieldId: 'amount',
    label: `悬赏金额（至少 ${minAmt}）`,
    placeholder: `例如：${minAmt}`,
    maxLength: 12,
  });
}

export function buildPetBattleChallengeModal(targetId: string, currencyName: string): ModalBuilder {
  return buildTextModal({
    customId: `menu:modal_sub:pet_battle:${targetId}`,
    title: '🏟️ 发起宠物斗兽场挑战',
    fieldId: 'bet',
    label: `赌注金额（${currencyName}，0 = 友谊切磋）`,
    placeholder: '例如：200',
    maxLength: 12,
    defaultValue: '200',
  });
}
