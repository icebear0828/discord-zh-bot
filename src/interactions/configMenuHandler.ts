import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { buildRolePanelMessage } from '../commands/roles/rolePanel.js';
import {
  DEFAULT_CREDIT_LOAN_CONFIG,
  DEFAULT_LEVELING_CONFIG,
  DEFAULT_RPG_CONFIG,
} from '../config/defaults.js';
import { parseCardColor, renderLevelUpTemplate } from '../services/levelingService.js';
import { computeRoleDiff } from '../services/rolePanelService.js';
import type { AppContext } from '../ui/embeds.js';
import { buildMenuMessage } from '../ui/menuBuilder.js';
import { truncateText, type MenuActor, type MenuFeedback } from '../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  parseIntInRange,
  parseNumberInRange,
  parsePositiveInt,
  prefilledField,
  respondFromModal,
  sendPublicBroadcast,
} from './menuHelpers.js';

function optionalInput(input: {
  customId: string;
  label: string;
  placeholder: string;
  maxLength: number;
  value?: string | null;
}): ActionRowBuilder<TextInputBuilder> {
  const field = new TextInputBuilder()
    .setCustomId(input.customId)
    .setLabel(input.label)
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

function reqInput(
  customId: string,
  label: string,
  placeholder: string,
  maxLength: number,
  defaultValue?: string,
): ActionRowBuilder<TextInputBuilder> {
  const field = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
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

function buildShopCreateModal(modalType: string, ctx: AppContext, guildId: string): ModalBuilder {
  const lvlCfg = ctx.repos.guildConfig.getOrCreate(guildId).leveling;

  if (modalType === 'admin_shop_title') {
    return new ModalBuilder()
      .setCustomId('menu:modal_sub:admin_shop_title')
      .setTitle('🏷️ 上架专属称号商品')
      .addComponents(
        reqInput('name', '商品名称（1~40字）', '例如：🏷️ 称号：本服合法公民', 40),
        reqInput('price', '售价（整数 >= 0）', '例如：3000', 12),
        reqInput('titleText', '佩戴称号文本（1~20字）', '例如：合法公民', 20),
        optionalInput({
          customId: 'description',
          label: '商品简介（可留空）',
          placeholder: '购买后自动佩戴专属称号',
          maxLength: 80,
        }),
        optionalInput({
          customId: 'stock',
          label: '限量库存（正整数，留空为无限）',
          placeholder: '留空表示无限库存',
          maxLength: 8,
        }),
      );
  }

  if (modalType === 'admin_shop_boost') {
    return new ModalBuilder()
      .setCustomId('menu:modal_sub:admin_shop_boost')
      .setTitle('⚡ 上架经验加成卡')
      .addComponents(
        reqInput('name', '商品名称（1~40字）', '例如：🔥 2.0x 狂肝经验卡', 40),
        reqInput('price', '售价（整数 >= 0）', '例如：1800', 12),
        reqInput('multiplier', '经验倍率（1.1 ~ 5.0）', '例如：2.0', 8),
        reqInput('durationMin', '持续分钟数（5 ~ 10080）', '例如：120', 8),
        optionalInput({
          customId: 'description',
          label: '商品简介（可留空）',
          placeholder: '激活后双倍聊天/语音经验',
          maxLength: 80,
        }),
      );
  }

  if (modalType === 'admin_shop_stat') {
    return new ModalBuilder()
      .setCustomId('menu:modal_sub:admin_shop_stat')
      .setTitle(`💊 上架${truncateText(lvlCfg.statName, 12)}道具`)
      .addComponents(
        reqInput('name', '商品名称（1~40字）', '例如：💊 初级成长药水', 40),
        reqInput('price', '售价（整数 >= 0）', '例如：1200', 12),
        reqInput('minGain', '数值最小增量（整数 >= 1）', '例如：1', 8),
        reqInput('maxGain', '数值最大增量（整数 >= 最小增量）', '例如：4', 8),
        optionalInput({
          customId: 'description',
          label: '商品简介（可留空）',
          placeholder: `增加 ${lvlCfg.statName}，含暴击与日限3次`,
          maxLength: 80,
        }),
      );
  }

  if (modalType === 'admin_shop_pet') {
    return new ModalBuilder()
      .setCustomId('menu:modal_sub:admin_shop_pet')
      .setTitle('🥫 上架宠物经验道具')
      .addComponents(
        reqInput('name', '商品名称（1~40字）', '例如：🥫 黄金猫罐头', 40),
        reqInput('price', '售价（整数 >= 0）', '例如：800', 12),
        reqInput('petXp', '增加的宠物经验（10 ~ 10000）', '例如：180', 8),
        optionalInput({
          customId: 'description',
          label: '商品简介（可留空）',
          placeholder: '买即生效，直接喂给出战宠物',
          maxLength: 80,
        }),
        optionalInput({
          customId: 'stock',
          label: '限量库存（正整数，留空为无限）',
          placeholder: '留空表示无限库存',
          maxLength: 8,
        }),
      );
  }

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_shop_special')
    .setTitle('🎁 上架盲盒或自定义称号券')
    .addComponents(
      reqInput('kind', '商品类型（输入：盲盒 或 称号券）', '盲盒 / 称号券', 16, '盲盒'),
      reqInput('name', '商品名称（1~40字）', '例如：🎁 神秘幸运盲盒', 40),
      reqInput('price', '售价（整数 >= 0）', '例如：1500', 12),
      optionalInput({
        customId: 'description',
        label: '商品简介（可留空）',
        placeholder: '神秘混合奖池 / 自拟1~20字称号',
        maxLength: 80,
      }),
      optionalInput({
        customId: 'stock',
        label: '限量库存（正整数，留空为无限）',
        placeholder: '留空表示无限库存',
        maxLength: 8,
      }),
    );
}

function buildEditCardModal(
  profile: {
    cardNickname: string | null;
    cardTag: string | null;
    cardBio: string | null;
    cardColor: string | null;
  },
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:edit_card')
    .setTitle('🪪 编辑我的身份证名片')
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

function buildLevelMsgModal(title: string, template: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_lvl_msg')
    .setTitle('📝 自定义升级提示语')
    .addComponents(
      prefilledField('levelUpTitle', '播报标题（1~60字，支持 {level}）', truncateText(title, 60), 60),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('levelUpTemplate')
          .setLabel('提示语（支持 {user} {level} {coins} {roles}）')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(400)
          .setPlaceholder('可用变量：{user} {level} {stat} {statGained} {statUnit} {coins} {roles}')
          .setValue(truncateText(template, 400))
          .setRequired(true),
      ),
    );
}

function buildCreateRolePanelModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_rp_create')
    .setTitle('🎭 新建自助身份组面板')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('面板标题（1~80字）')
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

function buildAddRoleOptionModal(
  panelId: number,
  roleId: string,
  defaultLabel: string | undefined,
): ModalBuilder {
  const labelField = new TextInputBuilder()
    .setCustomId('label')
    .setLabel('显示文字（1~80字）')
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
    .setTitle('➕ 添加身份组选项')
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

export async function tryHandleConfigMenuButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const section = parts[1];

  if (section === 'nav') {
    const target = parts[2];
    if (target === 'self_roles') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'rolePanels', '自助身份组');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return true;
      }
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'self_roles' }));
      return true;
    }

    if (
      target === 'admin_lvl_rewards' ||
      target === 'admin_roles' ||
      target === 'admin_shop'
    ) {
      if (!actor.isAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
        );
        return true;
      }
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: target }));
      return true;
    }
    return false;
  }

  if (section === 'admin') {
    const action = parts[2];
    const handledActions = new Set([
      'toggle_announce_channel',
      'toggle_stack_roles',
      'toggle_stack_roles_rewards',
      'rp_send',
      'rp_toggle_display',
      'rp_toggle_mode',
      'rp_delete',
      'reset_credit_rpg',
    ]);
    if (!action || !handledActions.has(action)) {
      return false;
    }

    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (action === 'reset_credit_rpg') {
      ctx.repos.guildConfig.updateCreditLoan(guildId, { ...DEFAULT_CREDIT_LOAN_CONFIG });
      ctx.repos.guildConfig.updateRpg(guildId, { ...DEFAULT_RPG_CONFIG });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_credit_rpg' },
          { type: 'success', text: '已将信用借贷、卖屁股与西幻 RPG 参数全部恢复为默认值！' },
        ),
      );
      return true;
    }

    if (action === 'toggle_announce_channel') {
      const nextChannelId = cfg.leveling.announceChannelId ? null : interaction.channelId;
      ctx.repos.guildConfig.updateLeveling(guildId, {
        ...cfg.leveling,
        announceChannelId: nextChannelId,
      });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl' },
          {
            type: 'success',
            text: nextChannelId
              ? `已将 <#${nextChannelId}> 设为统一升级播报频道。`
              : '已解绑固定播报频道，将在成员当前发言频道发送升级通知。',
          },
        ),
      );
      return true;
    }

    if (action === 'toggle_stack_roles' || action === 'toggle_stack_roles_rewards') {
      const nextStack = !cfg.leveling.stackRoles;
      ctx.repos.guildConfig.updateLeveling(guildId, {
        ...cfg.leveling,
        stackRoles: nextStack,
      });
      const returnPage = action === 'toggle_stack_roles_rewards' ? 'admin_lvl_rewards' : 'admin_lvl';
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: returnPage },
          {
            type: 'success',
            text: `身份组叠加模式已切换为：**${nextStack ? '保留旧等级身份组' : '仅保留最高等级身份组'}**。`,
          },
        ),
      );
      return true;
    }

    const panelId = parsePositiveInt(parts[3] ?? '');
    if (!panelId) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles' },
          { type: 'error', text: '无效的身份组面板编号。' },
        ),
      );
      return true;
    }

    if (action === 'rp_send') {
      const data = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
      if (!data) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_roles' },
            { type: 'error', text: `面板 #${panelId} 不存在或已被删除。` },
          ),
        );
        return true;
      }
      if (data.options.length === 0) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_roles', panelId },
            { type: 'error', text: '请先添加至少 1 个身份组选项后再发送到频道。' },
          ),
        );
        return true;
      }

      const payload = buildRolePanelMessage(data.panel, data.options);
      const sent = await sendPublicBroadcast(interaction, payload);
      if (!sent.sent || !sent.messageId) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_roles', panelId },
            { type: 'error', text: '在当前频道发布面板失败，请检查机器人发言与嵌入链接权限。' },
          ),
        );
        return true;
      }

      if (interaction.channelId) {
        ctx.services.rolePanel.setPanelMessage(panelId, interaction.channelId, sent.messageId);
      }
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles', panelId },
          { type: 'success', text: `已将自助身份组面板 **#${panelId}** 发布到当前频道！` },
        ),
      );
      return true;
    }

    if (action === 'rp_toggle_display' || action === 'rp_toggle_mode') {
      const data = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
      if (!data) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_roles' },
            { type: 'error', text: `面板 #${panelId} 不存在。` },
          ),
        );
        return true;
      }

      const nextDisplay =
        action === 'rp_toggle_display'
          ? data.panel.displayMode === 'button'
            ? 'select'
            : 'button'
          : data.panel.displayMode;
      const nextSelection =
        action === 'rp_toggle_mode'
          ? data.panel.selectionMode === 'single'
            ? 'multi'
            : 'single'
          : data.panel.selectionMode;

      ctx.services.rolePanel.updatePanelModes(guildId, panelId, nextDisplay, nextSelection);
      const feedbackText =
        action === 'rp_toggle_display'
          ? `频道展示样式已切换为：**${nextDisplay === 'button' ? '按钮点击' : '下拉菜单'}**。`
          : `选择模式已切换为：**${nextSelection === 'single' ? '单选互斥' : '自由多选'}**。`;

      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles', panelId },
          { type: 'success', text: feedbackText },
        ),
      );
      return true;
    }

    if (action === 'rp_delete') {
      const deleted = ctx.services.rolePanel.deletePanel(guildId, panelId);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles' },
          deleted
            ? { type: 'success', text: `已删除身份组面板 **#${panelId}**。` }
            : { type: 'error', text: `未找到面板 **#${panelId}**。` },
        ),
      );
      return true;
    }
  }

  if (section === 'modal') {
    const modalType = parts[2];

    if (modalType === 'edit_card') {
      const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
      await interaction.showModal(buildEditCardModal(profile));
      return true;
    }

    if (modalType === 'admin_lvl_msg' || modalType === 'admin_rp_create') {
      if (!actor.isAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
        );
        return true;
      }

      if (modalType === 'admin_lvl_msg') {
        const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
        await interaction.showModal(
          buildLevelMsgModal(cfg.leveling.levelUpTitle, cfg.leveling.levelUpTemplate),
        );
        return true;
      }

      await interaction.showModal(buildCreateRolePanelModal());
      return true;
    }

    const shopModalTypes = new Set([
      'admin_shop_title',
      'admin_shop_boost',
      'admin_shop_stat',
      'admin_shop_pet',
      'admin_shop_special',
    ]);
    if (modalType && shopModalTypes.has(modalType)) {
      if (!actor.isAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
        );
        return true;
      }
      await interaction.showModal(buildShopCreateModal(modalType, ctx, guildId));
      return true;
    }

    if (
      modalType === 'admin_cl_loan' ||
      modalType === 'admin_cl_hustle' ||
      modalType === 'admin_rpg_cfg'
    ) {
      if (!actor.isAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
        );
        return true;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      if (modalType === 'admin_cl_loan') {
        const cl = cfg.creditLoan;
        const modal = new ModalBuilder()
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
        await interaction.showModal(modal);
        return true;
      }

      if (modalType === 'admin_cl_hustle') {
        const cl = cfg.creditLoan;
        const modal = new ModalBuilder()
          .setCustomId('menu:modal_sub:admin_cl_hustle')
          .setTitle(truncateText('🍑 编辑卖屁股与信用互评参数', 45))
          .addComponents(
            prefilledField('hustleCooldownSec', '卖屁股冷却秒数（60 ~ 604800）', cl.hustleCooldownSec, 10),
            prefilledField('hustleMinMultiplier', '收益下限倍率（1 ~ 20）', cl.hustleMinMultiplier, 8),
            prefilledField('hustleMaxMultiplier', '收益上限倍率（1 ~ 50）', cl.hustleMaxMultiplier, 8),
            prefilledField('hustleCreditPenalty', '每次卖屁股信用扣分（0 ~ 100）', cl.hustleCreditPenalty, 6),
            prefilledField('dailyReviewLimit', '每人每日评价上限（1 ~ 20）', cl.dailyReviewLimit, 6),
          );
        await interaction.showModal(modal);
        return true;
      }

      const rpg = cfg.rpg;
      const modal = new ModalBuilder()
        .setCustomId('menu:modal_sub:admin_rpg_cfg')
        .setTitle(truncateText('⚔️ 编辑西幻 RPG 地牢参数', 45))
        .addComponents(
          prefilledField('dailyStamina', '每日免费体力（1 ~ 50）', rpg.dailyStamina, 6),
          prefilledField('staminaPotionPrice', '体力药水售价（0 ~ 10000000）', rpg.staminaPotionPrice, 12),
          prefilledField('staminaPotionDailyLimit', '体力药水每日限购（0 ~ 20）', rpg.staminaPotionDailyLimit, 6),
          prefilledField('classSwitchCost', '职业转职费用（0 ~ 10000000）', rpg.classSwitchCost, 12),
          prefilledField('bagCapacity', '装备背包容量上限（10 ~ 200）', rpg.bagCapacity, 6),
        );
      await interaction.showModal(modal);
      return true;
    }
  }

  return false;
}

