import { sanitizeStoredRegexRules } from '../../aiRegex.js';
import {
  isValidPackId,
  VALID_SLOTS,
  type CharacterCardPack,
  type LorebookEntry,
  type PresetPack,
  type PresetPromptBlock,
  type PresetPromptSlot,
} from './packTypesAndBuiltins.js';

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function clampOptNumber(val: unknown, min: number, max: number): number | undefined {
  if (typeof val !== 'number' || !Number.isFinite(val)) return undefined;
  return Math.max(min, Math.min(max, val));
}

export function normalizePresetPack(
  raw: unknown,
): { ok: true; pack: PresetPack } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: '预设内容必须是 JSON 对象。' };
  }
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  if (!isValidPackId(id)) {
    return {
      ok: false,
      error: '预设 ID 格式无效：仅允许字母、数字、连字符(-)与下划线(_)，长度 1~64。',
    };
  }
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
  if (!name || name.length > 80) {
    return { ok: false, error: '预设名称不能为空且长度不超过 80 字。' };
  }
  const version =
    typeof raw['version'] === 'string' && raw['version'].trim()
      ? raw['version'].trim().slice(0, 32)
      : '1.0.0';

  if (!Array.isArray(raw['prompts']) || raw['prompts'].length === 0) {
    return { ok: false, error: '预设必须包含非空的 prompts 编排列表。' };
  }

  const prompts: PresetPromptBlock[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw['prompts'].length; i++) {
    const item = raw['prompts'][i];
    if (!isRecord(item)) continue;
    const rawBlockId = typeof item['id'] === 'string' ? item['id'].trim() : `block_${i + 1}`;
    const blockId = rawBlockId && !seenIds.has(rawBlockId) ? rawBlockId : `block_${i + 1}`;
    seenIds.add(blockId);

    const blockName =
      typeof item['name'] === 'string' && item['name'].trim()
        ? item['name'].trim().slice(0, 80)
        : blockId;
    const enabled = typeof item['enabled'] === 'boolean' ? item['enabled'] : true;
    const rawSlot = typeof item['slot'] === 'string' ? item['slot'].trim() : undefined;
    const slot = rawSlot && VALID_SLOTS.has(rawSlot) ? (rawSlot as PresetPromptSlot) : undefined;
    const rawRole = item['role'];
    const role: 'system' | 'user' | 'assistant' | undefined =
      rawRole === 'system' || rawRole === 'user' || rawRole === 'assistant' ? rawRole : undefined;
    const rawPos = item['position'];
    const position: 'top' | 'depth' | undefined =
      rawPos === 'top' || rawPos === 'depth' ? rawPos : undefined;
    const depth =
      typeof item['depth'] === 'number' && Number.isFinite(item['depth'])
        ? Math.max(0, Math.min(100, Math.floor(item['depth'])))
        : undefined;
    const content = typeof item['content'] === 'string' ? item['content'] : undefined;

    prompts.push({
      id: blockId,
      name: blockName,
      enabled,
      ...(slot ? { slot } : {}),
      ...(role ? { role } : {}),
      ...(position ? { position } : {}),
      ...(depth !== undefined ? { depth } : {}),
      ...(content !== undefined ? { content } : {}),
    });
  }

  if (prompts.length === 0) {
    return { ok: false, error: '预设中没有有效的 prompt 块。' };
  }

  const rawSampling = isRecord(raw['sampling']) ? raw['sampling'] : {};
  const temperature = clampOptNumber(rawSampling['temperature'], 0, 2);
  const maxTokensRaw = clampOptNumber(rawSampling['maxTokens'], 64, 32768);
  const maxTokens = maxTokensRaw !== undefined ? Math.floor(maxTokensRaw) : undefined;
  const topP = clampOptNumber(rawSampling['topP'], 0, 1);
  const frequencyPenalty = clampOptNumber(rawSampling['frequencyPenalty'], -2, 2);
  const presencePenalty = clampOptNumber(rawSampling['presencePenalty'], -2, 2);

  const rawPolicy = isRecord(raw['gatewayPolicy']) ? raw['gatewayPolicy'] : {};
  const mergeTopSystem =
    typeof rawPolicy['mergeTopSystem'] === 'boolean' ? rawPolicy['mergeTopSystem'] : true;
  const depthSystemStrategy: 'keep_system' | 'merge_into_user' =
    rawPolicy['depthSystemStrategy'] === 'merge_into_user' ? 'merge_into_user' : 'keep_system';

  const rawCot = isRecord(raw['cotStrip']) ? raw['cotStrip'] : {};
  const cotEnabled = typeof rawCot['enabled'] === 'boolean' ? rawCot['enabled'] : true;
  const rawTags = Array.isArray(rawCot['tags'])
    ? rawCot['tags']
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().replace(/^<+|\/>|>+$/g, ''))
        .filter((t) => /^[a-zA-Z0-9_-]{1,32}$/.test(t))
    : ['think', 'thinking'];
  const tags = rawTags.length > 0 ? [...new Set(rawTags)] : ['think', 'thinking'];

  const rawPrefill = isRecord(raw['assistantPrefill']) ? raw['assistantPrefill'] : {};
  const prefillContent =
    typeof rawPrefill['content'] === 'string' ? rawPrefill['content'] : '';
  const prefillEnabled =
    typeof rawPrefill['enabled'] === 'boolean' ? rawPrefill['enabled'] : false;
  const keepInReply =
    typeof rawPrefill['keepInReply'] === 'boolean' ? rawPrefill['keepInReply'] : false;

  const regexRules = sanitizeStoredRegexRules(raw['regexRules']) ?? [];

  const pack: PresetPack = {
    schemaVersion: 1,
    kind: 'preset',
    id,
    name,
    version,
    ...(typeof raw['author'] === 'string' && raw['author'].trim()
      ? { author: raw['author'].trim().slice(0, 64) }
      : {}),
    ...(typeof raw['description'] === 'string' && raw['description'].trim()
      ? { description: raw['description'].trim().slice(0, 300) }
      : {}),
    sampling: {
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(topP !== undefined ? { topP } : {}),
      ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
      ...(presencePenalty !== undefined ? { presencePenalty } : {}),
    },
    gatewayPolicy: {
      mergeTopSystem,
      depthSystemStrategy,
    },
    cotStrip: {
      enabled: cotEnabled,
      tags,
    },
    assistantPrefill: {
      enabled: prefillEnabled,
      content: prefillContent,
      keepInReply,
    },
    prompts,
    regexRules,
  };

  return { ok: true, pack };
}

