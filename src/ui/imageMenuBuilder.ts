import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { ImageAspectRatio } from '../config/defaults.js';
import type { ImageGenerationRecord } from '../db/repositories/imageRepo.js';
import { COLORS, type AppContext } from './embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
} from './menuShared.js';

export const IMAGE_RATIO_CHOICES: ReadonlyArray<{
  value: ImageAspectRatio;
  label: string;
  description: string;
}> = [
  { value: '2:3', label: '📱 2:3 竖图（默认）', description: '适合人物立绘与角色半身/全身像' },
  { value: '3:2', label: '🖼️ 3:2 横图', description: '适合风景、多人同框与横版构图' },
  { value: '1:1', label: '🟦 1:1 方图', description: '适合头像、Q版与正方形构图' },
  { value: '9:16', label: '📲 9:16 手机竖屏', description: '适合竖屏壁纸与全身特写' },
  { value: '16:9', label: '🎬 16:9 宽屏横图', description: '适合大场景壁纸与电影级构图' },
];

export function buildImageLobbyMessage(guildName?: string): BuiltButtonMessage {
  const prefix = guildName ? `${guildName} · ` : '';
  const embed = new EmbedBuilder()
    .setColor(COLORS.FUN)
    .setTitle(`🎨 ${prefix}AI 独立绘图大厅`)
    .setDescription(
      [
        '点击下方按钮即可打开**仅你自己可见**的独立绘图工作台菜单，与 `@白虎姬` 聊天完全隔离！',
        '',
        '• 📐 **一键切比例**：2:3 竖图 / 3:2 横图 / 1:1 方图 / 9:16 竖屏 / 16:9 宽屏，自动记住个人偏好',
        '• 🙈 **私密 / 遮罩控制**：自由切换公屏发送或仅自己可见，支持剧透模糊遮罩',
        '• 📜 **历史一键复用**：随时从最近画过的作品下拉选中，直接改词或换比例重绘',
        '• ⚡ **快速指令**：也可随时输入 `/画图` 打开工作台，或直接填提示词一步出图',
      ].join('\n'),
    )
    .setFooter({ text: '提示：独立生图模型 · 点击按钮即可开启专属工作台' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(makeButton('img:open_workbench', '🎨 打开我的绘图菜单', ButtonStyle.Primary)),
    ],
  };
}

export interface BuiltImageResultMessage {
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  components: MenuComponentRow[];
}

export function buildImageResultMessage(params: {
  record: ImageGenerationRecord;
  buffer: Buffer;
  authorName: string;
  authorAvatarUrl?: string;
  translated: boolean;
  attempts: number;
}): BuiltImageResultMessage {
  const { record, buffer, authorName, authorAvatarUrl, translated } = params;
  const fileName = `nai-draw-${record.id}.png`;
  const attachment = new AttachmentBuilder(buffer, { name: fileName });
  if (record.spoiler) {
    attachment.setSpoiler(true);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.FUN)
    .setAuthor({
      name: `${authorName} 的独立绘图作品`,
      ...(authorAvatarUrl ? { iconURL: authorAvatarUrl } : {}),
    })
    .setTitle(`🎨 出图完成 #${record.id}${record.spoiler ? '（剧透遮罩）' : ''}`)
    .setDescription(
      [
        `📝 **原始提示词**：${truncateText(record.rawPrompt, 450)}`,
        ...(translated
          ? [`🔤 **直译提示词**：${truncateText(record.finalPrompt, 450)}`]
          : record.finalPrompt !== record.rawPrompt
            ? [`✨ **实际提示词**：${truncateText(record.finalPrompt, 450)}`]
            : []),
        ...(record.negativePrompt
          ? [`🚫 **负面词**：${truncateText(record.negativePrompt, 300)}`]
          : []),
      ].join('\n'),
    )
    .addFields(
      { name: '📐 比例', value: record.aspectRatio, inline: true },
      { name: '🎛️ 步数 / CFG', value: `${record.steps} / ${record.scale}`, inline: true },
      {
        name: '🎲 种子 / 耗时',
        value: `${record.seed !== null ? record.seed : '随机'} · ${(record.latencyMs / 1000).toFixed(1)}s`,
        inline: true,
      },
    )
    .setFooter({
      text: `模型: ${record.model} ｜ #${record.id}`,
    })
    .setTimestamp(record.createdAt);

  // Do not embed spoiler attachment directly so Discord blur mask stays active
  if (!record.spoiler) {
    embed.setImage(`attachment://${fileName}`);
  }

  const ratioRerollSelect = new StringSelectMenuBuilder()
    .setCustomId(`img:ratio_reroll:${record.id}`)
    .setPlaceholder(`📐 换个画幅比例直接重绘（当前 ${record.aspectRatio}）...`)
    .addOptions(
      IMAGE_RATIO_CHOICES.map((opt) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(opt.label)
          .setValue(opt.value)
          .setDescription(opt.description),
      ),
    );

  const buttons = [
    makeButton(`img:reroll:${record.id}`, '🔄 再画一张', ButtonStyle.Primary),
    makeButton(`img:edit:${record.id}`, '✏️ 改词/调参', ButtonStyle.Secondary),
    makeButton('img:open_workbench', '🎛️ 绘图菜单', ButtonStyle.Secondary),
  ];
  if (!record.ephemeral) {
    buttons.push(makeButton(`img:del:${record.id}`, '🗑️ 撤回', ButtonStyle.Danger));
  }

  return {
    embeds: [embed],
    files: [attachment],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(ratioRerollSelect),
      buttonRow(...buttons),
    ],
  };
}