export async function tryHandleConfigMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const section = parts[1];
  const selected = interaction.values[0];

  if (section === 'admin_shop_del') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const itemId = parsePositiveInt(selected ?? '');
    if (!itemId) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_shop' },
          { type: 'error', text: '无效的商品编号。' },
        ),
      );
      return true;
    }
    const removed = ctx.services.shop.removeItem(guildId, itemId);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        removed
          ? { type: 'success', text: `🗑️ 已下架商店商品 **#${itemId}**。` }
          : { type: 'error', text: `未找到商品 **#${itemId}**。` },
      ),
    );
    return true;
  }

  if (section === 'admin_lvl_reward_del') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const level = parsePositiveInt(selected ?? '');
    if (!level) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl_rewards' },
          { type: 'error', text: '无效的等级参数。' },
        ),
      );
      return true;
    }
    const removed = ctx.repos.profile.removeLevelReward(guildId, level);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_lvl_rewards' },
        removed
          ? { type: 'success', text: `已移除 **Lv.${level}** 的升级身份组奖励。` }
          : { type: 'error', text: `未找到 Lv.${level} 的奖励记录。` },
      ),
    );
    return true;
  }

  if (section === 'admin_rp_select') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const panelId = parsePositiveInt(selected ?? '');
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'admin_roles', panelId: panelId ?? undefined }),
    );
    return true;
  }

  if (section === 'admin_rp_del_opt') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const panelId = parsePositiveInt(parts[2] ?? '');
    if (!panelId || !selected) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles' },
          { type: 'error', text: '无效的面板或身份组选项。' },
        ),
      );
      return true;
    }
    const removed = ctx.services.rolePanel.removeOption(guildId, panelId, selected);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId },
        removed
          ? { type: 'success', text: `已从面板 **#${panelId}** 移除 <@&${selected}>。` }
          : { type: 'error', text: `面板 **#${panelId}** 中未找到该身份组选项。` },
      ),
    );
    return true;
  }

  if (section === 'self_rp_select') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'rolePanels', '自助身份组');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    const panelId = parsePositiveInt(selected ?? '');
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'self_roles', panelId: panelId ?? undefined }),
    );
    return true;
  }

  if (section === 'self_role_pick') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'rolePanels', '自助身份组');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }

    const panelId = parsePositiveInt(parts[2] ?? '');
    if (!panelId || !interaction.inCachedGuild()) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'self_roles' },
          { type: 'error', text: '无法识别身份组面板或服务器成员上下文。' },
        ),
      );
      return true;
    }

    const data = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
    if (!data) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'self_roles' },
          { type: 'error', text: '该自助身份组面板已被管理员删除。' },
        ),
      );
      return true;
    }

    const panelRoleIds = data.options.map((o) => o.roleId);
    const currentRoles = [...interaction.member.roles.cache.keys()];
    const diff = computeRoleDiff(
      panelRoleIds,
      currentRoles,
      interaction.values,
      'select',
      data.panel.selectionMode,
    );

    try {
      if (diff.toRemove.length > 0) {
        await interaction.member.roles.remove(diff.toRemove, `菜单自助身份组 #${panelId}`);
      }
      if (diff.toAdd.length > 0) {
        await interaction.member.roles.add(diff.toAdd, `菜单自助身份组 #${panelId}`);
      }
    } catch {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'self_roles', panelId },
          {
            type: 'error',
            text: '身份组更新失败：机器人缺少「管理身份组」权限，或 Bot 身份组排序低于目标身份组。',
          },
        ),
      );
      return true;
    }

    const removeSet = new Set(diff.toRemove);
    const nextRoleIds = [
      ...new Set([...currentRoles.filter((id) => !removeSet.has(id)), ...diff.toAdd]),
    ];
    const nextActor: MenuActor = { ...actor, roleIds: nextRoleIds };

    const changeParts: string[] = [];
    if (diff.toAdd.length > 0) {
      changeParts.push(`✅ 已领取：${diff.toAdd.map((r) => `<@&${r}>`).join('、')}`);
    }
    if (diff.toRemove.length > 0) {
      changeParts.push(`➖ 已移除：${diff.toRemove.map((r) => `<@&${r}>`).join('、')}`);
    }
    const feedback: MenuFeedback =
      changeParts.length > 0
        ? { type: 'success', text: changeParts.join('\n') }
        : { type: 'info', text: '你的身份组配置未发生变更。' };

    await interaction.update(
      buildMenuMessage(ctx, guildId, nextActor, { page: 'self_roles', panelId }, feedback),
    );
    return true;
  }

  return false;
}

