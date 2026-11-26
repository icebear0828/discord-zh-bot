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
import {
  VALID_IMAGE_BATCH_COUNTS,
  type ImageAspectRatio,
} from '../config/defaults.js';
import type { ImageGenerationRecord } from '../db/repositories/imageRepo.js';
import type { NaiCharCaption } from '../services/imageClient.js';
import type { ImageBatchItem } from '../services/imageService.js';
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

export const MAX_DISCORD_BATCH_BYTES = 8 * 1024 * 1024;

export const IMAGE_RATIO_CHOICES: ReadonlyArray<{
  value: ImageAspectRatio;
  label: string;
  description: string;
}> = [
  { value: '2:3', label: '📱 2:3 竖图（默认）', description: '适合人物立绘与角色半身/全身像 (832x1216)' },
  { value: '3:2', label: '🖼️ 3:2 横图', description: '适合风景、多人同框与横版构图 (1216x832)' },
  { value: '1:1', label: '🟦 1:1 方图', description: '适合头像、Q版与正方形构图 (1024x1024)' },
  { value: '9:16', label: '📲 9:16 手机竖屏', description: '适合竖屏壁纸与全身特写 (768x1344)' },
  { value: '16:9', label: '🎬 16:9 宽屏横图', description: '适合大场景壁纸与电影级构图 (1344x768)' },
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
        '• 📐 **Opus 0 Anlas 预设比例**：2:3 / 3:2 / 1:1 / 9:16 / 16:9 一键切换，默认开启 NAI V5 无码预设',
        '• 👥 **NAI V5 角色分栏**：支持 `Character 1~6` 独立外貌服装、专属负面词、站位坐标及整段多栏粘贴自动拆分',
        '• 🎲 **1~5 张串行连抽**：单线程顺序出图 + 1~3 秒防风控间隔，支持私密出图与剧透模糊遮罩',
        '• 📜 **历史一键复用**：随时从最近画过的作品下拉选中，直接改词或换比例重绘',
        '• ⚡ **快速指令**：也可随时输入 `/画图` 打开工作台，或直接填英文 Tag 一步出图',
      ].join('\n'),
    )
    .setFooter({ text: '提示：NAI V5 Full 独立生图模型 · 点击按钮即可开启专属工作台' })
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

export interface BuiltImageFollowUpMessage {
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
}

export interface BuiltImageBatchResultMessages {
  primary: BuiltImageResultMessage;
  followUps: BuiltImageFollowUpMessage[];
}

export function buildImageBatchProgressMessage(params: {
  completed: number;
  total: number;
  aspectRatio: ImageAspectRatio;
  steps: number;
  scale: number;
  cfgRescale: number;
}): { embeds: EmbedBuilder[]; components: MenuComponentRow[] } {
  const embed = new EmbedBuilder()
    .setColor(COLORS.FUN)
    .setTitle(`🎨 正在串行批量绘制（已完成 ${params.completed} / ${params.total} 张）`)
    .setDescription(
      [
        '⏳ 为避免触发上游风控，单线程顺序出图中（每张之间随机停顿 1~3 秒），请稍候...',
        `📐 **参数**：比例 **${params.aspectRatio}** ｜ Steps **${params.steps}** ｜ CFG **${params.scale}** ｜ Rescale **${params.cfgRescale}**`,
      ].join('\n'),
    )
    .setTimestamp();

  return { embeds: [embed], components: [] };
}

function buildAttachmentsForItems(items: readonly ImageBatchItem[]): AttachmentBuilder[] {
  return items.map((item) => {
    const attachment = new AttachmentBuilder(item.buffer, {
      name: `nai-draw-${item.record.id}.png`,
    });
    if (item.record.spoiler) {
      attachment.setSpoiler(true);
    }
    return attachment;
  });
}

function formatCharCaptionsSummary(chars: readonly NaiCharCaption[]): string {
  return chars
    .map((c, idx) => {
      const center = c.centers?.[0];
      const pos = center ? `@(${center.x},${center.y}) ` : '';
      return `[C${idx + 1}] ${pos}${truncateText(c.char_caption, 80)}`;
    })
    .join(' ｜ ');
}

