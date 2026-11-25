export type AiRegexRuleScope = 'input' | 'output' | 'both';

export interface AiRegexRule {
  id: string;
  label: string;
  pattern: string;
  flags: string;
  replacement: string;
  scope: AiRegexRuleScope;
  enabled: boolean;
}

export interface AiRegexRuleInput {
  label: string;
  pattern: string;
  flags?: string;
  replacement: string;
  scope: AiRegexRuleScope;
}

export const MAX_AI_REGEX_RULES = 30;
export const MAX_AI_REGEX_LABEL_LEN = 32;
export const MAX_AI_REGEX_PATTERN_LEN = 200;
export const MAX_AI_REGEX_REPLACEMENT_LEN = 120;

export const GLOBAL_ANTI_CLICHE_PROMPT = [
  '## 去 AI 味与反八股',
  '- 说人话，禁用“极其/近乎/一丝/一抹/嘴角勾起弧度/空气突然凝固/四肢百骸/生理性/总而言之/收到啦/随时待命”等八股文和客服套话。',
  '- 禁用“还留着过年/属于是/白瞎/绝绝子”等油腻烂梗，也别把“给我撑腰/我是来护短的”之类人设词挂嘴边念出来。',
].join('\n');

const DISCORD_CUSTOM_EMOJI_RE = /<a?:([a-zA-Z0-9_]{1,64}):\d{15,22}>/g;

export function normalizeDiscordCustomEmojis(text: string): string {
  if (!text || !text.includes('<')) return text;
  return text.replace(DISCORD_CUSTOM_EMOJI_RE, (_match, name: string) => `:${name}:`);
}

export const DEFAULT_AI_REGEX_RULES: ReadonlyArray<AiRegexRule> = [
  {
    id: 'alias_heidiowang',
    label: '布丁酱代称→黑吊王',
    pattern: '草莓布丁酱|布丁酱',
    flags: 'gi',
    replacement: '黑吊王',
    scope: 'both',
    enabled: true,
  },
  {
    id: 'cliche_jiqi',
    label: '去八股：极其→特别',
    pattern: '极其',
    flags: 'g',
    replacement: '特别',
    scope: 'output',
    enabled: true,
  },
  {
    id: 'cliche_jinhu',
    label: '去八股：近乎→几乎',
    pattern: '近乎',
    flags: 'g',
    replacement: '几乎',
    scope: 'output',
    enabled: true,
  },
  {
    id: 'cliche_mouth_arc',
    label: '去八股：嘴角勾起弧度',
    pattern:
      '嘴角(?:微微|轻轻|缓缓)?勾起(?:一[抹丝道个])?(?:不易察觉的|淡淡的|玩味的|意味深长的)?弧度',
    flags: 'g',
    replacement: '轻笑了一下',
    scope: 'output',
    enabled: true,
  },
  {
    id: 'cliche_yisi',
    label: '去八股：一丝/一抹→一点',
    pattern:
      '(?:一丝|一抹)(?=不易察觉|难以言喻|笑意|弧度|冷笑|苦笑|涟漪|情绪|凉意|暖意|尴尬)',
    flags: 'g',
    replacement: '一点',
    scope: 'output',
    enabled: true,
  },
  {
    id: 'cliche_air_freeze',
    label: '去八股：空气突然凝固',
    pattern: '空气(?:仿佛|似乎|瞬间|突然)?凝固(?:了(?:一般|似的)?)?',
    flags: 'g',
    replacement: '气氛一时静了下来',
    scope: 'output',
    enabled: true,
  },
  {
    id: 'cliche_body_slop',
    label: '去八股：四肢百骸/生理性',
    pattern: '四肢百骸|生理性地?',
    flags: 'g',
    replacement: '',
    scope: 'output',
    enabled: true,
  },
];

export function cloneDefaultAiRegexRules(): AiRegexRule[] {
  return DEFAULT_AI_REGEX_RULES.map((rule) => ({ ...rule }));
}

