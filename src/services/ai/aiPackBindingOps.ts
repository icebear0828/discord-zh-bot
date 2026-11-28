import { DEFAULT_AI_CONFIG, type AiChannelOverride } from '../../config/defaults.js';
import {
  importCardFromUnknownJson,
  importPresetFromUnknownJson,
  type ImportPackOptions,
} from '../stPresetConverter.js';
import {
  createBuiltinDefaultCard,
  createBuiltinDefaultPreset,
  DEFAULT_PACK_PRESET_ID,
  isValidPackId,
  slugifyPackId,
  type CharacterCardPack,
  type PackHistoryEntry,
  type PresetPack,
} from './packs/packTypesAndBuiltins.js';
import type { AiServiceRuntimeDeps, ResolvedAiBinding } from './aiTypes.js';

export async function downloadTextAttachmentOp(
  deps: Pick<AiServiceRuntimeDeps, 'fetchFn'>,
  url: string,
  maxBytes = 2 * 1024 * 1024,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const res = await deps.fetchFn(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return { ok: false, error: `下载附件失败（HTTP ${res.status}）。` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      return { ok: false, error: '上传的附件内容为空。' };
    }
    if (buf.byteLength > maxBytes) {
      return {
        ok: false,
        error: `附件体积超出限制（最大允许 ${(maxBytes / 1024 / 1024).toFixed(1)} MB）。`,
      };
    }
    return { ok: true, text: buf.toString('utf8') };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `读取附件异常：${msg}` };
  }
}

export function listPresetsOp(deps: Pick<AiServiceRuntimeDeps, 'packStore'>): PresetPack[] {
  return deps.packStore ? deps.packStore.listPresets() : [createBuiltinDefaultPreset()];
}

export function listCardsOp(deps: Pick<AiServiceRuntimeDeps, 'packStore'>): CharacterCardPack[] {
  return deps.packStore ? deps.packStore.listCards() : [createBuiltinDefaultCard()];
}

export function reloadPacksOp(
  deps: Pick<AiServiceRuntimeDeps, 'packStore'>,
): { presets: number; cards: number } {
  if (!deps.packStore) {
    return { presets: 1, cards: 1 };
  }
  return deps.packStore.reloadAll();
}

export function listPackHistoryOp(
  deps: Pick<AiServiceRuntimeDeps, 'packStore'>,
  kind: 'preset' | 'card',
  id: string,
): PackHistoryEntry[] {
  if (!deps.packStore) return [];
  return deps.packStore.listHistory(kind, id);
}

export function importPresetJsonOp(
  deps: Pick<AiServiceRuntimeDeps, 'packStore'>,
  rawJsonText: string,
  opts: ImportPackOptions = {},
):
  | {
      ok: true;
      pack: PresetPack;
      sourceFormat: 'native_preset' | 'sillytavern_preset';
      archivedPrevious: boolean;
    }
  | { ok: false; error: string } {
  if (!deps.packStore) {
    return { ok: false, error: '当前环境未挂载磁盘预设仓库（AiPackStore）。' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `JSON 解析失败：${msg}` };
  }
  const imported = importPresetFromUnknownJson(parsed, opts);
  if (!imported.ok) return imported;

  const saved = deps.packStore.savePreset(imported.pack);
  if (!saved.ok) return saved;

  return {
    ok: true,
    pack: saved.pack,
    sourceFormat: imported.sourceFormat,
    archivedPrevious: saved.archivedPrevious,
  };
}

export function importCardJsonOp(
  deps: Pick<AiServiceRuntimeDeps, 'packStore'>,
  rawJsonText: string,
  opts: ImportPackOptions = {},
):
  | {
      ok: true;
      pack: CharacterCardPack;
      sourceFormat: 'native_card' | 'sillytavern_card';
      archivedPrevious: boolean;
    }
  | { ok: false; error: string } {
  if (!deps.packStore) {
    return { ok: false, error: '当前环境未挂载磁盘角色卡仓库（AiPackStore）。' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `JSON 解析失败：${msg}` };
  }
  const imported = importCardFromUnknownJson(parsed, opts);
  if (!imported.ok) return imported;

  const saved = deps.packStore.saveCard(imported.pack);
  if (!saved.ok) return saved;

  return {
    ok: true,
    pack: saved.pack,
    sourceFormat: imported.sourceFormat,
    archivedPrevious: saved.archivedPrevious,
  };
}