function formatBatchSeedText(items: readonly ImageBatchItem[], isBatch: boolean): string {
  const first = items[0]!;
  if (!isBatch) {
    return first.record.seed !== null ? String(first.record.seed) : '随机';
  }
  const seeds = items.map((item) => item.record.seed).filter((s): s is number => s !== null);
  if (seeds.length === 0) return '随机';
  if (seeds.length === 1) return String(seeds[0]);
  return `${seeds[0]} ~ ${seeds[seeds.length - 1]}`;
}

export function buildImageBatchResultMessages(params: {
  items: readonly ImageBatchItem[];
  requestedCount: number;
  failedCount?: number;
  lastErrorMessage?: string;
  authorName: string;
  authorAvatarUrl?: string;
}): BuiltImageBatchResultMessages {
  const { items, authorName, authorAvatarUrl } = params;
  const requestedCount = Math.max(1, Math.round(params.requestedCount));
  const failedCount = Math.max(0, Math.round(params.failedCount ?? 0));

  const chunks: ImageBatchItem[][] = [];
  let currentChunk: ImageBatchItem[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const size = item.buffer.length;
    if (
      currentChunk.length > 0 &&
      (currentBytes + size > MAX_DISCORD_BATCH_BYTES || currentChunk.length >= 10)
    ) {
      chunks.push(currentChunk);
      currentChunk = [item];
      currentBytes = size;
    } else {
      currentChunk.push(item);
      currentBytes += size;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  const primaryChunk = chunks[0] ?? [];
  const firstItem = primaryChunk[0] ?? items[0]!;
  const record = firstItem.record;
  const isBatch = items.length > 1 || requestedCount > 1;
  const totalLatencyMs = items.reduce((sum, item) => sum + item.record.latencyMs, 0);
  const primaryFiles = buildAttachmentsForItems(primaryChunk);
  const followUpChunks = chunks.slice(1);

  const primaryEmbed = new EmbedBuilder()
    .setColor(COLORS.FUN)
    .setAuthor({
      name: `${authorName} 的独立绘图作品`,
      ...(authorAvatarUrl ? { iconURL: authorAvatarUrl } : {}),
    })
    .setTitle(
      isBatch
        ? `🎨 批量出图完成（${items.length}/${requestedCount} 张）${record.spoiler ? '（剧透遮罩）' : ''}`
        : `🎨 出图完成 #${record.id}${record.spoiler ? '（剧透遮罩）' : ''}`,
    )
    .setDescription(
      [
        `📝 **原始提示词**：${truncateText(record.rawPrompt, 450)}`,
        ...(record.finalPrompt !== record.rawPrompt
          ? [`✨ **实际提示词**：${truncateText(record.finalPrompt, 450)}`]
          : []),
        ...(record.charCaptions && record.charCaptions.length > 0
          ? [
              `👥 **角色栏 (${record.charCaptions.length}人${record.useCoords ? ' · 自定义站位' : ''})**：${truncateText(formatCharCaptionsSummary(record.charCaptions), 350)}`,
            ]
          : []),
        ...(record.negativePrompt
          ? [`🚫 **负面词**：${truncateText(record.negativePrompt, 300)}`]
          : []),
        ...(failedCount > 0
          ? [
              `⚠️ **部分失败**：其中 **${failedCount} 张** 生成失败（${params.lastErrorMessage ?? '上游异常'}），已保留成功出图。`,
            ]
          : []),
        ...(followUpChunks.length > 0
          ? ['📎 **分批续传**：总文件体积超过 8MB 限制，其余图片将在下方补充消息中发送。']
          : []),
      ].join('\n'),
    )
    .addFields(
      { name: '📐 比例', value: record.aspectRatio, inline: true },
      { name: '🎛️ 步数 / CFG', value: `${record.steps} / ${record.scale}`, inline: true },
      {
        name: isBatch ? '🎲 种子 / 总耗时' : '🎲 种子 / 耗时',
        value: `${formatBatchSeedText(items, isBatch)} · ${(totalLatencyMs / 1000).toFixed(1)}s`,
        inline: true,
      },
    )
    .setFooter({
      text: isBatch
        ? `模型: ${record.model} ｜ #${record.id}~#${items[items.length - 1]!.record.id}`
        : `模型: ${record.model} ｜ #${record.id}`,
    })
    .setTimestamp(record.createdAt);

  // Do not embed spoiler attachment directly so Discord blur mask stays active;
  // also omit embed.setImage on multi-attachment primary cards so Discord renders all images cleanly.
  if (primaryChunk.length === 1 && !record.spoiler) {
    primaryEmbed.setImage(`attachment://nai-draw-${record.id}.png`);
  }

  const countSuffix = requestedCount > 1 ? `:${requestedCount}` : '';
  const ratioRerollSelect = new StringSelectMenuBuilder()
    .setCustomId(`img:ratio_reroll:${record.id}${countSuffix}`)
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
    makeButton(
      `img:reroll:${record.id}${countSuffix}`,
      requestedCount > 1 ? `🔄 再来 ${requestedCount} 张` : '🔄 再画一张',
      ButtonStyle.Primary,
    ),
    makeButton(`img:edit:${record.id}${countSuffix}`, '✏️ 改词/调参', ButtonStyle.Secondary),
    makeButton('img:open_workbench', '🎛️ 绘图菜单', ButtonStyle.Secondary),
  ];
  if (!record.ephemeral) {
    buttons.push(makeButton(`img:del:${record.id}`, '🗑️ 撤回', ButtonStyle.Danger));
  }

  const primary: BuiltImageResultMessage = {
    embeds: [primaryEmbed],
    files: primaryFiles,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(ratioRerollSelect),
      buttonRow(...buttons),
    ],
  };

  const followUps: BuiltImageFollowUpMessage[] = followUpChunks.map((chunk, idx) => {
    const first = chunk[0]!;
    const embed = new EmbedBuilder()
      .setColor(COLORS.FUN)
      .setTitle(`📎 批量出图续传（第 ${idx + 2}/${chunks.length} 批 · ${chunk.length} 张）`)
      .setFooter({ text: `模型: ${first.record.model} ｜ #${first.record.id}` })
      .setTimestamp(first.record.createdAt);
    if (chunk.length === 1 && !first.record.spoiler) {
      embed.setImage(`attachment://nai-draw-${first.record.id}.png`);
    }
    return {
      embeds: [embed],
      files: buildAttachmentsForItems(chunk),
    };
  });

  return { primary, followUps };
}