export async function tryHandleConfigMenuRoleSelect(
  interaction: RoleSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const actionType = parts[2];
  if (
    actionType !== 'admin_lvl_reward_add' &&
    actionType !== 'admin_rp_add' &&
    actionType !== 'admin_shop_add_role'
  ) {
    return false;
  }

  if (!actor.isAdmin) {
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  const roleId = interaction.values[0];
  if (!roleId) return true;
  const selectedRole = interaction.roles.get(roleId);

  if (actionType === 'admin_shop_add_role') {
    if (roleId === guildId || selectedRole?.managed) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_shop' },
          { type: 'error', text: '不能将 `@everyone` 或机器人/系统托管身份组上架到商店。' },
        ),
      );
      return true;
    }
    const defaultName = selectedRole?.name ? `身份组：${selectedRole.name}` : '';
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`menu:modal_sub:admin_shop_role:${roleId}`)
        .setTitle('✨ 上架身份组商品')
        .addComponents(
          reqInput('name', '商品名称（1~40字）', '例如：✨ 身份组：夜店霓虹王', 40, defaultName),
          reqInput('price', '售价（整数 >= 0）', '例如：15000', 12),
          optionalInput({
            customId: 'description',
            label: '商品简介（可留空）',
            placeholder: '购买后自动发放该身份组',
            maxLength: 80,
          }),
          optionalInput({
            customId: 'stock',
            label: '限量库存（正整数，留空为无限）',
            placeholder: '例如：5',
            maxLength: 8,
          }),
        ),
    );
    return true;
  }

  if (actionType === 'admin_lvl_reward_add') {
    if (roleId === guildId || selectedRole?.managed) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl_rewards' },
          { type: 'error', text: '不能将 `@everyone` 或机器人/系统托管身份组设为升级奖励。' },
        ),
      );
      return true;
    }

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`menu:modal_sub:admin_lvl_reward_add:${roleId}`)
        .setTitle('🎖️ 设置升级奖励等级')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('level')
              .setLabel('达到多少级自动发放（1 ~ 200）')
              .setStyle(TextInputStyle.Short)
              .setMinLength(1)
              .setMaxLength(4)
              .setPlaceholder('例如：5')
              .setRequired(true),
          ),
        ),
    );
    return true;
  }

  const panelId = parsePositiveInt(parts[3] ?? '');
  if (!panelId) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles' },
        { type: 'error', text: '无效的身份组面板编号。' },
      ),
    );
    return true;
  }

  if (roleId === guildId || selectedRole?.managed) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId },
        { type: 'error', text: '不能将 `@everyone` 或机器人/系统托管身份组添加到自助面板。' },
      ),
    );
    return true;
  }

  const data = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
  if (!data) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles' },
        { type: 'error', text: `未找到面板 **#${panelId}**。` },
      ),
    );
    return true;
  }
  if (data.options.length >= 25) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId },
        { type: 'error', text: '单个面板最多支持 25 个身份组选项。' },
      ),
    );
    return true;
  }
  if (data.options.some((o) => o.roleId === roleId)) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId },
        { type: 'error', text: `面板中已存在 <@&${roleId}>。` },
      ),
    );
    return true;
  }

  await interaction.showModal(buildAddRoleOptionModal(panelId, roleId, selectedRole?.name));
  return true;
}

