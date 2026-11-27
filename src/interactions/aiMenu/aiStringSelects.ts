import type { StringSelectMenuInteraction } from 'discord.js';
import { AI_PERSONA_PRESETS, type AiPersonaPresetKey } from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import { listOcOutfits } from '../../services/aiOcSelfie.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor } from '../../ui/menuShared.js';
import { ADMIN_DENIED_FEEDBACK } from '../menuHelpers.js';

export async function tryHandleAiMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  if (parts[1] === 'admin_ai_regex_toggle' || parts[1] === 'admin_ai_regex_delete') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const parsedPage = parts[2] ? Number.parseInt(parts[2], 10) : 1;
    const regexPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const ruleId = interaction.values[0];
    if (!ruleId) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'regex', regexPage },
          { type: 'error', text: '未选择任何正则规则。' },
        ),
      );
      return true;
    }

    if (parts[1] === 'admin_ai_regex_toggle') {
      const res = ctx.services.ai.toggleRegexRule(guildId, ruleId);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'regex', regexPage },
          res.ok
            ? {
                type: 'success',
                text: `规则 \`${res.rule.id}\`（${res.rule.label}）已切换为：**${res.rule.enabled ? '启用' : '停用'}**。`,
              }
            : { type: 'error', text: res.error },
        ),
      );
      return true;
    }

    const res = ctx.services.ai.deleteRegexRule(guildId, ruleId);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'regex', regexPage },
        res.ok
          ? {
              type: 'success',
              text: `已删除正则规则 \`${res.rule.id}\`（${res.rule.label}）。`,
            }
          : { type: 'error', text: res.error },
      ),
    );
    return true;
  }

  if (parts[1] === 'admin_ai_profile_delete') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const parsedPage = parts[2] ? Number.parseInt(parts[2], 10) : 1;
    const profilePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const targetUserId = interaction.values[0];
    if (!targetUserId) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'profiles', profilePage },
          { type: 'error', text: '未选择任何人物档案。' },
        ),
      );
      return true;
    }

    const res = ctx.services.ai.deleteUserProfile(guildId, targetUserId);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'profiles', profilePage },
        res.ok
          ? {
              type: 'success',
              text: `已删除 <@${res.profile.userId}>（**${res.profile.alias}**）的人物档案。`,
            }
          : { type: 'error', text: res.error },
      ),
    );
    return true;
  }

  if (parts[1] === 'admin_ai_selfie_preset') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const chosen = interaction.values[0] ?? '';
    if (chosen === 'nav:selfie') {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'admin_ai', tab: 'selfie' }),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    if (chosen.startsWith('preset:')) {
      const nextPreset = chosen.slice('preset:'.length).trim();
      const matchedExternal =
        nextPreset === 'custom'
          ? null
          : ctx.services.ai.listOcProfiles().find((p) => p.id === nextPreset) ?? null;

      if (nextPreset === 'custom' || matchedExternal) {
        ctx.repos.guildConfig.updateAi(guildId, {
          ...cfg.ai,
          selfie: {
            ...cfg.ai.selfie,
            enabled: true,
            ocPreset: nextPreset,
            outfitMode: 'ootd',
          },
        });
        const label = matchedExternal
          ? matchedExternal.name
          : `✍️ ${cfg.ai.selfie.customOc.name || '自定义专属自设'}`;
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ai', tab: 'selfie' },
            {
              type: 'success',
              text: `已切换聊天自设（OC）为：**${label}**（聊天拍照技能已开启）。`,
            },
          ),
        );
        return true;
      }
    }

    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'selfie' },
        { type: 'error', text: '无效的自设预设选项。' },
      ),
    );
    return true;
  }

  if (parts[1] === 'admin_ai_selfie_outfit') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    const activeOc = ctx.services.ai.resolveActiveOcProfile(cfg.ai.selfie);
    const outfits = listOcOutfits(activeOc);
    const chosen = interaction.values[0] ?? '';

    if (chosen === 'mode:ootd') {
      const nextSelfie = {
        ...cfg.ai.selfie,
        outfitMode: 'ootd',
      };
      ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, selfie: nextSelfie });
      const todayOutfit = ctx.services.ai.resolveActiveOcOutfit(nextSelfie);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'selfie' },
          {
            type: 'success',
            text: `已恢复为 **📅 每日 OOTD 自动轮换**（今日穿搭：**${todayOutfit.name}**）。`,
          },
        ),
      );
      return true;
    }

    if (chosen.startsWith('outfit:')) {
      const targetOutfitId = chosen.slice('outfit:'.length).trim();
      const matchedOutfit = outfits.find((o) => o.id === targetOutfitId);
      if (matchedOutfit) {
        ctx.repos.guildConfig.updateAi(guildId, {
          ...cfg.ai,
          selfie: {
            ...cfg.ai.selfie,
            outfitMode: matchedOutfit.id,
          },
        });
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ai', tab: 'selfie' },
            {
              type: 'success',
              text: `已锁定当前默认穿搭为：**${matchedOutfit.name}**（选回“自动每日穿搭”即可恢复按日轮换）。`,
            },
          ),
        );
        return true;
      }
    }

    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'selfie' },
        { type: 'error', text: '无效的穿搭选项。' },
      ),
    );
    return true;
  }

  if (parts[1] !== 'admin_ai_preset') {
    return false;
  }

  if (!actor.isAdmin) {
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  const rawSelected = interaction.values[0];
  if (rawSelected?.startsWith('card:')) {
    const cardId = rawSelected.slice('card:'.length);
    const res = ctx.services.ai.setGuildActiveCard(guildId, cardId);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        res.ok
          ? {
              type: 'success',
              text: `已切换全服角色卡为：**${res.card.personaName}**（\`${res.card.id}@v${res.card.version}\`）。`,
            }
          : { type: 'error', text: res.error },
      ),
    );
    return true;
  }

  const selected = rawSelected as Exclude<AiPersonaPresetKey, 'custom'> | undefined;
  const preset = selected ? AI_PERSONA_PRESETS[selected] : undefined;
  if (!preset) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        { type: 'error', text: '无效的 AI 人格预设选项。' },
      ),
    );
    return true;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const matchingDiskCard = ctx.services.ai.getPackStore()?.getCard(preset.key) ?? null;
  if (matchingDiskCard) {
    ctx.repos.guildConfig.updateAi(guildId, {
      ...cfg.ai,
      preset: preset.key,
      activeCardId: matchingDiskCard.id,
      personaName: matchingDiskCard.personaName,
      identityPrompt: matchingDiskCard.identityPrompt,
      soulPrompt: matchingDiskCard.soulPrompt,
      worldbook: matchingDiskCard.worldbook || cfg.ai.worldbook,
    });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        {
          type: 'success',
          text: `已切换 AI 角色卡为：**${matchingDiskCard.name}**（\`v${matchingDiskCard.version}\`）。`,
        },
      ),
    );
    return true;
  }

  ctx.repos.guildConfig.updateAi(guildId, {
    ...cfg.ai,
    preset: preset.key,
    activeCardId: null,
    personaName: preset.personaName,
    identityPrompt: preset.identityPrompt,
    soulPrompt: preset.soulPrompt,
  });

  await interaction.update(
    buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'admin_ai' },
      { type: 'success', text: `已切换 AI 人格预设为：**${preset.label}**。` },
    ),
  );
  return true;
}