export function buildUserImageMenuView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  selectedRatio: ImageAspectRatio | undefined,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const imgCfg = cfg.imageGen;
  const imageSvc = ctx.services.image;
  const userPrefs = imageSvc?.getUserPrefs(guildId, actor.id) ?? {
    guildId,
    userId: actor.id,
    aspectRatio: null,
    steps: null,
    scale: null,
    negativePrompt: '',
    spoiler: false,
    ephemeral: false,
    updatedAt: 0,
  };
  const ratio = selectedRatio ?? userPrefs.aspectRatio ?? imgCfg.defaultAspectRatio;
  const steps = userPrefs.steps ?? imgCfg.defaultSteps;
  const scale = userPrefs.scale ?? imgCfg.defaultScale;
  const effectiveSpoiler = imgCfg.forceSpoiler || userPrefs.spoiler;
  const effectiveEphemeral = userPrefs.ephemeral;
  const configured = Boolean(imageSvc?.isConfigured());
  const model = imgCfg.modelOverride?.trim() || imageSvc?.getDefaultModel() || '未配置';
  const queue = imageSvc?.getQueueSnapshot() ?? { running: 0, pending: 0 };
  const cooldownRemainSec = imageSvc?.getUserCooldownRemainingSec(guildId, actor.id, Boolean(actor.isAdmin)) ?? 0;
  const recentList = imageSvc?.listUserRecent(guildId, actor.id, 15) ?? [];

  const cooldownText = actor.isAdmin
    ? '管理员免冷却'
    : cooldownRemainSec > 0
      ? `⏳ 剩余 **${cooldownRemainSec} 秒**`
      : imgCfg.cooldownSec > 0
        ? `✅ 就绪（冷却 ${imgCfg.cooldownSec}s）`
        : '✅ 无冷却';

  const recentPreviewLines =
    recentList.length > 0
      ? [
          '',
          '📜 **最近出图记录（可在下方下拉框选择复用）**：',
          ...recentList
            .slice(0, 5)
            .map(
              (r) =>
                `• \`#${r.id}\` [${r.aspectRatio}] ${truncateText(r.rawPrompt.replace(/\s+/g, ' '), 42)}`,
            ),
        ]
      : [];

  const description = [
    `🎨 **独立 AI 绘图工作台**（自动记忆你的个人设置，与 \`@Bot\` 群聊完全隔离）`,
    '',
    `🔌 **服务状态**：${configured ? '✅ 已就绪' : '⚠️ 未配置网关'} ｜ **当前模型**：\`${model}\``,
    `📐 **你的画幅比例**：**${ratio}** ｜ **步数 / CFG**：**${steps}** / **${scale}**`,
    `🙈 **出图方式**：${effectiveEphemeral ? '私密出图（仅自己可见）' : '频道公开出图'} ｜ **遮罩**：${imgCfg.forceSpoiler ? '🔞 全局强制开启' : effectiveSpoiler ? '🔞 已开启' : '👁️ 关闭'}`,
    `🚫 **常驻负面词**：${userPrefs.negativePrompt ? truncateText(userPrefs.negativePrompt, 80) : '*（未设置）*'}`,
    `⏱️ **冷却状态**：${cooldownText} ｜ **队列**：生成中 ${queue.running} / 排队 ${queue.pending}`,
    `🔤 **中文直译**：${imgCfg.translateChinese ? '✅ 自动直译为英文（纯英文直通）' : '⛔ 原样直通'}`,
    ...recentPreviewLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · AI 独立绘图`, iconURL: actor.avatarUrl })
    .setTitle('🎨 AI 独立绘图工作台')
    .setDescription(withFeedback(truncateText(description, 4000), feedback))
    .setFooter({ text: '🔒 点选比例/开关立即保存偏好；直接输入 /画图 也可随时唤出本菜单' })
    .setTimestamp();

  const ratioRow = buttonRow(
    ...IMAGE_RATIO_CHOICES.map((opt) =>
      makeButton(
        `img:pref_ratio:${opt.value}`,
        opt.value === '2:3'
          ? '📱 2:3 竖'
          : opt.value === '3:2'
            ? '🖼️ 3:2 横'
            : opt.value === '1:1'
              ? '🟦 1:1 方'
              : opt.value === '9:16'
                ? '📲 9:16 竖'
                : '🎬 16:9 宽',
        opt.value === ratio ? ButtonStyle.Primary : ButtonStyle.Secondary,
      ),
    ),
  );

  const actionRow = buttonRow(
    makeButton('img:open_create', '🎨 输入提示词画图', ButtonStyle.Success, !configured),
    makeButton(
      'img:pref_toggle:ephemeral',
      effectiveEphemeral ? '🙈 出图: 私密仅自己' : '📢 出图: 频道公开',
      effectiveEphemeral ? ButtonStyle.Primary : ButtonStyle.Secondary,
    ),
    makeButton(
      'img:pref_toggle:spoiler',
      effectiveSpoiler ? '🔞 遮罩: 开启' : '👁️ 遮罩: 关闭',
      effectiveSpoiler ? ButtonStyle.Danger : ButtonStyle.Secondary,
      imgCfg.forceSpoiler,
    ),
    makeButton('img:open_prefs_modal', '🎛️ 步数/CFG/负面词', ButtonStyle.Secondary),
    makeButton('img:refresh', '🔄 刷新', ButtonStyle.Secondary),
  );

  const components: MenuComponentRow[] = [ratioRow, actionRow];

  if (recentList.length > 0) {
    const historySelect = new StringSelectMenuBuilder()
      .setCustomId('img:history_pick')
      .setPlaceholder('📜 选择最近画过的记录一键复用或改词重绘...')
      .addOptions(
        recentList.slice(0, 15).map((rec) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(`#${rec.id} [${rec.aspectRatio}] ${rec.rawPrompt}`, 100))
            .setValue(String(rec.id))
            .setDescription(
              truncateText(
                `Steps ${rec.steps} · CFG ${rec.scale}${rec.negativePrompt ? ` · 负面: ${rec.negativePrompt}` : ''}`,
                100,
              ),
            ),
        ),
      );
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(historySelect));
  }

  const navButtons = [
    makeButton('img:pref_reset', '♻️ 重置偏好', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🏠 互动主菜单', ButtonStyle.Secondary),
  ];
  if (actor.isAdmin) {
    navButtons.push(
      makeButton('menu:nav:admin_image', '⚙️ 生图后台', ButtonStyle.Primary),
      makeButton('img:send_lobby', '📌 发频道生图面板', ButtonStyle.Success),
    );
  }
  components.push(buttonRow(...navButtons));

  return { embeds: [embed], components };
}