export async function tryHandleConfigMenuModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const modalType = parts[2];

  if (
    modalType === 'admin_cl_loan' ||
    modalType === 'admin_cl_hustle' ||
    modalType === 'admin_rpg_cfg'
  ) {
    if (!actor.isAdmin) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (modalType === 'admin_cl_loan') {
      const bankLoanMaxCap = parseIntInRange(
        interaction.fields.getTextInputValue('bankLoanMaxCap'),
        1_000,
        1_000_000_000,
      );
      const usuryLoanMax = parseIntInRange(
        interaction.fields.getTextInputValue('usuryLoanMax'),
        1_000,
        1_000_000_000,
      );
      const usuryDailyRatePct = parseNumberInRange(
        interaction.fields.getTextInputValue('usuryDailyRatePct'),
        1,
        100,
      );
      const usuryTermDays = parseIntInRange(
        interaction.fields.getTextInputValue('usuryTermDays'),
        1,
        30,
      );
      const garnishRatePct = parseNumberInRange(
        interaction.fields.getTextInputValue('garnishRatePct'),
        10,
        100,
      );
      if (
        bankLoanMaxCap === null ||
        usuryLoanMax === null ||
        usuryDailyRatePct === null ||
        usuryTermDays === null ||
        garnishRatePct === null
      ) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_credit_rpg' },
            { type: 'error', text: '参数格式或范围无效，请检查各栏数值要求后重试。' },
          ),
        );
        return true;
      }

      ctx.repos.guildConfig.updateCreditLoan(guildId, {
        ...cfg.creditLoan,
        bankLoanMaxCap,
        usuryLoanMax,
        usuryDailyRate: Number((usuryDailyRatePct / 100).toFixed(4)),
        usuryTermDays,
        garnishRate: Number((garnishRatePct / 100).toFixed(4)),
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_credit_rpg' },
          { type: 'success', text: '已保存银行贷款、高利贷与逾期强扣参数！' },
        ),
      );
      return true;
    }

    if (modalType === 'admin_cl_hustle') {
      const hustleCooldownSec = parseIntInRange(
        interaction.fields.getTextInputValue('hustleCooldownSec'),
        60,
        604_800,
      );
      const hustleMinMultiplier = parseNumberInRange(
        interaction.fields.getTextInputValue('hustleMinMultiplier'),
        1,
        20,
      );
      const hustleMaxMultiplier = parseNumberInRange(
        interaction.fields.getTextInputValue('hustleMaxMultiplier'),
        1,
        50,
      );
      const hustleCreditPenalty = parseIntInRange(
        interaction.fields.getTextInputValue('hustleCreditPenalty'),
        0,
        100,
      );
      const dailyReviewLimit = parseIntInRange(
        interaction.fields.getTextInputValue('dailyReviewLimit'),
        1,
        20,
      );
      if (
        hustleCooldownSec === null ||
        hustleMinMultiplier === null ||
        hustleMaxMultiplier === null ||
        hustleCreditPenalty === null ||
        dailyReviewLimit === null ||
        hustleMaxMultiplier < hustleMinMultiplier
      ) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_credit_rpg' },
            { type: 'error', text: '卖屁股/评价参数无效（上限倍率须 >= 下限倍率）。' },
          ),
        );
        return true;
      }

      ctx.repos.guildConfig.updateCreditLoan(guildId, {
        ...cfg.creditLoan,
        hustleCooldownSec,
        hustleMinMultiplier,
        hustleMaxMultiplier,
        hustleCreditPenalty,
        dailyReviewLimit,
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_credit_rpg' },
          { type: 'success', text: '已保存卖屁股与信用互评参数！' },
        ),
      );
      return true;
    }

    const dailyStamina = parseIntInRange(
      interaction.fields.getTextInputValue('dailyStamina'),
      1,
      50,
    );
    const staminaPotionPrice = parseIntInRange(
      interaction.fields.getTextInputValue('staminaPotionPrice'),
      0,
      10_000_000,
    );
    const staminaPotionDailyLimit = parseIntInRange(
      interaction.fields.getTextInputValue('staminaPotionDailyLimit'),
      0,
      20,
    );
    const classSwitchCost = parseIntInRange(
      interaction.fields.getTextInputValue('classSwitchCost'),
      0,
      10_000_000,
    );
    const bagCapacity = parseIntInRange(
      interaction.fields.getTextInputValue('bagCapacity'),
      10,
      200,
    );
    if (
      dailyStamina === null ||
      staminaPotionPrice === null ||
      staminaPotionDailyLimit === null ||
      classSwitchCost === null ||
      bagCapacity === null
    ) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_credit_rpg' },
          { type: 'error', text: '西幻 RPG 参数格式或范围无效，请检查后重试。' },
        ),
      );
      return true;
    }

    ctx.repos.guildConfig.updateRpg(guildId, {
      ...cfg.rpg,
      dailyStamina,
      staminaPotionPrice,
      staminaPotionDailyLimit,
      classSwitchCost,
      bagCapacity,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_credit_rpg' },
        { type: 'success', text: '已保存西幻 RPG 地牢参数！' },
      ),
    );
    return true;
  }

  if (modalType === 'edit_card') {
    const rawNickname = interaction.fields.getTextInputValue('cardNickname').trim();
    const rawTag = interaction.fields.getTextInputValue('cardTag').trim();
    const rawBio = interaction.fields.getTextInputValue('cardBio').trim();
    const rawColor = interaction.fields.getTextInputValue('cardColor').trim();

    if (rawNickname.length > 24 || rawTag.length > 32 || rawBio.length > 80) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'rank' },
          { type: 'error', text: '输入超长：昵称限24字、标签限32字、签名限80字。' },
        ),
      );
      return true;
    }

    const parsedColor = parseCardColor(rawColor);
    if (!parsedColor.ok) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'rank' },
          {
            type: 'error',
            text: '主题色格式无效，请填常用色（红/橙/黄/绿/青/蓝/紫/粉/金/黑/白）或 6 位 HEX 色值（如 `#FF6B8B`），留空可恢复默认。',
          },
        ),
      );
      return true;
    }

    ctx.repos.profile.updateCard(guildId, actor.id, {
      cardNickname: rawNickname || null,
      cardTag: rawTag || null,
      cardBio: rawBio || null,
      cardColor: parsedColor.normalized,
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'rank' },
        { type: 'success', text: '🪪 个人身份证名片已更新！可点击「📢 晒出我的名片」向群友展示。' },
      ),
    );
    return true;
  }

  const adminModalTypes = new Set([
    'admin_lvl_msg',
    'admin_lvl_reward_add',
    'admin_rp_create',
    'admin_rp_add',
    'admin_shop_role',
    'admin_shop_title',
    'admin_shop_boost',
    'admin_shop_stat',
    'admin_shop_pet',
    'admin_shop_special',
  ]);
  if (!modalType || !adminModalTypes.has(modalType)) {
    return false;
  }

  if (!actor.isAdmin) {
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  if (modalType === 'admin_lvl_msg') {
    const levelUpTitle = interaction.fields.getTextInputValue('levelUpTitle').trim();
    const levelUpTemplate = interaction.fields.getTextInputValue('levelUpTemplate').trim();

    if (
      levelUpTitle.length < 1 ||
      levelUpTitle.length > 60 ||
      levelUpTemplate.length < 1 ||
      levelUpTemplate.length > 400
    ) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl' },
          { type: 'error', text: '升级播报标题需 1~60 字，提示语模板需 1~400 字。' },
        ),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    ctx.repos.guildConfig.updateLeveling(guildId, {
      ...cfg.leveling,
      levelUpTitle,
      levelUpTemplate,
    });

    const preview = renderLevelUpTemplate(levelUpTemplate, {
      user: `<@${actor.id}>`,
      username: actor.displayName,
      level: 5,
      oldLevel: 4,
      coins: cfg.leveling.levelUpCoinReward,
      currency: cfg.economy.currencyName,
      roles: '@示例身份组',
      stat: 18,
      statGained: 2,
      statUnit: cfg.leveling.statUnit,
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_lvl' },
        { type: 'success', text: `✅ 升级提示语已保存！\n效果预览：${preview}` },
      ),
    );
    return true;
  }

  if (modalType === 'admin_lvl_reward_add') {
    const roleId = parts[3];
    const level = parseIntInRange(interaction.fields.getTextInputValue('level'), 1, 200);
    if (!roleId || level === null) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl_rewards' },
          { type: 'error', text: '等级无效，请输入 1 ~ 200 之间的整数。' },
        ),
      );
      return true;
    }

    ctx.repos.profile.setLevelReward(guildId, level, roleId);
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_lvl_rewards' },
        { type: 'success', text: `✅ 已设置：**Lv.${level}** 将自动发放 <@&${roleId}>。` },
      ),
    );
    return true;
  }

  if (modalType === 'admin_rp_create') {
    const title = interaction.fields.getTextInputValue('title').trim();
    const rawDesc = interaction.fields.getTextInputValue('description').trim();
    const rawSelection = interaction.fields.getTextInputValue('selectionMode').trim().toLowerCase();
    const rawDisplay = interaction.fields.getTextInputValue('displayMode').trim().toLowerCase();

    if (title.length < 1 || title.length > 80) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles' },
          { type: 'error', text: '面板标题需在 1 ~ 80 字之间。' },
        ),
      );
      return true;
    }

    const selectionMode =
      rawSelection === 'single' || rawSelection.includes('单选') ? 'single' : 'multi';
    const displayMode =
      rawDisplay === 'select' || rawDisplay.includes('菜单') || rawDisplay.includes('下拉')
        ? 'select'
        : 'button';
    const description =
      rawDesc || '点击下方选项即可自助领取或取消对应身份组。';

    const created = ctx.services.rolePanel.createPanel({
      guildId,
      title,
      description,
      displayMode,
      selectionMode,
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId: created.id },
        {
          type: 'success',
          text: `✅ 已创建身份组面板 **#${created.id} ${created.title}**！请用下方身份组选择器添加选项。`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_rp_add') {
    const panelId = parsePositiveInt(parts[3] ?? '');
    const roleId = parts[4];
    const label = interaction.fields.getTextInputValue('label').trim();
    const emoji = interaction.fields.getTextInputValue('emoji').trim() || null;
    const description = interaction.fields.getTextInputValue('description').trim() || null;

    if (!panelId || !roleId || label.length < 1 || label.length > 80) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles', panelId: panelId ?? undefined },
          { type: 'error', text: '显示文字需在 1 ~ 80 字之间。' },
        ),
      );
      return true;
    }

    const res = ctx.services.rolePanel.addOption(guildId, panelId, {
      roleId,
      label,
      emoji,
      description,
    });
    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        panel_not_found: `未找到面板 **#${panelId}**。`,
        limit_reached: '单个面板最多支持 25 个身份组选项。',
        duplicate_role: `面板中已存在 <@&${roleId}>。`,
      };
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles', panelId },
          { type: 'error', text: msgMap[res.reason] },
        ),
      );
      return true;
    }

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId },
        {
          type: 'success',
          text: `✅ 已将 <@&${roleId}>（${emoji ? `${emoji} ` : ''}${label}）添加到面板 **#${panelId}**！`,
        },
      ),
    );
    return true;
  }

  if (modalType.startsWith('admin_shop_')) {
    return handleAdminShopModal(interaction, ctx, guildId, actor, modalType, parts);
  }

  return false;
}

