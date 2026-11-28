import type { ModalSubmitInteraction } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { normalizeOcAppearance, normalizeOcCostumeTier } from '../../services/aiOcSelfie.js';
import { formatAiRelationBadge } from '../../services/aiProfiles.js';
import { isValidAiRegexScope, type AiRegexRuleScope } from '../../services/aiRegex.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor } from '../../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  parseIntInRange,
  parseNumberInRange,
  respondFromModal,
} from '../menuHelpers.js';

export async function tryHandleAiMenuModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  if (parts[1] !== 'modal_sub') {
    return false;
  }
  const modalType = parts[2];
  if (
    modalType !== 'admin_ai_persona' &&
    modalType !== 'admin_ai_params' &&
    modalType !== 'admin_ai_regex_add' &&
    modalType !== 'admin_ai_pricing' &&
    modalType !== 'admin_ai_profile_save' &&
    modalType !== 'admin_ai_selfie_appearance' &&
    modalType !== 'admin_ai_selfie_costume'
  ) {
    return false;
  }

  if (!actor.isAdmin) {
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  if (modalType === 'admin_ai_profile_save') {
    const targetUserId = parts[3] ?? '';
    const alias = interaction.fields.getTextInputValue('alias');
    const relation = interaction.fields.getTextInputValue('relation');
    const note = interaction.fields.getTextInputValue('note');

    const res = ctx.services.ai.upsertUserProfile(guildId, {
      userId: targetUserId,
      alias,
      relation,
      note,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'profiles', profilePage: 1 },
        res.ok
          ? {
              type: 'success',
              text: `${res.updated ? '已更新' : '已新增'} ${formatAiRelationBadge(res.profile.relation)} <@${res.profile.userId}> · **${res.profile.alias}**`,
            }
          : { type: 'error', text: res.error },
      ),
    );
    return true;
  }

  if (modalType === 'admin_ai_pricing') {
    const inputPrice = parseNumberInRange(
      interaction.fields.getTextInputValue('inputPricePer1MUsd'),
      0,
      1000,
    );
    const outputPrice = parseNumberInRange(
      interaction.fields.getTextInputValue('outputPricePer1MUsd'),
      0,
      1000,
    );
    if (inputPrice === null || outputPrice === null) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'usage' },
          { type: 'error', text: '单价无效：输入与输出每 1M Tokens 单价均需在 0 ~ 1000 美元之间。' },
        ),
      );
      return true;
    }

    ctx.services.ai.updatePricing(guildId, inputPrice, outputPrice);
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'usage' },
        {
          type: 'success',
          text: `已更新 AI 计费单价：输入 **$${Number(inputPrice.toFixed(4))}**/1M ｜ 输出 **$${Number(outputPrice.toFixed(4))}**/1M。`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_ai_regex_add') {
    const label = interaction.fields.getTextInputValue('label').trim();
    const pattern = interaction.fields.getTextInputValue('pattern').trim();
    const replacement = interaction.fields.getTextInputValue('replacement');
    const scopeRaw = interaction.fields.getTextInputValue('scope').trim().toLowerCase();
    const flags = interaction.fields.getTextInputValue('flags').trim();

    if (!isValidAiRegexScope(scopeRaw)) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'regex', regexPage: 1 },
          { type: 'error', text: '生效范围无效，请填写 `both`、`input` 或 `output`。' },
        ),
      );
      return true;
    }

    const res = ctx.services.ai.addRegexRule(guildId, {
      label,
      pattern,
      replacement,
      scope: scopeRaw as AiRegexRuleScope,
      flags,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'regex', regexPage: 1 },
        res.ok
          ? {
              type: 'success',
              text: `已新增规则 \`${res.rule.id}\` **${res.rule.label}**：\`/${res.rule.pattern}/${res.rule.flags}\` → ${res.rule.replacement ? `\`${res.rule.replacement}\`` : '*(删除)*'}`,
            }
          : { type: 'error', text: res.error },
      ),
    );
    return true;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (modalType === 'admin_ai_selfie_appearance') {
    const name = interaction.fields.getTextInputValue('name').trim().slice(0, 40);
    const cooldownSec = parseIntInRange(
      interaction.fields.getTextInputValue('cooldownSec'),
      0,
      600,
    );
    const rawAppearance = interaction.fields.getTextInputValue('appearance').trim();
    const silhouetteGuard = interaction.fields.getTextInputValue('silhouetteGuard').trim();

    if (!name || cooldownSec === null || !rawAppearance) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'selfie' },
          { type: 'error', text: '参数无效：自设名称与外貌锚点不能为空，冷却需在 0 ~ 600 秒之间。' },
        ),
      );
      return true;
    }

    const normalizedAppearance = normalizeOcAppearance(rawAppearance);
    ctx.repos.guildConfig.updateAi(guildId, {
      ...cfg.ai,
      selfie: {
        ...cfg.ai.selfie,
        enabled: true,
        ocPreset: 'custom',
        cooldownSec,
        customOc: {
          ...cfg.ai.selfie.customOc,
          name,
          appearance: normalizedAppearance,
          silhouetteGuard: silhouetteGuard.slice(0, 400),
        },
      },
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'selfie' },
        {
          type: 'success',
          text: `已保存并启用自定义自设 **${name}**（冷却 **${cooldownSec}s**，外貌锚点已规范化）。`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_ai_selfie_costume') {
    const rawPortrait = interaction.fields.getTextInputValue('costumePortrait').trim();
    const rawUpper = interaction.fields.getTextInputValue('costumeUpper').trim();
    const rawFull = interaction.fields.getTextInputValue('costumeFull').trim();

    const portrait = normalizeOcCostumeTier(rawPortrait);
    if (!portrait) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'selfie' },
          { type: 'error', text: '特写服饰（OC_COSTUME_PORTRAIT）不能为空。' },
        ),
      );
      return true;
    }

    const upper = normalizeOcCostumeTier(rawUpper) || portrait;
    const full = normalizeOcCostumeTier(rawFull) || upper;

    ctx.repos.guildConfig.updateAi(guildId, {
      ...cfg.ai,
      selfie: {
        ...cfg.ai.selfie,
        enabled: true,
        ocPreset: 'custom',
        customOc: {
          ...cfg.ai.selfie.customOc,
          costumePortrait: portrait,
          costumeUpper: upper,
          costumeFull: full,
        },
      },
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'selfie' },
        {
          type: 'success',
          text: `已更新自定义自设 **${cfg.ai.selfie.customOc.name}** 的三级景别服饰配置！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_ai_persona') {
    const personaName = interaction.fields.getTextInputValue('personaName').trim();
    const identityPrompt = interaction.fields.getTextInputValue('identityPrompt').trim();
    const soulPrompt = interaction.fields.getTextInputValue('soulPrompt').trim();
    const worldbook = interaction.fields.getTextInputValue('worldbook').trim();

    if (!personaName || !identityPrompt || !soulPrompt) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          { type: 'error', text: '人格名称、身份设定与说话风格均不能为空。' },
        ),
      );
      return true;
    }

    ctx.services.ai.saveCustomPersona(guildId, {
      personaName,
      identityPrompt,
      soulPrompt,
      worldbook,
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        { type: 'success', text: `已保存自定义人格 **${personaName}** 与世界书设定！` },
      ),
    );
    return true;
  }

  const modelInputRaw = interaction.fields.getTextInputValue('modelOverride').trim();
  let nextModelOverride: string | null = modelInputRaw || null;
  let nextFallbackModel: string | null = cfg.ai.fallbackModel;
  if (modelInputRaw.includes('|')) {
    const [leftRaw, ...rightParts] = modelInputRaw.split('|');
    const left = leftRaw?.trim() ?? '';
    const right = rightParts.join('|').trim();
    nextModelOverride = left || null;
    if (!right || /^(none|off|false|-)$/i.test(right)) {
      nextFallbackModel = null;
    } else {
      nextFallbackModel = right;
    }
  }
  const temperature = parseNumberInRange(
    interaction.fields.getTextInputValue('temperature'),
    0,
    2,
  );
  const maxTokens = parseIntInRange(
    interaction.fields.getTextInputValue('maxTokens'),
    128,
    16384,
  );
  const contextWindowMessages = parseIntInRange(
    interaction.fields.getTextInputValue('contextWindowMessages'),
    0,
    30,
  );
  const maxMemoriesPerScope = parseIntInRange(
    interaction.fields.getTextInputValue('maxMemoriesPerScope'),
    5,
    100,
  );

  if (
    temperature === null ||
    maxTokens === null ||
    contextWindowMessages === null ||
    maxMemoriesPerScope === null
  ) {
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        {
          type: 'error',
          text: '参数格式无效：温度需在 0~2，MaxTokens 128~16384，上下文条数 0~30，记忆上限 5~100。',
        },
      ),
    );
    return true;
  }

  ctx.repos.guildConfig.updateAi(guildId, {
    ...cfg.ai,
    modelOverride: nextModelOverride,
    fallbackModel: nextFallbackModel,
    temperature: Number(temperature.toFixed(2)),
    maxTokens,
    contextWindowMessages,
    maxMemoriesPerScope,
  });

  await respondFromModal(
    interaction,
    buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'admin_ai' },
      {
        type: 'success',
        text: `已更新 AI 模型与上下文参数（主模型：\`${nextModelOverride || ctx.services.ai.getDefaultModel() || '默认'}\`，兜底：\`${nextFallbackModel || '无'}\`，温度 ${Number(temperature.toFixed(2))}）。`,
      },
    ),
  );
  return true;
}
