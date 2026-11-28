import {
  ActionRowBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { AI_PERSONA_PRESETS } from '../config/defaults.js';
import {
  composeOcAppearanceForOutfit,
  listOcOutfits,
} from '../services/aiOcSelfie.js';
import {
  formatAiRelationBadge,
  MAX_AI_USER_PROFILES,
} from '../services/aiProfiles.js';
import { MAX_AI_REGEX_RULES, type AiRegexRuleScope } from '../services/aiRegex.js';
import { COLORS, type AppContext } from './embeds.js';
import {
  buttonRow,
  makeButton,
  paginateSlice,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
} from './menuShared.js';

const REGEX_SCOPE_LABELS: Record<AiRegexRuleScope, string> = {
  both: '双向',
  input: '仅输入',
  output: '仅输出',
};

const REGEX_PAGE_SIZE = 10;
const PROFILE_PAGE_SIZE = 10;

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0.0000';
  if (amount < 0.01) return `$${amount.toFixed(6)}`;
  return `$${amount.toFixed(4)}`;
}

export function buildAdminAiView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  tab: 'basic' | 'channels' | 'regex' | 'usage' | 'profiles' | 'selfie' = 'basic',
  regexPage = 1,
  profilePage = 1,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const ai = cfg.ai;
  const aiEnabled = cfg.modules.ai;
  const llmConfigured = ctx.services.ai.isConfigured();
  const defaultModel = ctx.services.ai.getDefaultModel() || '未配置';
  const effectiveModel = ai.modelOverride?.trim() || defaultModel;
  const memCounts = ctx.services.ai.countMemories(guildId);
  const enabledRegexCount = ai.regexRules.filter((r) => r.enabled).length;
  const usage24h = ctx.services.ai.getUsageSummary(guildId, 24);
  const externalOcProfiles = ctx.services.ai.listOcProfiles();
  const activeOc = ctx.services.ai.resolveActiveOcProfile(ai.selfie);
  const activeOutfit = ctx.services.ai.resolveActiveOcOutfit(ai.selfie);
  const wardrobeOutfits = listOcOutfits(activeOc);
  const poseCatalogCount = ctx.services.ai.listOcPoses().length;
  const imageConfigured = Boolean(ctx.services.image?.isConfigured());

  if (tab === 'selfie') {
    const selfie = ai.selfie;
    const outfitMode = selfie.outfitMode?.trim() || 'ootd';
    const isLockedOutfit =
      outfitMode !== 'ootd' && wardrobeOutfits.some((o) => o.id === outfitMode);
    const ootdCount = wardrobeOutfits.filter((o) => o.ootdEligible !== false).length;
    const hiddenCount = wardrobeOutfits.length - ootdCount;
    const effectiveAppearance = composeOcAppearanceForOutfit(activeOc, activeOutfit);

    const description = [
      `📸 **聊天自设生图开关**：${selfie.enabled ? '✅ 已开启' : '⛔ 已关闭'} ｜ **生图网关**：${imageConfigured ? '✅ 已就绪' : '⚠️ 未配置 IMAGE_BASE_URL / IMAGE_API_KEY'}`,
      `🎭 **当前生效自设（OC）**：**${activeOc.name}**（\`${activeOc.id}\`）`,
      `👗 **今日生效穿搭**：**${activeOutfit.name}**（\`${activeOutfit.id}\` · ${isLockedOutfit ? '📌 后台手动锁定' : '📅 每日 OOTD 自动轮换'}）`,
      `🧥 **角色衣柜与姿势库**：共 **${wardrobeOutfits.length}** 套穿搭（日常轮换 ${ootdCount} 套${hiddenCount > 0 ? ` / 🔒隐藏点名款 ${hiddenCount} 套` : ''}） ｜ **${poseCatalogCount}** 组 4 档分级姿势 × 5 视角`,
      `⏱️ **单人拍照冷却**：**${selfie.cooldownSec}s**（管理员免冷却，与 \`/画图\` 频道白名单解耦）`,
      `🔞 **分级与遮罩策略**：${selfie.allowNsfw ? '日常默认 SFW；群友明确索要 R18/涩图时启用无码词并**自动打模糊遮罩**' : '🔒 严格 SFW（始终拦截裸露色情标签）'}`,
      ...(externalOcProfiles.length > 0
        ? [`📦 **本地私有自设库**：已加载 **${externalOcProfiles.length}** 套私有 OC 预设`]
        : ['📦 **本地私有自设库**：未检测到 `data/ai-packs/oc-presets.json`，当前使用自定义自设']),
      '',
      `> **当前生效外貌（含本套头饰微调）**：\n> \`${truncateText(effectiveAppearance, 200)}\``,
      `> **特写服饰（PORTRAIT）**：\`${truncateText(activeOutfit.costumePortrait, 130)}\``,
      `> **半身服饰（UPPER）**：\`${truncateText(activeOutfit.costumeUpper, 130)}\``,
      `> **全身服饰（FULL）**：\`${truncateText(activeOutfit.costumeFull, 130)}\``,
      ...(activeOutfit.silhouetteGuard
        ? [`> **防漂移负权重守卫**：\`${truncateText(activeOutfit.silhouetteGuard, 120)}\``]
        : []),
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(resolveColor(COLORS.FUN, feedback))
      .setAuthor({ name: `${actor.displayName} · AI 聊天自设生图配置`, iconURL: actor.avatarUrl })
      .setTitle('📸 AI 聊天自设（OC）· 每日穿搭（OOTD）与分级姿势库')
      .setDescription(withFeedback(truncateText(description, 4000), feedback))
      .setFooter({ text: '🔒 默认按日轮换日常 OOTD 并同步进对话人设；群友点名换装仅当次拍照生效' })
      .setTimestamp();

    const ocOptions = [
      ...externalOcProfiles.slice(0, 20).map((profile) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(truncateText(profile.name, 100))
          .setValue(`preset:${profile.id}`)
          .setDescription(truncateText(profile.description, 100))
          .setDefault(activeOc.id === profile.id),
      ),
      new StringSelectMenuOptionBuilder()
        .setLabel(`✍️ 自定义专属自设（${truncateText(selfie.customOc.name || 'Custom OC', 30)}）`)
        .setValue('preset:custom')
        .setDescription('使用下方弹窗自定义的专属外貌锚点与三级景别服饰')
        .setDefault(activeOc.id === 'custom'),
    ];

    const ocSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('menu:admin_ai_selfie_preset')
        .setPlaceholder('📸 一键切换 Bot 专属自设（OC）形象...')
        .addOptions(ocOptions),
    );

    const outfitOptions = [
      new StringSelectMenuOptionBuilder()
        .setLabel(
          truncateText(
            `📅 自动每日穿搭 OOTD（今日：${activeOutfit.name}）`,
            100,
          ),
        )
        .setValue('mode:ootd')
        .setDescription('按日期每天自动轮换 1 套日常衣柜（不含隐藏款），也可点下方按钮立即换一套')
        .setDefault(!isLockedOutfit),
      ...wardrobeOutfits.slice(0, 24).map((outfit) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(
            truncateText(
              `${outfit.ootdEligible === false ? '🔒 ' : '👗 '}${outfit.name}`,
              100,
            ),
          )
          .setValue(`outfit:${outfit.id}`)
          .setDescription(truncateText(outfit.summaryZh, 100))
          .setDefault(isLockedOutfit && activeOutfit.id === outfit.id),
      ),
    ];

    const outfitSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('menu:admin_ai_selfie_outfit')
        .setPlaceholder('👗 切换每日 OOTD 自动轮换或手动锁定指定穿搭...')
        .addOptions(outfitOptions),
    );

    const components: MenuComponentRow[] = [
      ocSelect,
      outfitSelect,
      buttonRow(
        makeButton(
          'menu:admin:ai_toggle_selfie',
          `📸 聊天生图: ${selfie.enabled ? '开' : '关'}`,
          selfie.enabled ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
        makeButton(
          'menu:admin:ai_toggle_selfie_nsfw',
          `🔞 R18遮罩: ${selfie.allowNsfw ? '允许' : '禁止'}`,
          selfie.allowNsfw ? ButtonStyle.Danger : ButtonStyle.Secondary,
        ),
        makeButton(
          'menu:admin:ai_reroll_selfie_ootd',
          '🎲 换一套今日穿搭',
          ButtonStyle.Secondary,
          wardrobeOutfits.length <= 1,
        ),
        makeButton('menu:modal:admin_ai_selfie_appearance', '✍️ 编辑外貌与冷却', ButtonStyle.Primary),
        makeButton('menu:modal:admin_ai_selfie_costume', '👗 编辑三级服饰', ButtonStyle.Primary),
      ),
      buttonRow(
        makeButton('menu:nav:admin_ai:basic', '🎭 人设与参数', ButtonStyle.Primary),
        makeButton('menu:nav:admin_image:basic', '🎨 独立生图后台', ButtonStyle.Secondary),
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ];

    return { embeds: [embed], components };
  }

  if (tab === 'profiles') {
    const paged = paginateSlice(ai.userProfiles, profilePage, PROFILE_PAGE_SIZE);
    const lines =
      paged.slice.length > 0
        ? paged.slice.map((p) => {
            const badge = formatAiRelationBadge(p.relation);
            const noteStr = p.note ? `\n  备注：${p.note}` : '';
            return `• ${badge} <@${p.userId}> · **${p.alias}**${noteStr}`;
          })
        : ['当前还没有配置任何人物档案，请在下方直接选择一名群友添加。'];

    const description = [
      `👥 **已绑定人物档案**：**${ai.userProfiles.length}/${MAX_AI_USER_PROFILES}** 人`,
      `📌 **说明**：按 Discord 账号 ID 精确绑定称呼、关系档位（核心偏爱 / 熟人 / 重点怼）与态度备注，群友改昵称也不会认错人，且仅在本轮对话出场时自动注入。`,
      '',
      ...lines,
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(resolveColor(COLORS.PRIMARY, feedback))
      .setAuthor({ name: `${actor.displayName} · AI 精确人物关系档案`, iconURL: actor.avatarUrl })
      .setTitle(`👤 AI 人物档案管理（第 ${paged.page}/${paged.totalPages} 页）`)
      .setDescription(withFeedback(truncateText(description, 4000), feedback))
      .setFooter({ text: '🔒 仅管理员可见；也可在频道用 /ai 档案 查看/设置/删除' })
      .setTimestamp();

    const components: MenuComponentRow[] = [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('menu:user:admin_ai_profile_pick')
          .setPlaceholder('👤 选择一名群友新增或编辑人物档案...')
          .setMinValues(1)
          .setMaxValues(1),
      ),
    ];

    if (paged.slice.length > 0) {
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`menu:admin_ai_profile_delete:${paged.page}`)
            .setPlaceholder('🗑️ 选择一条人物档案移除...')
            .addOptions(
              paged.slice.map((p) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(truncateText(`${formatAiRelationBadge(p.relation)} ${p.alias}`, 100))
                  .setValue(p.userId)
                  .setDescription(truncateText(`ID: ${p.userId}${p.note ? ` | ${p.note}` : ''}`, 100)),
              ),
            ),
        ),
      );
    }

    const navButtons = [];
    if (paged.totalPages > 1) {
      navButtons.push(
        makeButton(
          `menu:nav:admin_ai:profiles:${Math.max(1, paged.page - 1)}`,
          '⬅️ 上页',
          ButtonStyle.Secondary,
          paged.page <= 1,
        ),
        makeButton(
          `menu:nav:admin_ai:profiles:${Math.min(paged.totalPages, paged.page + 1)}`,
          '➡️ 下页',
          ButtonStyle.Secondary,
          paged.page >= paged.totalPages,
        ),
      );
    }
    navButtons.push(
      makeButton('menu:nav:admin_ai:basic', '🎭 人设与参数', ButtonStyle.Primary),
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    );
    components.push(buttonRow(...navButtons));

    return { embeds: [embed], components };
  }

  if (tab === 'usage') {
    const usage7d = ctx.services.ai.getUsageSummary(guildId, 24 * 7);
    const recentLogs = ctx.services.ai.listRecentUsageLogs(guildId, 5);
    const hasPricing = ai.inputPricePer1MUsd > 0 || ai.outputPricePer1MUsd > 0;
    const pricingLine = hasPricing
      ? `输入 **$${ai.inputPricePer1MUsd}**/1M tokens ｜ 输出 **$${ai.outputPricePer1MUsd}**/1M tokens`
      : '未配置单价（当前估算费用为 $0，点击下方「💲 设置 Token 单价」配置）';

    const modelLines =
      usage24h.byModel.length > 0
        ? usage24h.byModel
            .slice(0, 5)
            .map(
              (m) =>
                `• \`${m.model}\`：${m.calls} 次 ｜ ${m.totalTokens.toLocaleString('en-US')} tok（${m.promptTokens}/${m.completionTokens}） ｜ ${formatUsd(m.costUsd)}`,
            )
        : ['• 近 24 小时暂无调用记录'];

    const userLines =
      usage24h.topUsers.length > 0
        ? usage24h.topUsers.map(
            (u) =>
              `• <@${u.userId}>：${u.calls} 次 ｜ ${u.totalTokens.toLocaleString('en-US')} tok ｜ ${formatUsd(u.costUsd)}`,
          )
        : ['• 暂无成员消费记录'];

    const recentLines =
      recentLogs.length > 0
        ? recentLogs.map((log) => {
            const statusIcon = log.status === 'ok' ? '✅' : `❌(${log.errorCode ?? 'err'})`;
            const estTag = log.usageEstimated ? '(估)' : '';
            return `• ${statusIcon} \`${truncateText(log.model, 24)}\` <@${log.userId}> ${log.promptTokens}+${log.completionTokens}=${log.totalTokens}${estTag} tok · ${log.latencyMs}ms`;
          })
        : ['• 暂无调用明细'];

    const description = [
      `💵 **当前计费单价**：${pricingLine}`,
      '',
      `📊 **近 24 小时统计**`,
      `• 调用：**${usage24h.totalCalls}** 次（成功 ${usage24h.okCalls} / 失败 ${usage24h.errorCalls} / 估算 ${usage24h.estimatedCalls}） ｜ 平均耗时 **${usage24h.avgLatencyMs}ms**`,
      `• Token：**${usage24h.totalTokens.toLocaleString('en-US')}**（输入 ${usage24h.promptTokens.toLocaleString('en-US')} + 输出 ${usage24h.completionTokens.toLocaleString('en-US')}）`,
      `• 估算花费：**${formatUsd(usage24h.estimatedCostUsd)}**`,
      '',
      `📅 **近 7 天汇总**：**${usage7d.totalCalls}** 次 ｜ **${usage7d.totalTokens.toLocaleString('en-US')}** tok ｜ **${formatUsd(usage7d.estimatedCostUsd)}**`,
      '',
      '🤖 **24h 按模型分布**',
      ...modelLines,
      '',
      '👥 **24h 消耗 Top 5**',
      ...userLines,
      '',
      '🕒 **最近 5 次调用**',
      ...recentLines,
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(resolveColor(COLORS.PRIMARY, feedback))
      .setAuthor({ name: `${actor.displayName} · AI Token 与计费统计`, iconURL: actor.avatarUrl })
      .setTitle('📊 AI Token 用量与费用监控')
      .setDescription(withFeedback(truncateText(description, 4000), feedback))
      .setFooter({ text: '🔒 仅管理员可见；也可在频道用 /ai 用量 [小时] 查看' })
      .setTimestamp();

    const components: MenuComponentRow[] = [
      buttonRow(
        makeButton('menu:modal:admin_ai_pricing', '💲 设置 Token 单价', ButtonStyle.Primary),
        makeButton('menu:nav:admin_ai:usage', '🔄 刷新统计', ButtonStyle.Secondary),
        makeButton(
          'menu:admin:ai_clear_usage',
          '🗑️ 清空用量日志',
          ButtonStyle.Danger,
          usage7d.totalCalls === 0 && recentLogs.length === 0,
        ),
      ),
      buttonRow(
        makeButton('menu:nav:admin_ai:basic', '🎭 人设与参数', ButtonStyle.Primary),
        makeButton('menu:nav:admin_ai:regex', '🔧 正则与反八股', ButtonStyle.Secondary),
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ];

    return { embeds: [embed], components };
  }

  if (tab === 'regex') {
    const paged = paginateSlice(ai.regexRules, regexPage, REGEX_PAGE_SIZE);
    const rulesLines =
      paged.slice.length > 0
        ? paged.slice.map((rule) => {
            const status = rule.enabled ? '✅' : '⏸️';
            const scopeLabel = REGEX_SCOPE_LABELS[rule.scope];
            const repText = rule.replacement ? `\`${truncateText(rule.replacement, 24)}\`` : '*(删除)*';
            return `${status} \`${rule.id}\` **[${scopeLabel}] ${rule.label}**\n  \`/${truncateText(rule.pattern, 48)}/${rule.flags}\` → ${repText}`;
          })
        : ['当前没有正则替换规则，可点击下方「➕ 新增正则规则」或「♻️ 恢复默认规则」。'];

    const sanitizerOn = ai.inputSanitizerEnabled !== false;
    const description = [
      `🛡️ **输入敏感词软化**：${sanitizerOn ? '✅ 已开启' : '⛔ 已关闭'} ｜ 🧹 **反八股提示词**：${ai.antiClichePromptEnabled ? '✅ 已开启' : '⛔ 已关闭'} ｜ **生效规则**：**${enabledRegexCount}/${ai.regexRules.length}** 条（上限 ${MAX_AI_REGEX_RULES} 条）`,
      `📌 **说明**：输入敏感词软化仅改写喂给聊天模型的输入（不改 AI 回复输出，不影响生图原词）；\`input\`/\`both\` 正则在发送给 AI 前归一化昵称、历史与记忆；\`output\`/\`both\` 在 AI 回复前清洗八股（自动跳过 \`\`\`代码块\`\`\`）。`,
      '',
      ...rulesLines,
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(resolveColor(COLORS.PRIMARY, feedback))
      .setAuthor({ name: `${actor.displayName} · AI 正则替换与反八股`, iconURL: actor.avatarUrl })
      .setTitle(`🔧 AI 正则规则管理（第 ${paged.page}/${paged.totalPages} 页）`)
      .setDescription(withFeedback(truncateText(description, 4000), feedback))
      .setFooter({ text: '🔒 仅管理员可见；也可在频道用 /ai 正则 管理或测试' })
      .setTimestamp();

    const components: MenuComponentRow[] = [];

    if (paged.slice.length > 0) {
      const toggleSelect = new StringSelectMenuBuilder()
        .setCustomId(`menu:admin_ai_regex_toggle:${paged.page}`)
        .setPlaceholder('🔘 选择一条规则切换启用/停用...')
        .addOptions(
          paged.slice.map((rule) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(truncateText(`${rule.enabled ? '✅' : '⏸️'} [${rule.id}] ${rule.label}`, 100))
              .setValue(rule.id)
              .setDescription(
                truncateText(
                  `${REGEX_SCOPE_LABELS[rule.scope]} | /${rule.pattern}/${rule.flags} → ${rule.replacement || '(删除)'}`,
                  100,
                ),
              ),
          ),
        );
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toggleSelect));

      const deleteSelect = new StringSelectMenuBuilder()
        .setCustomId(`menu:admin_ai_regex_delete:${paged.page}`)
        .setPlaceholder('🗑️ 选择一条规则永久删除...')
        .addOptions(
          paged.slice.map((rule) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(truncateText(`🗑️ [${rule.id}] ${rule.label}`, 100))
              .setValue(rule.id)
              .setDescription(truncateText(`删除规则 /${rule.pattern}/${rule.flags}`, 100)),
          ),
        );
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(deleteSelect));
    }

    components.push(
      buttonRow(
        makeButton('menu:modal:admin_ai_regex_add', '➕ 新增正则规则', ButtonStyle.Primary),
        makeButton(
          'menu:admin:ai_toggle_input_sanitizer',
          `🛡️ 输入软化: ${sanitizerOn ? '开' : '关'}`,
          sanitizerOn ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
        makeButton(
          'menu:admin:ai_toggle_cliche_prompt',
          `🧹 反八股提示词: ${ai.antiClichePromptEnabled ? '开' : '关'}`,
          ai.antiClichePromptEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
        makeButton('menu:admin:ai_regex_reset', '♻️ 恢复默认规则', ButtonStyle.Danger),
      ),
    );

    const navButtons = [];
    if (paged.totalPages > 1) {
      navButtons.push(
        makeButton(
          `menu:nav:admin_ai:regex:${Math.max(1, paged.page - 1)}`,
          '⬅️ 上页',
          ButtonStyle.Secondary,
          paged.page <= 1,
        ),
        makeButton(
          `menu:nav:admin_ai:regex:${Math.min(paged.totalPages, paged.page + 1)}`,
          '➡️ 下页',
          ButtonStyle.Secondary,
          paged.page >= paged.totalPages,
        ),
      );
    }
    navButtons.push(
      makeButton('menu:nav:admin_ai:basic', '🎭 人设与参数', ButtonStyle.Primary),
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    );
    components.push(buttonRow(...navButtons));

    return { embeds: [embed], components };
  }

  const freeText =
    ai.freeChatChannelIds.length > 0
      ? ai.freeChatChannelIds.map((id) => `<#${id}>`).join('、')
      : '未设置（仅支持 @Bot 或回复触发）';
  const allowedText =
    ai.allowedChannelIds.length > 0
      ? ai.allowedChannelIds.map((id) => `<#${id}>`).join('、')
      : '全频道允许（除屏蔽频道）';
  const ignoredText =
    ai.ignoredChannelIds.length > 0
      ? ai.ignoredChannelIds.map((id) => `<#${id}>`).join('、')
      : '无';

  const resolvedBinding = ctx.services.ai.resolveEffectiveBinding(guildId);
  const channelOverrideCount = Object.keys(ai.channelOverrides ?? {}).length;
  const packCards = ctx.services.ai.getPackStore() ? ctx.services.ai.listCards() : [];

  const description = [
    `🔌 **网关状态**：${llmConfigured ? '✅ 已连接配置' : '⚠️ 未配置网关参数'} ｜ **模块总开关**：${aiEnabled ? '✅ 已开启' : '⛔ 已关闭'}`,
    `🎭 **当前人格**：**${resolvedBinding.card.personaName}**（卡：\`${resolvedBinding.card.id}@v${resolvedBinding.card.version}\`）`,
    `🔓 **破限预设**：**${resolvedBinding.preset.name}**（\`${resolvedBinding.preset.id}@v${resolvedBinding.preset.version}\`）${channelOverrideCount > 0 ? ` ｜ 🧪 频道沙盒覆盖：**${channelOverrideCount}** 个` : ''}`,
    `🤖 **当前模型**：\`${effectiveModel}\`${ai.modelOverride ? '（后台覆盖）' : '（默认）'} ｜ 🛡️ 兜底：\`${resolvedBinding.effectiveFallbackModel || '无'}\` ｜ 温度 **${ai.temperature}** ｜ MaxTokens **${ai.maxTokens}**`,
    `💬 **上下文与记忆**：滑窗 **${ai.contextWindowMessages}** 条 ｜ 记忆抽取 ${ai.memoryEnabled ? `✅ 开（每域上限 ${ai.maxMemoriesPerScope} 条）` : '⛔ 关'} ｜ 图片识图 ${ai.visionEnabled ? '✅ 开' : '⛔ 关'}`,
    `📸 **聊天自设生图**：${ai.selfie.enabled ? `✅ 开（**${truncateText(activeOc.name, 18)}** · **${truncateText(activeOutfit.name, 18)}** ｜ 冷却 ${ai.selfie.cooldownSec}s）` : '⛔ 已关闭'}`,
    `🔧 **正则替换与反八股**：启用 **${enabledRegexCount}/${ai.regexRules.length}** 条规则 ｜ 反八股提示词 ${ai.antiClichePromptEnabled ? '✅ 开' : '⛔ 关'}`,
    `👤 **人物关系档案**：已绑定 **${ai.userProfiles.length}/${MAX_AI_USER_PROFILES}** 人`,
    `📊 **近 24h 用量**：**${usage24h.totalCalls}** 次（失败 ${usage24h.errorCalls}） ｜ **${usage24h.totalTokens.toLocaleString('en-US')}** Tokens ｜ 估算 **${formatUsd(usage24h.estimatedCostUsd)}**`,
    `🧠 **SQLite 记忆库**：共 **${memCounts.total}** 条（用户 ${memCounts.user} / 频道 ${memCounts.channel} / 全服 ${memCounts.guild}）`,
    `🗨️ **免 @ 直聊频道**：${freeText}`,
    `📌 **白名单限定频道**：${allowedText}`,
    `🔕 **屏蔽频道**：${ignoredText}`,
    '',
    `> **人设简介**：${truncateText(ai.identityPrompt, 90)}`,
    `> **说话风格**：${truncateText(ai.soulPrompt, 90)}`,
    ...(ai.worldbook.trim()
      ? [`> **世界书**：${truncateText(ai.worldbook.trim(), 90)}`]
      : []),
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · AI 对话配置中心`, iconURL: actor.avatarUrl })
    .setTitle(tab === 'channels' ? '📡 AI 频道范围配置（免@ / 白名单 / 屏蔽）' : '🤖 AI 对话与人格记忆管理')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 仅管理员可见；修改立即生效，群友可用 /ai 重置 与 /ai 记忆' })
    .setTimestamp();

  const selectOptions =
    packCards.length > 0
      ? packCards.slice(0, 25).map((card) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(`🎭 ${card.name} (v${card.version})`, 100))
            .setValue(`card:${card.id}`)
            .setDescription(
              truncateText(
                card.description || `${card.personaName} · 词条 ${card.lorebookEntries.length}`,
                100,
              ),
            )
            .setDefault(resolvedBinding.card.id === card.id),
        )
      : Object.values(AI_PERSONA_PRESETS).map((preset) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(preset.label)
            .setValue(preset.key)
            .setDescription(truncateText(preset.description, 100))
            .setDefault(ai.preset === preset.key),
        );

  const presetRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu:admin_ai_preset')
      .setPlaceholder(
        packCards.length > 0
          ? '🎭 一键切换角色人设卡（或用 /ai 预设|角色卡 导入导出）...'
          : '🎭 一键切换内置 AI 人格预设...',
      )
      .addOptions(selectOptions),
  );

  const freeChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('menu:chan:admin_ai_free')
    .setPlaceholder('🗨️ 设置免 @ 直接对话频道（清空即取消）...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    )
    .setMinValues(0)
    .setMaxValues(10);
  if (ai.freeChatChannelIds.length > 0) {
    freeChanSelect.setDefaultChannels(ai.freeChatChannelIds.slice(0, 10));
  }

  const allowedChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('menu:chan:admin_ai_allowed')
    .setPlaceholder('📌 设置 AI 白名单限定频道（清空即全频道允许）...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    )
    .setMinValues(0)
    .setMaxValues(10);
  if (ai.allowedChannelIds.length > 0) {
    allowedChanSelect.setDefaultChannels(ai.allowedChannelIds.slice(0, 10));
  }

  const ignoreChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('menu:chan:admin_ai_ignore')
    .setPlaceholder('🔕 设置 AI 屏蔽频道（清空即取消）...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    )
    .setMinValues(0)
    .setMaxValues(10);
  if (ai.ignoredChannelIds.length > 0) {
    ignoreChanSelect.setDefaultChannels(ai.ignoredChannelIds.slice(0, 10));
  }

  if (tab === 'channels') {
    const components: MenuComponentRow[] = [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(freeChanSelect),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(allowedChanSelect),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ignoreChanSelect),
      buttonRow(
        makeButton('menu:admin:ai_toggle_allowed_here', '📌 切换本频道白名单', ButtonStyle.Secondary),
        makeButton(
          'menu:admin:ai_clear_allowed',
          '🌐 解除白名单限制',
          ButtonStyle.Secondary,
          ai.allowedChannelIds.length === 0,
        ),
        makeButton('menu:nav:admin_ai:basic', '🎭 人设与参数', ButtonStyle.Primary),
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ];
    return { embeds: [embed], components };
  }

  const selfieQuickOptions = [
    ...externalOcProfiles.slice(0, 20).map((profile) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(truncateText(profile.name, 100))
        .setValue(`preset:${profile.id}`)
        .setDescription(truncateText(profile.description, 100)),
    ),
    new StringSelectMenuOptionBuilder()
      .setLabel(`✍️ 自定义专属自设（${truncateText(ai.selfie.customOc.name || 'Custom OC', 30)}）`)
      .setValue('preset:custom')
      .setDescription('切换为自定义自设并打开三级服饰与外貌配置面板'),
    new StringSelectMenuOptionBuilder()
      .setLabel('⚙️ 打开聊天自设详细配置面板（开关 / 冷却 / R18遮罩 / 自定义词）')
      .setValue('nav:selfie')
      .setDescription('查看或编辑完整 OC 外貌锚点、三级景别服饰与冷却参数'),
  ];

  const selfieQuickRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu:admin_ai_selfie_preset')
      .setPlaceholder(
        `📸 聊天自设（OC）：${ai.selfie.enabled ? truncateText(activeOc.name, 36) : '已关闭'}（点击切换或配置）...`,
      )
      .addOptions(selfieQuickOptions),
  );

  const components: MenuComponentRow[] = [
    presetRow,
    selfieQuickRow,
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(freeChanSelect),
    buttonRow(
      makeButton('menu:modal:admin_ai_persona', '✍️ 编辑人设/世界书', ButtonStyle.Primary),
      makeButton('menu:modal:admin_ai_params', '🎛️ 模型与参数', ButtonStyle.Primary),
      makeButton(
        'menu:admin:ai_toggle_memory',
        `🧠 记忆提取: ${ai.memoryEnabled ? '开' : '关'}`,
        ai.memoryEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
      makeButton(
        'menu:admin:ai_toggle_vision',
        `🖼️ 图片识图: ${ai.visionEnabled ? '开' : '关'}`,
        ai.visionEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
      makeButton('menu:admin:ai_reset_config', '♻️ 恢复默认', ButtonStyle.Danger),
    ),
    buttonRow(
      makeButton('menu:nav:admin_ai:profiles', '👤 人物档案', ButtonStyle.Primary),
      makeButton('menu:nav:admin_ai:regex', '🔧 正则与反八股', ButtonStyle.Primary),
      makeButton('menu:nav:admin_ai:usage', '📊 用量与计费', ButtonStyle.Primary),
      makeButton('menu:nav:admin_ai:channels', '🔕 频道范围', ButtonStyle.Primary),
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
    ),
  ];

  return { embeds: [embed], components };
}