export function buildAdminImageView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  tab: 'basic' | 'channels' = 'basic',
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const img = cfg.imageGen;
  const imageSvc = ctx.services.image;
  const configured = Boolean(imageSvc?.isConfigured());
  const defaultModel = imageSvc?.getDefaultModel() || '未配置';
  const effectiveModel = img.modelOverride?.trim() || defaultModel;
  const usage24h = imageSvc?.getUsageSummary(guildId, 24) ?? {
    totalCalls: 0,
    okCalls: 0,
    errorCalls: 0,
    avgLatencyMs: 0,
  };

  const allowedText =
    img.allowedChannelIds.length > 0
      ? img.allowedChannelIds.map((id) => `<#${id}>`).join('、')
      : '全频道可用（除禁用频道）';
  const ignoredText =
    img.ignoredChannelIds.length > 0
      ? img.ignoredChannelIds.map((id) => `<#${id}>`).join('、')
      : '无';

  const description = [
    `🔌 **生图网关状态**：${configured ? '✅ 已配置' : '⚠️ 未配置环境变量'} ｜ **模块开关**：${cfg.modules.imageGen ? '✅ 已开启' : '⛔ 已关闭'}`,
    `🎨 **当前生图模型**：\`${effectiveModel}\`${img.modelOverride ? '（后台覆盖）' : '（环境变量默认）'}`,
    `📐 **默认绘图参数**：比例 **${img.defaultAspectRatio}** ｜ Steps **${img.defaultSteps}** ｜ Scale **${img.defaultScale}**`,
    `⏱️ **冷却与并发队列**：单人冷却 **${img.cooldownSec}s** ｜ 最大并发 **${img.maxConcurrency}** ｜ 队列上限 **${img.maxPendingQueue}**`,
    `🔤 **中文直译开关**：${img.translateChinese ? '✅ 开启（中文自动直译英文，纯英文直通）' : '⛔ 关闭（原样直通）'}${img.translatorModel ? ` ｜ 译者模型：\`${img.translatorModel}\`` : ''}`,
    `🔞 **全局强制遮罩**：${img.forceSpoiler ? '✅ 开启（所有出图强制模糊遮罩）' : '⛔ 关闭（随用户选择）'}`,
    `📊 **近 24h 用量**：总计 **${usage24h.totalCalls}** 张（成功 ${usage24h.okCalls} / 失败 ${usage24h.errorCalls}） ｜ 平均耗时 **${(usage24h.avgLatencyMs / 1000).toFixed(1)}s**`,
    `📌 **白名单频道**：${allowedText}`,
    `🔕 **禁用频道**：${ignoredText}`,
    '',
    `> **默认正面附加词**：${img.defaultPositivePrompt ? truncateText(img.defaultPositivePrompt, 120) : '*（留空）*'}`,
    `> **默认负面附加词**：${img.defaultNegativePrompt ? truncateText(img.defaultNegativePrompt, 120) : '*（留空）*'}`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · AI 独立生图管理`, iconURL: actor.avatarUrl })
    .setTitle(tab === 'channels' ? '📡 生图频道黑白名单配置' : '🎨 AI 独立生图参数配置')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 仅管理员可见；生图配置与聊天 AI 完全独立，修改立即生效' })
    .setTimestamp();

  const allowedSelect = new ChannelSelectMenuBuilder()
    .setCustomId('menu:chan:admin_img_allowed')
    .setPlaceholder('📌 设置允许生图的频道白名单（清空则全服可用）...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    )
    .setMinValues(0)
    .setMaxValues(10);
  if (img.allowedChannelIds.length > 0) {
    allowedSelect.setDefaultChannels(img.allowedChannelIds.slice(0, 10));
  }

  const ignoreSelect = new ChannelSelectMenuBuilder()
    .setCustomId('menu:chan:admin_img_ignore')
    .setPlaceholder('🔕 设置禁止生图的频道黑名单（清空即取消）...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    )
    .setMinValues(0)
    .setMaxValues(10);
  if (img.ignoredChannelIds.length > 0) {
    ignoreSelect.setDefaultChannels(img.ignoredChannelIds.slice(0, 10));
  }

  if (tab === 'channels') {
    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(allowedSelect),
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ignoreSelect),
        buttonRow(
          makeButton('menu:admin:img_toggle_allowed_here', '📌 切换本频道白名单', ButtonStyle.Secondary),
          makeButton(
            'menu:admin:img_clear_allowed',
            '🌐 解除白名单限制',
            ButtonStyle.Secondary,
            img.allowedChannelIds.length === 0,
          ),
          makeButton('menu:nav:admin_image:basic', '🎛️ 参数配置', ButtonStyle.Primary),
          makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
          makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
        ),
      ],
    };
  }

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:modal:admin_img_params', '🎛️ 模型与默认参数', ButtonStyle.Primary),
        makeButton('menu:modal:admin_img_prompts', '📝 默认正负预设词', ButtonStyle.Primary),
        makeButton('menu:modal:admin_img_limits', '⏱️ 并发与队列上限', ButtonStyle.Primary),
      ),
      buttonRow(
        makeButton(
          'menu:admin:img_toggle_translate',
          `🔤 中文直译: ${img.translateChinese ? '开' : '关'}`,
          img.translateChinese ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
        makeButton(
          'menu:admin:img_toggle_spoiler',
          `🔞 强制遮罩: ${img.forceSpoiler ? '开' : '关'}`,
          img.forceSpoiler ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
        makeButton('menu:nav:admin_image:channels', '📡 频道黑白名单', ButtonStyle.Primary),
        makeButton('menu:admin:img_reset', '♻️ 恢复默认', ButtonStyle.Danger),
      ),
      buttonRow(
        makeButton('menu:admin:img_send_lobby', '📌 发频道生图面板', ButtonStyle.Success),
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}