const ALLOWED_REGEX_FLAGS = new Set(['g', 'i', 'm', 'u']);
const NESTED_QUANTIFIER_RE = /\([^)]*[+*][^)]*\)[+*{]/;
const CONSECUTIVE_QUANTIFIER_RE = /(?:[+*]|\{\d+,\d*\})\s*(?:[+*]|\{\d+,\d*\})/;

export function normalizeRegexFlags(raw?: string): string {
  const input = (raw ?? '').trim().toLowerCase();
  if (!input) return 'gi';
  const picked: string[] = [];
  for (const ch of input) {
    if (ALLOWED_REGEX_FLAGS.has(ch) && !picked.includes(ch)) {
      picked.push(ch);
    }
  }
  if (!picked.includes('g')) {
    picked.unshift('g');
  }
  return picked.join('');
}

export function isValidAiRegexScope(raw: unknown): raw is AiRegexRuleScope {
  return raw === 'input' || raw === 'output' || raw === 'both';
}

export type ValidateAiRegexResult =
  | {
      ok: true;
      ruleInput: {
        label: string;
        pattern: string;
        flags: string;
        replacement: string;
        scope: AiRegexRuleScope;
      };
    }
  | {
      ok: false;
      error: string;
    };

export function validateAiRegexRuleInput(input: AiRegexRuleInput): ValidateAiRegexResult {
  const label = input.label.trim();
  const pattern = input.pattern.trim();
  const replacement = input.replacement;
  const scope = input.scope;

  if (!label || label.length > MAX_AI_REGEX_LABEL_LEN) {
    return {
      ok: false,
      error: `规则名称长度需在 1 ~ ${MAX_AI_REGEX_LABEL_LEN} 字之间。`,
    };
  }
  if (!pattern || pattern.length > MAX_AI_REGEX_PATTERN_LEN) {
    return {
      ok: false,
      error: `正则表达式长度需在 1 ~ ${MAX_AI_REGEX_PATTERN_LEN} 字符之间。`,
    };
  }
  if (replacement.length > MAX_AI_REGEX_REPLACEMENT_LEN) {
    return {
      ok: false,
      error: `替换文本长度不能超过 ${MAX_AI_REGEX_REPLACEMENT_LEN} 字符。`,
    };
  }
  if (!isValidAiRegexScope(scope)) {
    return { ok: false, error: '生效范围必须为 input、output 或 both。' };
  }

  const rawFlags = (input.flags ?? '').trim().toLowerCase();
  for (const ch of rawFlags) {
    if (!ALLOWED_REGEX_FLAGS.has(ch)) {
      return {
        ok: false,
        error: `不支持的正则标志 \`${ch}\`，仅允许 g / i / m / u。`,
      };
    }
  }
  const flags = normalizeRegexFlags(rawFlags);

  if (NESTED_QUANTIFIER_RE.test(pattern) || CONSECUTIVE_QUANTIFIER_RE.test(pattern)) {
    return {
      ok: false,
      error: '正则表达式包含嵌套或连续量词，存在回溯卡死风险，请简化表达式。',
    };
  }

  let compiled: RegExp;
  try {
    compiled = new RegExp(pattern, flags);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `正则表达式语法无效：${msg}` };
  }

  const emptyMatch = compiled.exec('');
  if (emptyMatch && emptyMatch[0] === '') {
    return {
      ok: false,
      error: '正则表达式不能匹配空字符串，请避免顶层可空表达式。',
    };
  }

  return {
    ok: true,
    ruleInput: {
      label,
      pattern,
      flags,
      replacement,
      scope,
    },
  };
}

export function sanitizeStoredRegexRules(raw: unknown): AiRegexRule[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return [];
  }

  const sanitized: AiRegexRule[] = [];
  const seenIds = new Set<string>();

  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const rawId = typeof obj['id'] === 'string' ? obj['id'].trim() : '';
    const rawLabel = typeof obj['label'] === 'string' ? obj['label'] : '';
    const rawPattern = typeof obj['pattern'] === 'string' ? obj['pattern'] : '';
    const rawFlags = typeof obj['flags'] === 'string' ? obj['flags'] : undefined;
    const rawReplacement = typeof obj['replacement'] === 'string' ? obj['replacement'] : '';
    const rawScope = obj['scope'];
    const enabled = typeof obj['enabled'] === 'boolean' ? obj['enabled'] : true;

    if (!rawId || seenIds.has(rawId) || !isValidAiRegexScope(rawScope)) continue;

    const validated = validateAiRegexRuleInput({
      label: rawLabel,
      pattern: rawPattern,
      flags: rawFlags,
      replacement: rawReplacement,
      scope: rawScope,
    });
    if (!validated.ok) continue;

    seenIds.add(rawId);
    sanitized.push({
      id: rawId,
      ...validated.ruleInput,
      enabled,
    });

    if (sanitized.length >= MAX_AI_REGEX_RULES) break;
  }

  return sanitized;
}

export function generateAiRegexRuleId(existingIds: ReadonlySet<string>): string {
  for (let i = 1; i <= 9999; i++) {
    const candidate = `r${i}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }
  return `r${Date.now()}`;
}

function applyRulesToPlainSegment(
  text: string,
  rules: ReadonlyArray<AiRegexRule>,
  stage: 'input' | 'output',
): string {
  let out = text;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.scope !== stage && rule.scope !== 'both') continue;
    try {
      const flags = normalizeRegexFlags(rule.flags);
      const re = new RegExp(rule.pattern, flags);
      out = out.replace(re, rule.replacement);
    } catch {
      // Skip malformed rule at runtime so chat flow never crashes
    }
  }
  return out;
}

const CODE_BLOCK_SPLIT_RE = /(```[\s\S]*?```)/g;

export function applyAiRegexRules(
  text: string,
  rules: ReadonlyArray<AiRegexRule>,
  stage: 'input' | 'output',
  opts?: { preserveCodeBlocks?: boolean },
): string {
  if (!text || rules.length === 0) return text;
  const activeRules = rules.filter(
    (rule) => rule.enabled && (rule.scope === stage || rule.scope === 'both'),
  );
  if (activeRules.length === 0) return text;

  if (!opts?.preserveCodeBlocks || !text.includes('```')) {
    return applyRulesToPlainSegment(text, activeRules, stage);
  }

  const parts = text.split(CODE_BLOCK_SPLIT_RE);
  return parts
    .map((part) => {
      if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
        return part;
      }
      return applyRulesToPlainSegment(part, activeRules, stage);
    })
    .join('');
}

export function resolveDiscordUserMentions(
  text: string,
  botId: string,
  resolveName: (userId: string) => string | null | undefined,
): string {
  if (!text || !text.includes('<@')) return text;
  return text.replace(/<@!?(\d+)>/g, (match, userId: string) => {
    if (userId === botId) return match;
    const resolved = resolveName(userId)?.trim();
    return resolved ? `@${resolved}` : match;
  });
}
