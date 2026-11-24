import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { COLORS, type AppContext } from './embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
} from './menuShared.js';

export function buildAdminLvlRewardsView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const rewards = ctx.repos.profile.listLevelRewards(guildId);
  const rewardLines =
    rewards.length > 0
      ? rewards.map((r) => `• **Lv.${r.level}** → <@&${r.roleId}>`)
      : ['暂未配置任何等级奖励身份组。'];

  const description = [
    '从下方身份组选择器选一个身份组，即可填写对应等级并绑定为**升级自动发放奖励**；若该等级已有奖励将自动覆盖。',
    '',
    `🏷️ **身份组发放模式**：${cfg.leveling.stackRoles ? '✅ 叠加保留旧等级身份组' : '🔄 仅保留最高等级身份组'}`,
    '',
    '🎖️ **当前已配置奖励**：',
    ...rewardLines,
    '',
    '⚠️ 请确保服务器设置中 Bot 身份组排序高于目标奖励身份组，否则无法自动发放。',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 升级奖励身份组`, iconURL: actor.avatarUrl })
    .setTitle('🎖️ 升级奖励身份组管理')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 选择身份组后会弹出等级输入框（支持 Lv.1 ~ Lv.200）' })
    .setTimestamp();

  const components: MenuComponentRow[] = [
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('menu:role:admin_lvl_reward_add')
        .setPlaceholder('➕ 选择一个身份组，绑定为升级奖励...')
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];

  if (rewards.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('menu:admin_lvl_reward_del')
          .setPlaceholder('🗑️ 选择要移除的等级奖励...')
          .addOptions(
            rewards.slice(0, 25).map((r) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`Lv.${r.level} 奖励`)
                .setValue(String(r.level))
                .setDescription(`移除 Lv.${r.level} 的升级身份组奖励`),
            ),
          ),
      ),
    );
  }

  components.push(
    buttonRow(
      makeButton(
        'menu:admin:toggle_stack_roles_rewards',
        `🏷️ 叠加身份组: ${cfg.leveling.stackRoles ? '保留旧组' : '仅留最高'}`,
        cfg.leveling.stackRoles ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
      makeButton('menu:nav:admin_lvl', '⬅️ 等级设置', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

export function buildAdminRolesView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  selectedPanelId: number | undefined,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const panels = ctx.services.rolePanel.listPanels(guildId);
  const activePanel =
    (selectedPanelId !== undefined
      ? panels.find((p) => p.id === selectedPanelId)
      : undefined) ??
    panels[0] ??
    null;

  if (!activePanel) {
    const embed = new EmbedBuilder()
      .setColor(resolveColor(COLORS.PRIMARY, feedback))
      .setAuthor({ name: `${actor.displayName} · 自助身份组管理`, iconURL: actor.avatarUrl })
      .setTitle('🎭 自助身份组面板管理')
      .setDescription(
        withFeedback(
          [
            '当前服务器还没有创建任何自助身份组面板。',
            '',
            '点击下方「➕ 新建身份组面板」即可在菜单内创建面板、添加身份组选项，并一键发布到频道或直接在 `/菜单` 中供群友自选！',
          ].join('\n'),
          feedback,
        ),
      )
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton('menu:modal:admin_rp_create', '➕ 新建身份组面板', ButtonStyle.Success),
          makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
          makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
        ),
      ],
    };
  }

  const options = ctx.repos.rolePanel.listOptions(activePanel.id);
  const optionLines =
    options.length > 0
      ? options.map(
          (o, idx) =>
            `${idx + 1}. ${o.emoji ? `${o.emoji} ` : ''}<@&${o.roleId}> — **${o.label}**${o.description ? `（${o.description}）` : ''}`,
        )
      : ['暂未添加任何身份组选项，请使用下方身份组选择器添加（最多 25 个）。'];

  const description = [
    `当前管理面板：**#${activePanel.id} ${activePanel.title}**（共 ${panels.length} 个面板）`,
    `说明：${activePanel.description}`,
    `样式：**${activePanel.displayMode === 'button' ? '按钮点击' : '下拉菜单'}** ｜ 模式：**${activePanel.selectionMode === 'single' ? '单选互斥' : '自由多选'}** ｜ 已发布：${activePanel.channelId ? `<#${activePanel.channelId}>` : '未发布到频道'}`,
    '',
    '📋 **面板选项列表**：',
    ...optionLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 自助身份组管理`, iconURL: actor.avatarUrl })
    .setTitle('🎭 自助身份组面板管理')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 添加选项后既可直接发到当前频道，群友也能在菜单「🎭 自助身份组」直接领取' })
    .setTimestamp();

  const components: MenuComponentRow[] = [];

  if (panels.length > 1) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('menu:admin_rp_select')
          .setPlaceholder('📑 切换要管理的身份组面板...')
          .addOptions(
            panels.slice(0, 25).map((p) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(`#${p.id} ${p.title}`, 100))
                .setValue(String(p.id))
                .setDescription(
                  `${p.displayMode === 'button' ? '按钮' : '菜单'} / ${p.selectionMode === 'single' ? '单选' : '多选'}`,
                )
                .setDefault(p.id === activePanel.id),
            ),
          ),
      ),
    );
  }

  components.push(
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`menu:role:admin_rp_add:${activePanel.id}`)
        .setPlaceholder('➕ 选择一个身份组添加到当前面板...')
        .setMinValues(1)
        .setMaxValues(1),
    ),
  );

  if (options.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`menu:admin_rp_del_opt:${activePanel.id}`)
          .setPlaceholder('🗑️ 从当前面板移除一个身份组选项...')
          .addOptions(
            options.slice(0, 25).map((o) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(`${o.emoji ? `${o.emoji} ` : ''}${o.label}`, 100))
                .setValue(o.roleId)
                .setDescription('点击从当前面板移除该身份组选项'),
            ),
          ),
      ),
    );
  }

  components.push(
    buttonRow(
      makeButton('menu:modal:admin_rp_create', '➕ 新建面板', ButtonStyle.Success),
      makeButton(
        `menu:admin:rp_send:${activePanel.id}`,
        '📤 发到本频道',
        ButtonStyle.Primary,
        options.length === 0,
      ),
      makeButton(
        `menu:admin:rp_toggle_display:${activePanel.id}`,
        `样式: ${activePanel.displayMode === 'button' ? '按钮' : '菜单'}`,
        ButtonStyle.Secondary,
      ),
      makeButton(
        `menu:admin:rp_toggle_mode:${activePanel.id}`,
        `模式: ${activePanel.selectionMode === 'single' ? '单选' : '多选'}`,
        ButtonStyle.Secondary,
      ),
      makeButton(`menu:admin:rp_delete:${activePanel.id}`, '🗑️ 删除面板', ButtonStyle.Danger),
    ),
    buttonRow(
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

export function buildSelfRolesView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  selectedPanelId: number | undefined,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const panels = ctx.services.rolePanel.listPanels(guildId);
  const activePanel =
    (selectedPanelId !== undefined
      ? panels.find((p) => p.id === selectedPanelId)
      : undefined) ??
    panels[0] ??
    null;

  if (!activePanel) {
    const embed = new EmbedBuilder()
      .setColor(resolveColor(COLORS.PRIMARY, feedback))
      .setAuthor({ name: `${actor.displayName} · 自助身份组`, iconURL: actor.avatarUrl })
      .setTitle('🎭 自助身份组领取')
      .setDescription(
        withFeedback(
          '管理员暂未配置自助身份组面板。\n管理员可通过「⚙️ 管理后台 → 🎭 自助身份组」或 `/身份组面板 创建` 快速配置。',
          feedback,
        ),
      )
      .setTimestamp();

    const buttons = [
      makeButton('menu:nav:rank', '🪪 我的名片', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ];
    if (actor.isAdmin) {
      buttons.push(makeButton('menu:nav:admin_roles', '⚙️ 去配置面板', ButtonStyle.Primary));
    }
    return { embeds: [embed], components: [buttonRow(...buttons)] };
  }

  const options = ctx.repos.rolePanel.listOptions(activePanel.id);
  const ownedSet = new Set(actor.roleIds ?? []);
  const optionLines =
    options.length > 0
      ? options.map(
          (o) =>
            `${ownedSet.has(o.roleId) ? '✅' : '⬜'} ${o.emoji ? `${o.emoji} ` : ''}<@&${o.roleId}> — **${o.label}**${o.description ? `（${o.description}）` : ''}`,
        )
      : ['该面板暂未添加任何可领取的身份组选项。'];

  const modeText = activePanel.selectionMode === 'single' ? '单选互斥' : '自由多选';
  const description = [
    `**${activePanel.title}**（${modeText}）`,
    activePanel.description,
    '',
    ...optionLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 自助身份组`, iconURL: actor.avatarUrl })
    .setTitle('🎭 自助身份组领取')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '提示：勾选保存即可立即佩戴/卸下对应身份组' })
    .setTimestamp();

  const components: MenuComponentRow[] = [];

  if (panels.length > 1) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('menu:self_rp_select')
          .setPlaceholder('📑 切换身份组面板...')
          .addOptions(
            panels.slice(0, 25).map((p) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(p.title, 100))
                .setValue(String(p.id))
                .setDescription(p.selectionMode === 'single' ? '单选互斥面板' : '自由多选面板')
                .setDefault(p.id === activePanel.id),
            ),
          ),
      ),
    );
  }

  if (options.length > 0) {
    const cappedOptions = options.slice(0, 25);
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`menu:self_role_pick:${activePanel.id}`)
          .setPlaceholder(
            activePanel.selectionMode === 'single'
              ? '选择一个身份组（单选，清空可卸下）...'
              : '勾选要保留或领取的身份组（可多选）...',
          )
          .setMinValues(0)
          .setMaxValues(activePanel.selectionMode === 'single' ? 1 : cappedOptions.length)
          .addOptions(
            cappedOptions.map((o) => {
              const opt = new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(`${o.emoji ? `${o.emoji} ` : ''}${o.label}`, 100))
                .setValue(o.roleId)
                .setDefault(ownedSet.has(o.roleId));
              if (o.description) {
                opt.setDescription(truncateText(o.description, 100));
              }
              return opt;
            }),
          ),
      ),
    );
  }

  const navButtons = [
    makeButton('menu:nav:rank', '🪪 我的名片', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  ];
  if (actor.isAdmin) {
    navButtons.push(makeButton('menu:nav:admin_roles', '⚙️ 管理面板', ButtonStyle.Primary));
  }
  components.push(buttonRow(...navButtons));

  return { embeds: [embed], components };
}