export function exportPresetOp(
  deps: Pick<AiServiceRuntimeDeps, 'guildConfigRepo' | 'llmClient' | 'packStore'>,
  guildId: string,
  presetId?: string,
  channelId?: string,
): PresetPack | null {
  if (presetId?.trim()) {
    return deps.packStore
      ? deps.packStore.getPreset(presetId.trim())
      : presetId.trim() === DEFAULT_PACK_PRESET_ID
        ? createBuiltinDefaultPreset()
        : null;
  }
  return resolveEffectiveBindingOp(deps, guildId, channelId).preset;
}

export function exportCardOp(
  deps: Pick<AiServiceRuntimeDeps, 'guildConfigRepo' | 'llmClient' | 'packStore'>,
  guildId: string,
  cardId?: string,
  channelId?: string,
): CharacterCardPack | null {
  if (cardId?.trim()) {
    return deps.packStore ? deps.packStore.getCard(cardId.trim()) : null;
  }
  return resolveEffectiveBindingOp(deps, guildId, channelId).card;
}

export function rollbackPresetOp(
  deps: Pick<AiServiceRuntimeDeps, 'packStore'>,
  id: string,
  targetFileName?: string,
): { ok: true; restored: PresetPack } | { ok: false; error: string } {
  if (!deps.packStore) {
    return { ok: false, error: '当前环境未挂载磁盘预设仓库（AiPackStore）。' };
  }
  return deps.packStore.rollbackPreset(id, targetFileName);
}

export function rollbackCardOp(
  deps: Pick<AiServiceRuntimeDeps, 'packStore'>,
  id: string,
  targetFileName?: string,
): { ok: true; restored: CharacterCardPack } | { ok: false; error: string } {
  if (!deps.packStore) {
    return { ok: false, error: '当前环境未挂载磁盘角色卡仓库（AiPackStore）。' };
  }
  return deps.packStore.rollbackCard(id, targetFileName);
}

export function setGuildActivePresetOp(
  deps: Pick<AiServiceRuntimeDeps, 'guildConfigRepo' | 'packStore'>,
  guildId: string,
  presetId: string,
): { ok: true; preset: PresetPack } | { ok: false; error: string } {
  const trimmed = presetId.trim();
  const found = deps.packStore
    ? deps.packStore.getPreset(trimmed)
    : trimmed === DEFAULT_PACK_PRESET_ID
      ? createBuiltinDefaultPreset()
      : null;
  if (!found) {
    return { ok: false, error: `找不到编号为 \`${trimmed}\` 的破限预设。` };
  }
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    activePresetId: found.id,
  });
  return { ok: true, preset: found };
}

export function setGuildActiveCardOp(
  deps: Pick<AiServiceRuntimeDeps, 'guildConfigRepo' | 'packStore'>,
  guildId: string,
  cardId: string,
): { ok: true; card: CharacterCardPack } | { ok: false; error: string } {
  const trimmed = cardId.trim();
  const found = deps.packStore ? deps.packStore.getCard(trimmed) : null;
  if (!found) {
    return { ok: false, error: `找不到编号为 \`${trimmed}\` 的角色卡。` };
  }
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  // Mirror core persona fields into legacy AiConfig columns so code rollbacks remain 100% seamless
  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    activeCardId: found.id,
    personaName: found.personaName,
    identityPrompt: found.identityPrompt,
    soulPrompt: found.soulPrompt,
    worldbook: found.worldbook || cfg.ai.worldbook,
  });
  return { ok: true, card: found };
}

