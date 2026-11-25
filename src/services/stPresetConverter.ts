import {
  createBuiltinDefaultPreset,
  isValidPackId,
  normalizeCharacterCardPack,
  normalizePresetPack,
  slugifyPackId,
  type CharacterCardPack,
  type LorebookEntry,
  type PresetPack,
  type PresetPromptBlock,
  type PresetPromptSlot,
} from './aiPackStore.js';
import {
  generateAiRegexRuleId,
  validateAiRegexRuleInput,
  type AiRegexRule,
  type AiRegexRuleScope,
} from './aiRegex.js';

export interface ImportPackOptions {
  fallbackId?: string;
  fallbackName?: string;
}

export type ImportPresetResult =
  | {
      ok: true;
      pack: PresetPack;
      sourceFormat: 'native_preset' | 'sillytavern_preset';
    }
  | {
      ok: false;
      error: string;
    };

export type ImportCardResult =
  | {
      ok: true;
      pack: CharacterCardPack;
      sourceFormat: 'native_card' | 'sillytavern_card';
    }
  | {
      ok: false;
      error: string;
    };

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

const ST_MARKER_TO_SLOT: Readonly<Record<string, PresetPromptSlot>> = {
  charDescription: 'char_identity',
  charPersonality: 'char_soul',
  dialogueExamples: 'example_dialogue',
  worldInfoBefore: 'worldbook',
  worldInfoAfter: 'worldbook',
  chatHistory: 'chat_history',
};

function parseSlashRegexString(raw: string): { pattern: string; flags: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const lastSlash = trimmed.lastIndexOf('/');
    return {
      pattern: trimmed.slice(1, lastSlash),
      flags: trimmed.slice(lastSlash + 1) || 'gi',
    };
  }
  return { pattern: trimmed, flags: 'gi' };
}

function convertStRegexScripts(rawScripts: unknown): AiRegexRule[] {
  if (!Array.isArray(rawScripts)) return [];
  const rules: AiRegexRule[] = [];
  const seenIds = new Set<string>();

  for (const item of rawScripts) {
    if (!isRecord(item)) continue;
    const findRegex = typeof item['findRegex'] === 'string' ? item['findRegex'].trim() : '';
    if (!findRegex) continue;
    const label =
      typeof item['scriptName'] === 'string' && item['scriptName'].trim()
        ? item['scriptName'].trim().slice(0, 32)
        : 'ST导入规则';
    const replaceString =
      typeof item['replaceString'] === 'string' ? item['replaceString'].slice(0, 120) : '';
    const disabled = item['disabled'] === true;

    // SillyTavern placement: 1 = USER_INPUT, 2 = AI_OUTPUT
    let scope: AiRegexRuleScope = 'output';
    if (Array.isArray(item['placement'])) {
      const hasIn = item['placement'].includes(1);
      const hasOut = item['placement'].includes(2);
      if (hasIn && hasOut) scope = 'both';
      else if (hasIn) scope = 'input';
      else scope = 'output';
    }

    const parsedRe = parseSlashRegexString(findRegex);
    const validated = validateAiRegexRuleInput({
      label,
      pattern: parsedRe.pattern,
      flags: parsedRe.flags,
      replacement: replaceString,
      scope,
    });
    if (!validated.ok) continue;

    const id = generateAiRegexRuleId(seenIds);
    seenIds.add(id);
    rules.push({
      id,
      ...validated.ruleInput,
      enabled: !disabled,
    });
  }

  return rules;
}

function isSillyTavernPreset(obj: Record<string, unknown>): boolean {
  if (obj['schemaVersion'] === 1) return false;
  if (!Array.isArray(obj['prompts'])) return false;
  return obj['prompts'].some(
    (p) =>
      isRecord(p) &&
      ('identifier' in p || 'system_prompt' in p || 'injection_position' in p || 'marker' in p),
  );
}

