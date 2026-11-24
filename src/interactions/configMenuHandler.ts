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
import { DEFAULT_LEVELING_CONFIG } from '../config/defaults.js';
import { parseCardColor, renderLevelUpTemplate } from '../services/levelingService.js';
import { computeRoleDiff } from '../services/rolePanelService.js';
import type { AppContext } from '../ui/embeds.js';
import { buildMenuMessage } from '../ui/menuBuilder.js';
import { truncateText, type MenuActor, type MenuFeedback } from '../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  parseIntInRange,
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
          .setPlaceholder('可用变量：{user} {username} {level} {oldLevel} {coins} {currency} {roles}')
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

    if (target === 'admin_lvl_rewards' || target === 'admin_roles') {
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
  if (actionType !== 'admin_lvl_reward_add' && actionType !== 'admin_rp_add') {
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

  return false;
}

export { DEFAULT_LEVELING_CONFIG };