export function setChannelOverrideOp(
  deps: Pick<AiServiceRuntimeDeps, 'guildConfigRepo' | 'packStore'>,
  guildId: string,
  channelId: string,
  override: AiChannelOverride,
): { ok: true; override: AiChannelOverride } | { ok: false; error: string } {
  if (override.presetId) {
    const p = deps.packStore ? deps.packStore.getPreset(override.presetId) : null;
    if (!p) {
      return { ok: false, error: `找不到破限预设 \`${override.presetId}\`。` };
    }
  }
  if (override.cardId) {
    const c = deps.packStore ? deps.packStore.getCard(override.cardId) : null;
    if (!c) {
      return { ok: false, error: `找不到角色卡 \`${override.cardId}\`。` };
    }
  }

  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const existingOverrides = { ...(cfg.ai.channelOverrides ?? {}) };
  const prev = existingOverrides[channelId] ?? {};
  const merged: AiChannelOverride = {
    ...prev,
    ...(override.presetId !== undefined ? { presetId: override.presetId } : {}),
    ...(override.cardId !== undefined ? { cardId: override.cardId } : {}),
    ...(override.modelOverride !== undefined ? { modelOverride: override.modelOverride } : {}),
    ...(override.fallbackModel !== undefined ? { fallbackModel: override.fallbackModel } : {}),
  };
  existingOverrides[channelId] = merged;

  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    channelOverrides: existingOverrides,
  });
  return { ok: true, override: merged };
}

export function clearChannelOverrideOp(
  deps: Pick<AiServiceRuntimeDeps, 'guildConfigRepo'>,
  guildId: string,
  channelId: string,
): boolean {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const existingOverrides = { ...(cfg.ai.channelOverrides ?? {}) };
  if (!(channelId in existingOverrides)) {
    return false;
  }
  delete existingOverrides[channelId];
  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    channelOverrides: existingOverrides,
  });
  return true;
}

export function saveCustomPersonaOp(
  deps: Pick<AiServiceRuntimeDeps, 'guildConfigRepo' | 'packStore'>,
  guildId: string,
  input: {
    personaName: string;
    identityPrompt: string;
    soulPrompt: string;
    worldbook: string;
  },
): { activeCardId: string | null } {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  let nextActiveCardId: string | null = null;

  if (deps.packStore) {
    const customCardId = slugifyPackId(`custom-guild-${guildId.slice(-6)}`, 'custom-card');
    const existing = deps.packStore.getCard(customCardId);
    const saved = deps.packStore.saveCard({
      schemaVersion: 1,
      kind: 'card',
      id: customCardId,
      name: `✍️ ${input.personaName}（自定义人设）`,
      version: existing?.version ?? '1.0.0',
      personaName: input.personaName,
      identityPrompt: input.identityPrompt,
      soulPrompt: input.soulPrompt,
      exampleDialogue: existing?.exampleDialogue ?? '',
      ...(existing?.postHistoryInstructions
        ? { postHistoryInstructions: existing.postHistoryInstructions }
        : {}),
      worldbook: input.worldbook,
      lorebookEntries: existing?.lorebookEntries ?? [],
      regexRules: existing?.regexRules ?? [],
    });
    if (saved.ok) {
      nextActiveCardId = saved.pack.id;
    }
  }

  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    preset: 'custom',
    activeCardId: nextActiveCardId,
    personaName: input.personaName,
    identityPrompt: input.identityPrompt,
    soulPrompt: input.soulPrompt,
    worldbook: input.worldbook,
  });

  return { activeCardId: nextActiveCardId };
}