export function importPresetFromUnknownJson(
  raw: unknown,
  opts: ImportPackOptions = {},
): ImportPresetResult {
  if (!isRecord(raw)) {
    return { ok: false, error: 'JSON 根节点必须是对象。' };
  }

  if (!isSillyTavernPreset(raw)) {
    const candidate = {
      ...raw,
      ...(typeof raw['id'] === 'string' && raw['id'].trim()
        ? {}
        : opts.fallbackId
          ? { id: slugifyPackId(opts.fallbackId, 'preset') }
          : {}),
      ...(typeof raw['name'] === 'string' && raw['name'].trim()
        ? {}
        : opts.fallbackName
          ? { name: opts.fallbackName }
          : {}),
    };
    const norm = normalizePresetPack(candidate);
    if (!norm.ok) return norm;
    return { ok: true, pack: norm.pack, sourceFormat: 'native_preset' };
  }

  // Convert SillyTavern Chat Completion Preset
  const rawPrompts = raw['prompts'] as unknown[];
  const byIdentifier = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < rawPrompts.length; i++) {
    const p = rawPrompts[i];
    if (!isRecord(p)) continue;
    const ident =
      typeof p['identifier'] === 'string' && p['identifier'].trim()
        ? p['identifier'].trim()
        : `st_block_${i + 1}`;
    byIdentifier.set(ident, p);
  }

  // Resolve prompt_order (prefer character_id 100001 which ST uses as global order, else last entry)
  const orderedEntries: Array<{ id: string; enabled: boolean }> = [];
  const seenOrderIds = new Set<string>();
  if (Array.isArray(raw['prompt_order']) && raw['prompt_order'].length > 0) {
    const globalOrderObj =
      raw['prompt_order'].find((o) => isRecord(o) && o['character_id'] === 100001) ??
      raw['prompt_order'][raw['prompt_order'].length - 1];
    if (isRecord(globalOrderObj) && Array.isArray(globalOrderObj['order'])) {
      for (const entry of globalOrderObj['order']) {
        if (!isRecord(entry) || typeof entry['identifier'] !== 'string') continue;
        const ident = entry['identifier'].trim();
        if (!ident || seenOrderIds.has(ident) || !byIdentifier.has(ident)) continue;
        seenOrderIds.add(ident);
        orderedEntries.push({
          id: ident,
          enabled: typeof entry['enabled'] === 'boolean' ? entry['enabled'] : true,
        });
      }
    }
  }
  for (const [ident, p] of byIdentifier.entries()) {
    if (seenOrderIds.has(ident)) continue;
    orderedEntries.push({
      id: ident,
      enabled: typeof p['enabled'] === 'boolean' ? p['enabled'] : true,
    });
  }

  const blocks: PresetPromptBlock[] = [];
  const emittedSlots = new Set<PresetPromptSlot>();

  for (const { id: ident, enabled } of orderedEntries) {
    const src = byIdentifier.get(ident);
    if (!src) continue;
    const mappedSlot = ST_MARKER_TO_SLOT[ident];
    const name =
      typeof src['name'] === 'string' && src['name'].trim() ? src['name'].trim() : ident;

    if (mappedSlot) {
      if (emittedSlots.has(mappedSlot)) continue;
      emittedSlots.add(mappedSlot);
      blocks.push({
        id: `slot_${mappedSlot}`,
        name,
        enabled,
        slot: mappedSlot,
      });
      continue;
    }

    if (src['marker'] === true) {
      // Skip unsupported ST-internal markers (e.g. personaDescription, scenario) when empty
      continue;
    }

    const content = typeof src['content'] === 'string' ? src['content'] : '';
    if (!content.trim() && enabled) continue;

    const rawRole = src['role'];
    const role: 'system' | 'user' | 'assistant' =
      rawRole === 'user' || rawRole === 'assistant' ? rawRole : 'system';
    const isDepth = src['injection_position'] === 1;
    const depth =
      typeof src['injection_depth'] === 'number' && Number.isFinite(src['injection_depth'])
        ? Math.max(0, Math.min(100, Math.floor(src['injection_depth'])))
        : 0;

    blocks.push({
      id: ident.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48) || 'st_prompt',
      name,
      enabled,
      role,
      position: isDepth ? 'depth' : 'top',
      ...(isDepth ? { depth } : {}),
      content,
    });
  }

  // Ensure essential group-chat slots exist before chat_history so imported ST presets work out-of-the-box
  const requiredBeforeChat: Array<{ slot: PresetPromptSlot; name: string }> = [
    { slot: 'char_identity', name: '角色身份设定' },
    { slot: 'char_soul', name: '说话风格准则' },
    { slot: 'group_rules', name: '群聊主语与防戏耍规则' },
    { slot: 'worldbook', name: '世界书（常驻与关键词词条）' },
    { slot: 'user_profiles', name: '出场人物关系档案' },
    { slot: 'memories', name: '三级长期记忆与记忆规则' },
  ];

  let chatHistIdx = blocks.findIndex((b) => b.slot === 'chat_history');
  if (chatHistIdx < 0) {
    // Insert chat_history before trailing depth blocks
    const firstDepthIdx = blocks.findIndex((b) => b.position === 'depth');
    chatHistIdx = firstDepthIdx >= 0 ? firstDepthIdx : blocks.length;
    blocks.splice(chatHistIdx, 0, {
      id: 'slot_chat_history',
      name: '对话历史与当前轮次',
      enabled: true,
      slot: 'chat_history',
    });
    emittedSlots.add('chat_history');
  }

  for (const req of requiredBeforeChat) {
    if (!emittedSlots.has(req.slot)) {
      blocks.splice(chatHistIdx, 0, {
        id: `slot_${req.slot}`,
        name: req.name,
        enabled: true,
        slot: req.slot,
      });
      chatHistIdx++;
      emittedSlots.add(req.slot);
    }
  }

  const baseDefault = createBuiltinDefaultPreset();
  const rawId =
    (typeof raw['id'] === 'string' && raw['id'].trim()) ||
    opts.fallbackId ||
    'st-imported-preset';
  const id = isValidPackId(rawId) ? rawId : slugifyPackId(rawId, 'st-preset');
  const name =
    (typeof raw['name'] === 'string' && raw['name'].trim()) ||
    opts.fallbackName ||
    `酒馆导入预设 (${id})`;

  const prefillStr =
    typeof raw['assistant_prefill'] === 'string' ? raw['assistant_prefill'] : '';
  const maxTokensRaw =
    typeof raw['openai_max_tokens'] === 'number'
      ? raw['openai_max_tokens']
      : typeof raw['max_tokens'] === 'number'
        ? raw['max_tokens']
        : undefined;

  const candidate: PresetPack = {
    ...baseDefault,
    id,
    name,
    version: '1.0.0',
    description: '由 SillyTavern Chat Completion 预设自动转换导入',
    sampling: {
      ...(typeof raw['temperature'] === 'number' ? { temperature: raw['temperature'] } : {}),
      ...(typeof maxTokensRaw === 'number' ? { maxTokens: Math.floor(maxTokensRaw) } : {}),
      ...(typeof raw['top_p'] === 'number' ? { topP: raw['top_p'] } : {}),
      ...(typeof raw['frequency_penalty'] === 'number'
        ? { frequencyPenalty: raw['frequency_penalty'] }
        : {}),
      ...(typeof raw['presence_penalty'] === 'number'
        ? { presencePenalty: raw['presence_penalty'] }
        : {}),
    },
    assistantPrefill: {
      enabled: prefillStr.trim().length > 0,
      content: prefillStr,
      keepInReply: false,
    },
    prompts: blocks,
    regexRules: convertStRegexScripts(
      isRecord(raw['extensions']) ? raw['extensions']['regex_scripts'] : undefined,
    ),
  };

  const norm = normalizePresetPack(candidate);
  if (!norm.ok) return norm;
  return { ok: true, pack: norm.pack, sourceFormat: 'sillytavern_preset' };
}