export function buildImageResultMessage(params: {
  record: ImageGenerationRecord;
  buffer: Buffer;
  authorName: string;
  authorAvatarUrl?: string;
  attempts: number;
}): BuiltImageResultMessage {
  return buildImageBatchResultMessages({
    items: [{ buffer: params.buffer, record: params.record, attempts: params.attempts }],
    requestedCount: 1,
    authorName: params.authorName,
    authorAvatarUrl: params.authorAvatarUrl,
  }).primary;
}

const BATCH_COUNT_LABELS: Readonly<Record<number, string>> = {
  1: '1️⃣ 单张',
  2: '2️⃣ 2连',
  3: '3️⃣ 3连',
  4: '4️⃣ 4连',
  5: '5️⃣ 5连',
};

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
    batchCount: null,
    negativePrompt: '',
    spoiler: false,
    ephemeral: false,
    updatedAt: 0,
  };
  const ratio = selectedRatio ?? userPrefs.aspectRatio ?? imgCfg.defaultAspectRatio;
  const steps = userPrefs.steps ?? imgCfg.defaultSteps;
  const scale = userPrefs.scale ?? imgCfg.defaultScale;
  const batchCount = userPrefs.batchCount ?? 1;
  const effectiveSpoiler = imgCfg.forceSpoiler || userPrefs.spoiler;
  const effectiveEphemeral = userPrefs.ephemeral;
  const configured = Boolean(imageSvc?.isConfigured());
  const model = imgCfg.modelOverride?.trim() || imageSvc?.getDefaultModel() || '未配置';
  const queue = imageSvc?.getQueueSnapshot() ?? { running: 0, pending: 0 };
  const cooldownRemainSec =
    imageSvc?.getUserCooldownRemainingSec(guildId, actor.id, Boolean(actor.isAdmin)) ?? 0;
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
    `📐 **你的画幅比例**：**${ratio}** ｜ **步数 / CFG / 连续张数**：**${steps}** / **${scale}** / **${batchCount} 张**`,
    `🙈 **出图方式**：${effectiveEphemeral ? '私密出图（仅自己可见）' : '频道公开出图'} ｜ **遮罩**：${imgCfg.forceSpoiler ? '🔞 全局强制开启' : effectiveSpoiler ? '🔞 已开启' : '👁️ 关闭'}`,
    `🔞 **默认预设策略**：${imgCfg.defaultPositivePrompt ? `自动前置 \`${truncateText(imgCfg.defaultPositivePrompt, 60)}\`` : '原样直通'} ｜ **Rescale**：**${imgCfg.defaultCfgRescale}**`,
    `👥 **角色分栏支持**：弹窗支持 \`Character 1~6\` 独立栏、\`@x,y\`/\`@B3\` 站位及完整多栏文本一键粘贴拆分`,
    `🚫 **常驻负面词**：${userPrefs.negativePrompt ? truncateText(userPrefs.negativePrompt, 80) : '*（未设置，默认自动合并防打码UC）*'}`,
    `⏱️ **冷却状态**：${cooldownText} ｜ **队列**：生成中 ${queue.running} / 排队 ${queue.pending}`,
    ...recentPreviewLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · AI 独立绘图`, iconURL: actor.avatarUrl })
    .setTitle('🎨 AI 独立绘图工作台')
    .setDescription(withFeedback(truncateText(description, 4000), feedback))
    .setFooter({ text: '🔒 点选比例/张数/开关立即保存偏好；串行连抽每张间隔 1~3 秒防风控' })
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

  const batchRow = buttonRow(
    ...VALID_IMAGE_BATCH_COUNTS.map((cnt) =>
      makeButton(
        `img:pref_count:${cnt}`,
        BATCH_COUNT_LABELS[cnt] ?? `${cnt}张`,
        cnt === batchCount ? ButtonStyle.Primary : ButtonStyle.Secondary,
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
    makeButton('img:open_prefs_modal', '🎛️ 步数/CFG/张数/负面词', ButtonStyle.Secondary),
    makeButton('img:refresh', '🔄 刷新', ButtonStyle.Secondary),
  );

  const components: MenuComponentRow[] = [ratioRow, batchRow, actionRow];

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
    `📐 **默认绘图参数**：比例 **${img.defaultAspectRatio}** ｜ Steps **${img.defaultSteps}** ｜ Scale **${img.defaultScale}** ｜ CFG Rescale **${img.defaultCfgRescale}**`,
    `⏱️ **冷却与并发队列**：单人冷却 **${img.cooldownSec}s** ｜ 最大并发 **${img.maxConcurrency}** ｜ 队列上限 **${img.maxPendingQueue}**`,
    `🔞 **Prompt 预设策略**：正面预设自动前置（跳过 \`rating:safe/general\`）、负面预设与个人负面词自动合并去重`,
    `🙈 **全局强制遮罩**：${img.forceSpoiler ? '✅ 开启（所有出图强制模糊遮罩）' : '⛔ 关闭（随用户选择）'}`,
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
        makeButton('menu:modal:admin_img_prompts', '📝 预设词与Rescale', ButtonStyle.Primary),
        makeButton('menu:modal:admin_img_limits', '⏱️ 并发与队列上限', ButtonStyle.Primary),
      ),
      buttonRow(
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