function readOptionalModalField(interaction: ModalSubmitInteraction, customId: string): string {
  try {
    return interaction.fields.getTextInputValue(customId).trim();
  } catch {
    return '';
  }
}

async function handleAdminShopModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  modalType: string,
  parts: readonly string[],
): Promise<boolean> {
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const econCfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;

  const fail = async (text: string): Promise<boolean> => {
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'admin_shop' }, { type: 'error', text }),
    );
    return true;
  };

  const name = interaction.fields.getTextInputValue('name').trim();
  const price = parseIntInRange(interaction.fields.getTextInputValue('price'), 0, 10_000_000);
  if (name.length < 1 || name.length > 40 || price === null) {
    return fail('商品名称需 1~40 字，售价需为 0 ~ 10,000,000 之间的整数。');
  }

  const description = readOptionalModalField(interaction, 'description');

  let stock: number | null = null;
  const rawStock = readOptionalModalField(interaction, 'stock');
  if (rawStock.length > 0) {
    const parsedStock = parseIntInRange(rawStock, 1, 100_000);
    if (parsedStock === null) {
      return fail('限量库存必须为 1 ~ 100,000 的正整数（留空表示无限）。');
    }
    stock = parsedStock;
  }

  if (modalType === 'admin_shop_role') {
    const roleId = parts[3];
    if (!roleId) {
      return fail('未指定有效身份组。');
    }
    const created = ctx.services.shop.createRoleItem({
      guildId,
      name,
      description,
      price,
      roleId,
      stock,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        {
          type: 'success',
          text: `✅ 已上架身份组商品 **#${created.id} ${created.name}** → <@&${roleId}>（${price} ${econCfg.currencyName}）！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_shop_title') {
    const titleText = interaction.fields.getTextInputValue('titleText').trim();
    if (titleText.length < 1 || titleText.length > 20) {
      return fail('佩戴称号文本需在 1 ~ 20 字之间。');
    }
    const created = ctx.services.shop.createTitleItem({
      guildId,
      name,
      description,
      price,
      titleText,
      stock,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        {
          type: 'success',
          text: `✅ 已上架称号商品 **#${created.id} ${created.name}** → 「${titleText}」（${price} ${econCfg.currencyName}）！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_shop_boost') {
    const multNum = Number(interaction.fields.getTextInputValue('multiplier').trim());
    const durationMin = parseIntInRange(interaction.fields.getTextInputValue('durationMin'), 5, 10_080);
    if (!Number.isFinite(multNum) || multNum < 1.1 || multNum > 5.0 || durationMin === null) {
      return fail('经验倍率需在 1.1 ~ 5.0 之间，持续分钟数需为 5 ~ 10080 的整数。');
    }
    const multiplier = Math.round(multNum * 100) / 100;
    const created = ctx.services.shop.createBoostItem({
      guildId,
      name,
      description,
      price,
      boostMultiplier: multiplier,
      boostDurationSec: durationMin * 60,
      stock,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        {
          type: 'success',
          text: `✅ 已上架经验卡 **#${created.id} ${created.name}**（${multiplier}x · ${durationMin}分钟）！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_shop_stat') {
    const minGain = parseIntInRange(interaction.fields.getTextInputValue('minGain'), 1, 1000);
    const maxGain = parseIntInRange(interaction.fields.getTextInputValue('maxGain'), 1, 1000);
    if (minGain === null || maxGain === null || maxGain < minGain) {
      return fail('最小/最大增量需为 1 ~ 1000 的整数，且最大增量不能小于最小增量。');
    }
    const created = ctx.services.shop.createStatBoostItem({
      guildId,
      name,
      description,
      price,
      minGain,
      maxGain,
      stock,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        {
          type: 'success',
          text: `✅ 已上架成长道具 **#${created.id} ${created.name}**（${lvlCfg.statName} +${minGain}~${maxGain} ${lvlCfg.statUnit}）！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_shop_pet') {
    const petXp = parseIntInRange(interaction.fields.getTextInputValue('petXp'), 10, 10_000);
    if (petXp === null) {
      return fail('宠物经验值需为 10 ~ 10,000 之间的整数。');
    }
    const created = ctx.services.shop.createPetXpItem({
      guildId,
      name,
      description,
      price,
      petXp,
      stock,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        {
          type: 'success',
          text: `✅ 已上架宠物经验道具 **#${created.id} ${created.name}**（+${petXp} XP）！`,
        },
      ),
    );
    return true;
  }

  const rawKind = interaction.fields.getTextInputValue('kind').trim().toLowerCase();
  const isCustomTitle =
    rawKind.includes('称号') || rawKind === 'custom_title' || rawKind === 'title';

  const created = isCustomTitle
    ? ctx.services.shop.createCustomTitleItem({ guildId, name, description, price, stock })
    : ctx.services.shop.createMysteryBoxItem({ guildId, name, description, price, stock });

  await respondFromModal(
    interaction,
    buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'admin_shop' },
      {
        type: 'success',
        text: `✅ 已上架${isCustomTitle ? '自定义称号券' : '神秘盲盒'} **#${created.id} ${created.name}**（${price} ${econCfg.currencyName}）！`,
      },
    ),
  );
  return true;
}

export { DEFAULT_LEVELING_CONFIG };