function convertStCharacterBook(rawBook: unknown): LorebookEntry[] {
  if (!isRecord(rawBook)) return [];
  const rawEntries = rawBook['entries'];
  const list: unknown[] = Array.isArray(rawEntries)
    ? rawEntries
    : isRecord(rawEntries)
      ? Object.values(rawEntries)
      : [];

  const out: LorebookEntry[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!isRecord(item)) continue;
    const content = typeof item['content'] === 'string' ? item['content'].trim() : '';
    if (!content) continue;

    const keys = Array.isArray(item['keys'])
      ? item['keys']
          .filter((k): k is string => typeof k === 'string')
          .map((k) => k.trim())
          .filter(Boolean)
      : Array.isArray(item['key'])
        ? item['key']
            .filter((k): k is string => typeof k === 'string')
            .map((k) => k.trim())
            .filter(Boolean)
        : [];
    const secondaryKeys = Array.isArray(item['secondary_keys'])
      ? item['secondary_keys']
          .filter((k): k is string => typeof k === 'string')
          .map((k) => k.trim())
          .filter(Boolean)
      : Array.isArray(item['keysecondary'])
        ? item['keysecondary']
            .filter((k): k is string => typeof k === 'string')
            .map((k) => k.trim())
            .filter(Boolean)
        : [];

    const constant = item['constant'] === true || keys.length === 0;
    const enabled = item['enabled'] !== false && item['disable'] !== true;
    const comment =
      typeof item['comment'] === 'string' && item['comment'].trim()
        ? item['comment'].trim().slice(0, 80)
        : `词条_${i + 1}`;
    const rawPos = item['position'];
    const position: 'before_char' | 'after_char' | 'depth' =
      rawPos === 'before_char' || rawPos === 0
        ? 'before_char'
        : rawPos === 'at_depth' || rawPos === 4
          ? 'depth'
          : 'after_char';
    const depth =
      typeof item['depth'] === 'number' && Number.isFinite(item['depth'])
        ? Math.max(0, Math.min(100, Math.floor(item['depth'])))
        : undefined;

    out.push({
      id: `lore_${item['uid'] ?? item['id'] ?? i + 1}`,
      comment,
      keys,
      ...(secondaryKeys.length > 0 ? { secondaryKeys } : {}),
      constant,
      position,
      ...(depth !== undefined ? { depth } : {}),
      enabled,
      content,
    });
  }

  return out;
}