export function normalizeCharacterCardPack(
  raw: unknown,
): { ok: true; pack: CharacterCardPack } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: '角色卡内容必须是 JSON 对象。' };
  }
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  if (!isValidPackId(id)) {
    return {
      ok: false,
      error: '角色卡 ID 格式无效：仅允许字母、数字、连字符(-)与下划线(_)，长度 1~64。',
    };
  }
  const personaName = typeof raw['personaName'] === 'string' ? raw['personaName'].trim() : '';
  if (!personaName || personaName.length > 64) {
    return { ok: false, error: '角色卡 personaName 不能为空且长度不超过 64 字。' };
  }
  const name =
    typeof raw['name'] === 'string' && raw['name'].trim()
      ? raw['name'].trim().slice(0, 80)
      : personaName;
  const version =
    typeof raw['version'] === 'string' && raw['version'].trim()
      ? raw['version'].trim().slice(0, 32)
      : '1.0.0';
  const identityPrompt =
    typeof raw['identityPrompt'] === 'string' ? raw['identityPrompt'].trim() : '';
  const soulPrompt = typeof raw['soulPrompt'] === 'string' ? raw['soulPrompt'].trim() : '';
  if (!identityPrompt && !soulPrompt) {
    return { ok: false, error: '角色卡的身份设定（identityPrompt）与说话风格（soulPrompt）不能同时为空。' };
  }

  const exampleDialogue =
    typeof raw['exampleDialogue'] === 'string' ? raw['exampleDialogue'].trim() : '';
  const postHistoryInstructions =
    typeof raw['postHistoryInstructions'] === 'string' && raw['postHistoryInstructions'].trim()
      ? raw['postHistoryInstructions'].trim()
      : undefined;
  const worldbook = typeof raw['worldbook'] === 'string' ? raw['worldbook'].trim() : '';

  const lorebookEntries: LorebookEntry[] = [];
  if (Array.isArray(raw['lorebookEntries'])) {
    const seenLoreIds = new Set<string>();
    for (let i = 0; i < raw['lorebookEntries'].length; i++) {
      const entry = raw['lorebookEntries'][i];
      if (!isRecord(entry)) continue;
      const content = typeof entry['content'] === 'string' ? entry['content'].trim() : '';
      if (!content) continue;

      const rawEntryId = typeof entry['id'] === 'string' ? entry['id'].trim() : `lore_${i + 1}`;
      const entryId = rawEntryId && !seenLoreIds.has(rawEntryId) ? rawEntryId : `lore_${i + 1}`;
      seenLoreIds.add(entryId);

      const keys = Array.isArray(entry['keys'])
        ? entry['keys']
            .filter((k): k is string => typeof k === 'string')
            .map((k) => k.trim())
            .filter(Boolean)
        : [];
      const secondaryKeys = Array.isArray(entry['secondaryKeys'])
        ? entry['secondaryKeys']
            .filter((k): k is string => typeof k === 'string')
            .map((k) => k.trim())
            .filter(Boolean)
        : undefined;
      const constant = typeof entry['constant'] === 'boolean' ? entry['constant'] : keys.length === 0;
      const rawPos = entry['position'];
      const position: 'before_char' | 'after_char' | 'depth' =
        rawPos === 'before_char' || rawPos === 'depth' ? rawPos : 'after_char';
      const depth =
        typeof entry['depth'] === 'number' && Number.isFinite(entry['depth'])
          ? Math.max(0, Math.min(100, Math.floor(entry['depth'])))
          : undefined;
      const rawRole = entry['role'];
      const role: 'system' | 'user' | 'assistant' | undefined =
        rawRole === 'system' || rawRole === 'user' || rawRole === 'assistant' ? rawRole : undefined;
      const enabled = typeof entry['enabled'] === 'boolean' ? entry['enabled'] : true;
      const comment =
        typeof entry['comment'] === 'string' ? entry['comment'].trim().slice(0, 80) : entryId;

      lorebookEntries.push({
        id: entryId,
        comment,
        keys,
        ...(secondaryKeys && secondaryKeys.length > 0 ? { secondaryKeys } : {}),
        constant,
        position,
        ...(depth !== undefined ? { depth } : {}),
        ...(role ? { role } : {}),
        enabled,
        content,
      });
    }
  }

  const regexRules = sanitizeStoredRegexRules(raw['regexRules']) ?? [];

  const pack: CharacterCardPack = {
    schemaVersion: 1,
    kind: 'card',
    id,
    name,
    version,
    ...(typeof raw['author'] === 'string' && raw['author'].trim()
      ? { author: raw['author'].trim().slice(0, 64) }
      : {}),
    ...(typeof raw['description'] === 'string' && raw['description'].trim()
      ? { description: raw['description'].trim().slice(0, 300) }
      : {}),
    personaName,
    identityPrompt,
    soulPrompt,
    exampleDialogue,
    ...(postHistoryInstructions ? { postHistoryInstructions } : {}),
    worldbook,
    lorebookEntries,
    regexRules,
  };

  return { ok: true, pack };
}
