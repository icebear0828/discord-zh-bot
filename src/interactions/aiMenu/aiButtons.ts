import type { ButtonInteraction } from 'discord.js';
import {
  DEFAULT_AI_CONFIG,
  DEFAULT_AI_SELFIE_CONFIG,
  DEFAULT_CUSTOM_OC_CONFIG,
} from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import { cloneDefaultAiRegexRules } from '../../services/aiRegex.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor } from '../../ui/menuShared.js';
import { ADMIN_DENIED_FEEDBACK } from '../menuHelpers.js';
import {
  buildAiParamsModal,
  buildAiPersonaModal,
  buildAiPricingModal,
  buildAiRegexAddModal,
  buildAiSelfieAppearanceModal,
  buildAiSelfieCostumeModal,
} from './aiModals.js';

export async function tryHandleAiMenuButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const section = parts[1];

  if (section === 'nav' && parts[2] === 'admin_ai') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const tabRaw = parts[3];
    const tab: 'basic' | 'channels' | 'regex' | 'usage' | 'profiles' | 'selfie' =
      tabRaw === 'channels'
        ? 'channels'
        : tabRaw === 'regex'
          ? 'regex'
          : tabRaw === 'usage'
            ? 'usage'
            : tabRaw === 'profiles'
              ? 'profiles'
              : tabRaw === 'selfie'
                ? 'selfie'
                : 'basic';
    const parsedPage = parts[4] ? Number.parseInt(parts[4], 10) : 1;
    const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, {
        page: 'admin_ai',
        tab,
        regexPage: tab === 'regex' ? safePage : 1,
        profilePage: tab === 'profiles' ? safePage : 1,
      }),
    );
    return true;
  }

  if (
    section === 'modal' &&
    (parts[2] === 'admin_ai_persona' ||
      parts[2] === 'admin_ai_params' ||
      parts[2] === 'admin_ai_regex_add' ||
      parts[2] === 'admin_ai_pricing' ||
      parts[2] === 'admin_ai_selfie_appearance' ||
      parts[2] === 'admin_ai_selfie_costume')
  ) {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    if (parts[2] === 'admin_ai_persona') {
      await interaction.showModal(buildAiPersonaModal(cfg.ai));
    } else if (parts[2] === 'admin_ai_params') {
      await interaction.showModal(
        buildAiParamsModal(
          cfg.ai,
          ctx.services.ai.getDefaultModel(),
          ctx.services.ai.getFallbackModel(),
        ),
      );
    } else if (parts[2] === 'admin_ai_pricing') {
      await interaction.showModal(buildAiPricingModal(cfg.ai));
    } else if (parts[2] === 'admin_ai_selfie_appearance') {
      await interaction.showModal(buildAiSelfieAppearanceModal(cfg.ai.selfie));
    } else if (parts[2] === 'admin_ai_selfie_costume') {
      await interaction.showModal(buildAiSelfieCostumeModal(cfg.ai.selfie));
    } else {
      await interaction.showModal(buildAiRegexAddModal());
    }
    return true;
  }

  if (section === 'admin') {
    const action = parts[2];
    const handled = new Set([
      'ai_toggle_memory',
      'ai_toggle_vision',
      'ai_toggle_selfie',
      'ai_toggle_selfie_nsfw',
      'ai_reroll_selfie_ootd',
      'ai_toggle_allowed_here',
      'ai_clear_allowed',
      'ai_reset_config',
      'ai_toggle_cliche_prompt',
      'ai_regex_reset',
      'ai_clear_usage',
    ]);
    if (!action || !handled.has(action)) {
      return false;
    }

    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (action === 'ai_toggle_memory') {
      const next = !cfg.ai.memoryEnabled;
      ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, memoryEnabled: next });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          { type: 'success', text: `AI 自动长期记忆提取已切换为：**${next ? '开启' : '关闭'}**。` },
        ),
      );
      return true;
    }

    if (action === 'ai_toggle_vision') {
      const next = !cfg.ai.visionEnabled;
      ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, visionEnabled: next });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          { type: 'success', text: `AI 图片识图能力已切换为：**${next ? '开启' : '关闭'}**。` },
        ),
      );
      return true;
    }

    if (action === 'ai_toggle_selfie') {
      const next = !cfg.ai.selfie.enabled;
      ctx.repos.guildConfig.updateAi(guildId, {
        ...cfg.ai,
        selfie: { ...cfg.ai.selfie, enabled: next },
      });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'selfie' },
          {
            type: 'success',
            text: `AI 聊天自设生图已切换为：**${next ? '开启' : '关闭'}**。`,
          },
        ),
      );
      return true;
    }

    if (action === 'ai_toggle_selfie_nsfw') {
      const next = !cfg.ai.selfie.allowNsfw;
      ctx.repos.guildConfig.updateAi(guildId, {
        ...cfg.ai,
        selfie: { ...cfg.ai.selfie, allowNsfw: next },
      });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'selfie' },
          {
            type: 'success',
            text: next
              ? '已开启 **🔞 R18 遮罩模式**：日常默认 SFW，群友明确索要 R18 时启用无码词并自动打模糊遮罩。'
              : '已切换为 **🔒 严格 SFW 模式**：聊天自设生图一律禁止裸露色情标签。',
          },
        ),
      );
      return true;
    }

    if (action === 'ai_reroll_selfie_ootd') {
      const nextOffset = ((cfg.ai.selfie.ootdOffset ?? 0) + 1) % 10_000;
      const nextSelfie = {
        ...cfg.ai.selfie,
        outfitMode: 'ootd',
        ootdOffset: nextOffset,
      };
      ctx.repos.guildConfig.updateAi(guildId, {
        ...cfg.ai,
        selfie: nextSelfie,
      });
      const nextOutfit = ctx.services.ai.resolveActiveOcOutfit(nextSelfie);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'selfie' },
          {
            type: 'success',
            text: `已换上新的今日穿搭（OOTD）：**${nextOutfit.name}**（明天将继续自动按日轮换）。`,
          },
        ),
      );
      return true;
    }

    if (action === 'ai_toggle_allowed_here') {
      const channelId = interaction.channelId;
      if (!channelId) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ai' },
            { type: 'error', text: '无法识别当前频道 ID。' },
          ),
        );
        return true;
      }
      const set = new Set(cfg.ai.allowedChannelIds);
      const added = !set.has(channelId);
      if (added) {
        set.add(channelId);
      } else {
        set.delete(channelId);
      }
      ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, allowedChannelIds: [...set] });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          {
            type: 'success',
            text: added
              ? `已将 <#${channelId}> 加入 AI 白名单频道。`
              : `已将 <#${channelId}> 移出 AI 白名单频道。`,
          },
        ),
      );
      return true;
    }

    if (action === 'ai_clear_allowed') {
      ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, allowedChannelIds: [] });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          { type: 'success', text: '已清空 AI 频道白名单限制，现在全服频道均可触发（除屏蔽频道）。' },
        ),
      );
      return true;
    }

    if (action === 'ai_reset_config') {
      ctx.repos.guildConfig.updateAi(guildId, {
        ...DEFAULT_AI_CONFIG,
        antiClichePromptEnabled: true,
        regexRules: cloneDefaultAiRegexRules(),
        userProfiles: cfg.ai.userProfiles,
        selfie: {
          ...DEFAULT_AI_SELFIE_CONFIG,
          customOc: { ...DEFAULT_CUSTOM_OC_CONFIG },
        },
        freeChatChannelIds: [],
        allowedChannelIds: [],
        ignoredChannelIds: [],
      });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          {
            type: 'success',
            text: '已将 AI 人设、正则与频道配置恢复为默认设置（人物档案与历史记忆库已保留）。',
          },
        ),
      );
      return true;
    }

    if (action === 'ai_toggle_cliche_prompt') {
      const next = ctx.services.ai.toggleAntiClichePrompt(guildId);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'regex', regexPage: 1 },
          {
            type: 'success',
            text: `AI 全局反八股系统提示词已切换为：**${next ? '开启' : '关闭'}**。`,
          },
        ),
      );
      return true;
    }

    if (action === 'ai_regex_reset') {
      const rules = ctx.services.ai.resetRegexRules(guildId);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'regex', regexPage: 1 },
          {
            type: 'success',
            text: `已恢复默认的 **${rules.length}** 条代称与反八股正则规则，并开启反八股提示词。`,
          },
        ),
      );
      return true;
    }

    if (action === 'ai_clear_usage') {
      const deleted = ctx.services.ai.clearUsageLogs(guildId);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'usage' },
          {
            type: 'success',
            text: `已清空本服 AI 用量日志，共移除 **${deleted}** 条记录。`,
          },
        ),
      );
      return true;
    }
  }

  return false;
}