export function migrateLegacyGuildConfigToPacksOp(
  deps: Pick<AiServiceRuntimeDeps, 'guildConfigRepo' | 'packStore'>,
  guildId: string,
): void {
  if (!deps.packStore) return;
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const aiCfg = cfg.ai;
  const currentBoundCard = aiCfg.activeCardId ? deps.packStore.getCard(aiCfg.activeCardId) : null;
  const isClobberedCustomConfig =
    aiCfg.preset === 'custom' &&
    currentBoundCard !== null &&
    !currentBoundCard.id.startsWith('custom-guild-') &&
    (currentBoundCard.identityPrompt.trim() !== aiCfg.identityPrompt.trim() ||
      currentBoundCard.soulPrompt.trim() !== aiCfg.soulPrompt.trim());
  if (currentBoundCard && !isClobberedCustomConfig) {
    return;
  }

  // Only bind an existing disk card when preset is NOT 'custom' and prompts match identically
  if (aiCfg.preset !== 'custom') {
    const matchedDiskCard = deps.packStore
      .listCards()
      .find(
        (c) =>
          c.personaName === aiCfg.personaName &&
          c.identityPrompt.trim() === aiCfg.identityPrompt.trim() &&
          c.soulPrompt.trim() === aiCfg.soulPrompt.trim(),
      );
    if (matchedDiskCard) {
      deps.guildConfigRepo.updateAi(guildId, {
        ...aiCfg,
        activeCardId: matchedDiskCard.id,
        activePresetId: aiCfg.activePresetId || DEFAULT_PACK_PRESET_ID,
      });
      return;
    }
  }

  const isNonDefault =
    aiCfg.preset === 'custom' ||
    aiCfg.personaName !== DEFAULT_AI_CONFIG.personaName ||
    aiCfg.identityPrompt !== DEFAULT_AI_CONFIG.identityPrompt ||
    aiCfg.soulPrompt !== DEFAULT_AI_CONFIG.soulPrompt;
  if (!isNonDefault) return;

  const cardId =
    isValidPackId(aiCfg.preset) &&
    aiCfg.preset !== 'custom' &&
    !deps.packStore.getCard(aiCfg.preset)
      ? aiCfg.preset
      : slugifyPackId(`custom-guild-${guildId.slice(-6)}`, 'migrated-card');
  const saved = deps.packStore.saveCard({
    schemaVersion: 1,
    kind: 'card',
    id: cardId,
    name:
      aiCfg.preset === 'custom'
        ? `✍️ ${aiCfg.personaName}（自定义人设）`
        : `${aiCfg.personaName}（存量自动迁入）`,
    version: '1.0.0',
    personaName: aiCfg.personaName,
    identityPrompt: aiCfg.identityPrompt,
    soulPrompt: aiCfg.soulPrompt,
    exampleDialogue: '',
    worldbook: aiCfg.worldbook,
    lorebookEntries: [],
    regexRules: [],
  });
  if (saved.ok) {
    deps.guildConfigRepo.updateAi(guildId, {
      ...aiCfg,
      activeCardId: saved.pack.id,
      activePresetId: aiCfg.activePresetId || DEFAULT_PACK_PRESET_ID,
    });
  }
}

export function resolveEffectiveBindingOp(
  deps: Pick<AiServiceRuntimeDeps, 'guildConfigRepo' | 'llmClient' | 'packStore'>,
  guildId: string,
  channelId?: string,
): ResolvedAiBinding {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const aiCfg = cfg.ai;
  const chOverride = channelId ? aiCfg.channelOverrides?.[channelId] : undefined;

  const requestedPresetId = chOverride?.presetId || aiCfg.activePresetId || DEFAULT_PACK_PRESET_ID;
  const presetFromStore = deps.packStore ? deps.packStore.getPreset(requestedPresetId) : null;
  const preset = presetFromStore ?? createBuiltinDefaultPreset();
  const usingCustomPreset = Boolean(
    presetFromStore && presetFromStore.id !== DEFAULT_PACK_PRESET_ID,
  );

  const requestedCardId = chOverride?.cardId || aiCfg.activeCardId || null;
  const cardFromStore =
    requestedCardId && deps.packStore ? deps.packStore.getCard(requestedCardId) : null;

  const card: CharacterCardPack = cardFromStore ?? {
    schemaVersion: 1,
    kind: 'card',
    id: aiCfg.preset || 'inline-guild-config',
    name: aiCfg.personaName,
    version: '1.0.0',
    personaName: aiCfg.personaName,
    identityPrompt: aiCfg.identityPrompt,
    soulPrompt: aiCfg.soulPrompt,
    exampleDialogue: '',
    worldbook: aiCfg.worldbook,
    lorebookEntries: [],
    regexRules: [],
  };

  const effectiveModel =
    chOverride?.modelOverride?.trim() ||
    aiCfg.modelOverride?.trim() ||
    deps.llmClient.getDefaultModel();

  const rawFallback =
    chOverride?.fallbackModel !== undefined
      ? chOverride.fallbackModel
      : aiCfg.fallbackModel !== undefined
        ? aiCfg.fallbackModel
        : deps.llmClient.getFallbackModel() || null;
  const normalizedFallback = rawFallback?.trim() || null;
  const effectiveFallbackModel =
    normalizedFallback && normalizedFallback !== effectiveModel ? normalizedFallback : null;

  return {
    preset,
    card,
    effectiveModel,
    effectiveFallbackModel,
    usingCustomPreset,
    isChannelOverridden: Boolean(chOverride),
    ...(chOverride ? { channelOverride: chOverride } : {}),
  };
}
