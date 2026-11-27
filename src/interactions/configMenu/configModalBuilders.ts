import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { GuildConfig } from '../../config/defaults.js';
import { truncateText } from '../../ui/menuShared.js';
import { prefilledField } from '../menuHelpers.js';

export function optionalInput(input: {
  customId: string;
  label: string;
  placeholder: string;
  maxLength: number;
  value?: string | null;
}): ActionRowBuilder<TextInputBuilder> {
  const field = new TextInputBuilder()
    .setCustomId(input.customId)
    .setLabel(truncateText(input.label, 45))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(input.maxLength)
    .setPlaceholder(input.placeholder)
    .setRequired(false);

  const trimmed = input.value?.trim();
  if (trimmed) {
    field.setValue(truncateText(trimmed, input.maxLength));
  }

  return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
}

export function reqInput(
  customId: string,
  label: string,
  placeholder: string,
  maxLength: number,
  defaultValue?: string,
): ActionRowBuilder<TextInputBuilder> {
  const field = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(truncateText(label, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(maxLength)
    .setPlaceholder(placeholder)
    .setRequired(true);

  const trimmed = defaultValue?.trim();
  if (trimmed) {
    field.setValue(truncateText(trimmed, maxLength));
  }

  return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
}

export function buildEditCardModal(profile: {
  cardNickname: string | null;
  cardTag: string | null;
  cardBio: string | null;
  cardColor: string | null;
}): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:edit_card')
    .setTitle(truncateText('🪪 编辑我的身份证名片', 45))
    .addComponents(
      optionalInput({
        customId: 'cardNickname',
        label: '展示昵称（最多24字，留空用默认昵称）',
        placeholder: '例如：黑吊国第一深情',
        maxLength: 24,
        value: profile.cardNickname,
      }),
      optionalInput({
        customId: 'cardTag',
        label: '个性标签 / 身份（最多32字，可留空）',
        placeholder: '例如：夜猫子 · 摸鱼大师',
        maxLength: 32,
        value: profile.cardTag,
      }),
      optionalInput({
        customId: 'cardBio',
        label: '个人签名 / 简介（最多80字，可留空）',
        placeholder: '写一句个性签名或宣言...',
        maxLength: 80,
        value: profile.cardBio,
      }),
      optionalInput({
        customId: 'cardColor',
        label: '名片主题色（红/橙/黄/绿/青/蓝/紫/粉/金 或 #RRGGBB）',
        placeholder: '例如：紫 或 #FF6B8B（留空默认）',
        maxLength: 16,
        value: profile.cardColor,
      }),
    );
}

export function buildLevelMsgModal(title: string, template: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_lvl_msg')
    .setTitle(truncateText('📝 自定义升级提示语', 45))
    .addComponents(
      prefilledField('levelUpTitle', '播报标题（1~60字，支持 {level}）', truncateText(title, 60), 60),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('levelUpTemplate')
          .setLabel(truncateText('提示语（支持 {user} {level} {coins} {roles}）', 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(400)
          .setPlaceholder('可用变量：{user} {level} {stat} {statGained} {statUnit} {coins} {roles}')
          .setValue(truncateText(template, 400))
          .setRequired(true),
      ),
    );
}

export function buildCreateRolePanelModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_rp_create')
    .setTitle(truncateText('🎭 新建自助身份组面板', 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel(truncateText('面板标题（1~80字）', 45))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(80)
          .setPlaceholder('例如：游戏开黑 / 身份标签')
          .setRequired(true),
      ),
      optionalInput({
        customId: 'description',
        label: '面板描述（最多200字，可留空）',
        placeholder: '点击下方选项即可自助领取或取消对应身份组。',
        maxLength: 200,
      }),
      prefilledField('selectionMode', '选择模式（输入：多选 或 单选）', '多选', 16),
      prefilledField('displayMode', '频道展示样式（输入：按钮 或 菜单）', '按钮', 16),
    );
}

export function buildAddRoleOptionModal(
  panelId: number,
  roleId: string,
  defaultLabel: string | undefined,
): ModalBuilder {
  const labelField = new TextInputBuilder()
    .setCustomId('label')
    .setLabel(truncateText('显示文字（1~80字）', 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(80)
    .setPlaceholder('例如：LOL 开黑')
    .setRequired(true);

  const trimmedLabel = defaultLabel?.trim();
  if (trimmedLabel) {
    labelField.setValue(truncateText(trimmedLabel, 80));
  }

  return new ModalBuilder()
    .setCustomId(`menu:modal_sub:admin_rp_add:${panelId}:${roleId}`)
    .setTitle(truncateText('➕ 添加身份组选项', 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(labelField),
      optionalInput({
        customId: 'emoji',
        label: '图标 Emoji（可留空）',
        placeholder: '例如：🎮',
        maxLength: 32,
      }),
      optionalInput({
        customId: 'description',
        label: '选项说明（最多100字，可留空）',
        placeholder: '例如：开黑喊人用',
        maxLength: 100,
      }),
    );
}

export function buildCreditLoanConfigModal(cl: GuildConfig['creditLoan']): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_cl_loan')
    .setTitle(truncateText('🏦 编辑贷款与逾期强扣参数', 45))
    .addComponents(
      prefilledField('bankLoanMaxCap', '银行贷款全局上限（1000~1000000000）', cl.bankLoanMaxCap, 12),
      prefilledField('usuryLoanMax', '黑市高利贷上限（1000~1000000000）', cl.usuryLoanMax, 12),
      prefilledField(
        'usuryDailyRatePct',
        '高利贷日利率 %（1 ~ 100）',
        Number((cl.usuryDailyRate * 100).toFixed(2)),
        8,
      ),
      prefilledField('usuryTermDays', '高利贷期限天数（1 ~ 30）', cl.usuryTermDays, 6),
      prefilledField(
        'garnishRatePct',
        '逾期收益强扣比例 %（10 ~ 100）',
        Number((cl.garnishRate * 100).toFixed(2)),
        8,
      ),
    );
}

export function buildHustleConfigModal(cl: GuildConfig['creditLoan']): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_cl_hustle')
    .setTitle(truncateText('🍑 编辑卖屁股与信用互评参数', 45))
    .addComponents(
      prefilledField('hustleCooldownSec', '卖屁股冷却秒数（60 ~ 604800）', cl.hustleCooldownSec, 10),
      prefilledField('hustleMinMultiplier', '收益下限倍率（1 ~ 20）', cl.hustleMinMultiplier, 8),
      prefilledField('hustleMaxMultiplier', '收益上限倍率（1 ~ 50）', cl.hustleMaxMultiplier, 8),
      prefilledField('hustleCreditPenalty', '每次卖屁股信用扣分（0 ~ 100）', cl.hustleCreditPenalty, 6),
      prefilledField('dailyReviewLimit', '每人每日评价上限（1 ~ 20）', cl.dailyReviewLimit, 6),
    );
}

export function buildRpgConfigModal(rpg: GuildConfig['rpg']): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_rpg_cfg')
    .setTitle(truncateText('⚔️ 编辑西幻 RPG 地牢参数', 45))
    .addComponents(
      prefilledField('dailyStamina', '每日免费体力（1 ~ 50）', rpg.dailyStamina, 6),
      prefilledField('staminaPotionPrice', '体力药水售价（0 ~ 10000000）', rpg.staminaPotionPrice, 12),
      prefilledField('staminaPotionDailyLimit', '体力药水每日限购（0 ~ 20）', rpg.staminaPotionDailyLimit, 6),
      prefilledField('classSwitchCost', '职业转职费用（0 ~ 10000000）', rpg.classSwitchCost, 12),
      prefilledField('bagCapacity', '装备背包容量上限（10 ~ 200）', rpg.bagCapacity, 6),
    );
}

export function buildLevelRewardAddModal(roleId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`menu:modal_sub:admin_lvl_reward_add:${roleId}`)
    .setTitle(truncateText('🎖️ 设置升级奖励等级', 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('level')
          .setLabel(truncateText('达到多少级自动发放（1 ~ 200）', 45))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(4)
          .setPlaceholder('例如：5')
          .setRequired(true),
      ),
    );
}