function isSillyTavernCard(obj: Record<string, unknown>): boolean {
  if (obj['schemaVersion'] === 1 && typeof obj['personaName'] === 'string') {
    return false;
  }
  if (
    obj['spec'] === 'chara_card_v2' ||
    obj['spec'] === 'chara_card_v3' ||
    isRecord(obj['data'])
  ) {
    return true;
  }
  return typeof obj['name'] === 'string' && typeof obj['description'] === 'string';
}

export function importCardFromUnknownJson(
  raw: unknown,
  opts: ImportPackOptions = {},
): ImportCardResult {
  if (!isRecord(raw)) {
    return { ok: false, error: 'JSON 根节点必须是对象。' };
  }

  if (!isSillyTavernCard(raw)) {
    const candidate = {
      ...raw,
      ...(typeof raw['id'] === 'string' && raw['id'].trim()
        ? {}
        : opts.fallbackId
          ? { id: slugifyPackId(opts.fallbackId, 'card') }
          : {}),
    };
    const norm = normalizeCharacterCardPack(candidate);
    if (!norm.ok) return norm;
    return { ok: true, pack: norm.pack, sourceFormat: 'native_card' };
  }

  const data = isRecord(raw['data']) ? raw['data'] : raw;
  const personaName =
    typeof data['name'] === 'string' ? data['name'].trim() : '';
  if (!personaName) {
    return { ok: false, error: '酒馆角色卡缺少有效的角色名（name）。' };
  }

  const rawId =
    opts.fallbackId ||
    (typeof raw['id'] === 'string' && raw['id'].trim() ? raw['id'].trim() : '') ||
    personaName;
  const id = isValidPackId(rawId) ? rawId : slugifyPackId(rawId, 'st-card');

  const description = typeof data['description'] === 'string' ? data['description'].trim() : '';
  const scenario = typeof data['scenario'] === 'string' ? data['scenario'].trim() : '';
  const personality = typeof data['personality'] === 'string' ? data['personality'].trim() : '';
  const charSysPrompt =
    typeof data['system_prompt'] === 'string' ? data['system_prompt'].trim() : '';
  const mesExample = typeof data['mes_example'] === 'string' ? data['mes_example'].trim() : '';
  const postHistory =
    typeof data['post_history_instructions'] === 'string'
      ? data['post_history_instructions'].trim()
      : '';
  const creator = typeof data['creator'] === 'string' ? data['creator'].trim() : '';
  const cardVer =
    typeof data['character_version'] === 'string' && data['character_version'].trim()
      ? data['character_version'].trim()
      : '1.0.0';

  const identityParts = [description, scenario ? `【情境】\n${scenario}` : ''].filter(Boolean);
  const soulParts = [personality, charSysPrompt].filter(Boolean);

  const identityPrompt = identityParts.join('\n\n') || `你是「${personaName}」。`;
  const soulPrompt = soulParts.join('\n\n') || '- 保持角色性格自然对话，不说AI套话。';

  const lorebookEntries = convertStCharacterBook(data['character_book']);
  const extensions = isRecord(data['extensions']) ? data['extensions'] : {};
  const regexRules = convertStRegexScripts(extensions['regex_scripts']);

  const candidate: CharacterCardPack = {
    schemaVersion: 1,
    kind: 'card',
    id,
    name: opts.fallbackName || personaName,
    version: cardVer,
    ...(creator ? { author: creator } : {}),
    description: `由 SillyTavern 角色卡导入（${personaName}）`,
    personaName,
    identityPrompt,
    soulPrompt,
    exampleDialogue: mesExample,
    ...(postHistory ? { postHistoryInstructions: postHistory } : {}),
    worldbook: '',
    lorebookEntries,
    regexRules,
  };

  const norm = normalizeCharacterCardPack(candidate);
  if (!norm.ok) return norm;
  return { ok: true, pack: norm.pack, sourceFormat: 'sillytavern_card' };
}
