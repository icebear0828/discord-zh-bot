import fs from 'node:fs';
import { applyAiRegexRules, normalizeRegexFlags, type AiRegexRule } from '../aiRegex.js';

export type InputSanitizerCategory =
  | 'underage_or_taboo'
  | 'explicit_photo_nudity'
  | 'explicit_act_organ'
  | 'custom';

export interface InputSanitizerRule {
  id: string;
  category: InputSanitizerCategory;
  pattern: string;
  flags?: string;
  replacement: string;
  enabled: boolean;
}

export interface InputSanitizerPackFile {
  version: string;
  protectedTerms?: string[];
  rules?: InputSanitizerRule[];
}

interface CompiledSanitizerRule {
  id: string;
  regex: RegExp;
  replacement: string;
}

// Community-specific proper nouns and everyday Chinese compounds protected from false-positive replacement
export const BUILTIN_PROTECTED_TERMS: readonly string[] = [
  '黑吊国',
  '黑吊币',
  '黑吊王',
  '黑\u5c4c王',
  '超合金黑吊',
  '超合金黑\u5c4c',
  '冰吊王',
  '冰冰冰',
  '白虎姬',
  '卖屁股',
  '\u725b\u903c', // niubi
  '\u61f5\u903c', // mengbi
  '\u88c5\u903c', // zhuangbi
  '\u82e6\u903c', // kubi
  '\u50bb\u903c', // shabi
  '\u9017\u903c', // doubi
  '\u4e8c\u903c', // erbi
  '\u6495\u903c', // sibi
  '儿童节',
  '幼儿园老师',
  '高潮迭起',
  '掀起高潮',
  '干嘛',
  '干什么',
  '干活',
  '干净',
  '干杯',
  '干扰',
  '干预',
  '干燥',
  '干脆',
  '干部',
  '干粮',
  '干货',
  '草稿',
  '草地',
  '草原',
  '草莓',
  '草案',
  '草率',
  '花草',
  '牧草',
  '日常',
  '日历',
  '日记',
  '日期',
  '日本',
  '生日',
  '节日',
  '明日',
  '今日',
  '昨日',
  '早日',
];

// Three-tier input-only euphemism rules (Unicode-escaped to keep public repository clean)
export const BUILTIN_INPUT_SANITIZER_RULES: readonly InputSanitizerRule[] = [
  // Tier 1: Zero-tolerance underage / minor / non-consensual hard triggers
  {
    id: 't1_underage_girl',
    category: 'underage_or_taboo',
    pattern: '\u5e7c\u5973|\u5973\u7ae5|\u5e7c\u9f7f|\u7ae5\u5993',
    flags: 'gi',
    replacement: '少女',
    enabled: true,
  },
  {
    id: 't1_underage_loli',
    category: 'underage_or_taboo',
    pattern: '\u841d\u8389|(?<![a-zA-Z])(?:lolicon|loli)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '小个子女生',
    enabled: true,
  },
  {
    id: 't1_underage_boy',
    category: 'underage_or_taboo',
    pattern: '\u7537\u7ae5|\u6b63\u592a|(?<![a-zA-Z])(?:shotacon|shota)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '少年',
    enabled: true,
  },
  {
    id: 't1_underage_school',
    category: 'underage_or_taboo',
    pattern: '\u5c0f\u5b66\u751f|\u521d\u4e2d\u751f|\u56fd\u4e2d\u751f|\u5e7c\u7a1a\u56ed|\u5e7c\u513f\u56ed\u751f',
    flags: 'gi',
    replacement: '小菜鸟',
    enabled: true,
  },
  {
    id: 't1_underage_minor',
    category: 'underage_or_taboo',
    pattern:
      '\u672a\u6210\u5e74\u4eba?|\u672a\u6ee1\u5341\u516b\u5c81?|\u672a\u6ee118\u5c81?|(?<![a-zA-Z])underage(?![a-zA-Z])',
    flags: 'gi',
    replacement: '年轻人',
    enabled: true,
  },
  {
    id: 't1_nonconsensual',
    category: 'underage_or_taboo',
    pattern:
      '\u5f3a\u5978|\u8f6e\u5978|\u8ff7\u5978|\u5f3a\u66b4|\u6027\u4fb5|\u5978\u6740|(?<![a-zA-Z])rape[ds]?(?![a-zA-Z])',
    flags: 'gi',
    replacement: '强行欺负',
    enabled: true,
  },

  // Tier 2: Explicit R18 photo & nudity terms (LLM sees euphemism; NAI selfie still reads rawUserText)
  {
    id: 't2_nude_photo',
    category: 'explicit_photo_nudity',
    pattern:
      '\u88f8\u7167|\u679c\u7167|\u9ec4\u56fe|\u8272\u56fe|\u6da9\u56fe|\u65e0\u7801\u5927\u56fe|\u65e0\u7801\u56fe|\u798f\u5229\u59ec\u56fe|(?<![a-zA-Z])nudes?(?![a-zA-Z])',
    flags: 'gi',
    replacement: '私房写真',
    enabled: true,
  },
  {
    id: 't2_full_nudity',
    category: 'explicit_photo_nudity',
    pattern:
      '\u5168\u88f8|\u4e00\u4e1d\u4e0d\u6302|\u8131\u5149\u5149?|\u5149\u7740\u8eab\u5b50|\u8d64\u88f8|\u679c\u4f53|\u88f8\u4f53|(?<![a-zA-Z])(?:naked|topless)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '清凉贴身穿搭',
    enabled: true,
  },
  {
    id: 't2_expose_body',
    category: 'explicit_photo_nudity',
    pattern: '\u9732\u70b9|\u9732\u5976|\u9732\u80f8|\u9732\u4e73|\u9732\u903c|\u9732\u7a74|\u8d70\u5149',
    flags: 'gi',
    replacement: '大胆展露身材',
    enabled: true,
  },
  {
    id: 't2_nsfw_r18_tag',
    category: 'explicit_photo_nudity',
    pattern: '(?<![a-zA-Z])(?:nsfw|r18)(?![a-zA-Z0-9])',
    flags: 'gi',
    replacement: '私密向',
    enabled: true,
  },

  // Tier 3: Explicit sexual acts, organs, and vulgar compounds
  {
    id: 't3_act_intercourse',
    category: 'explicit_act_organ',
    pattern:
      '\u505a\u7231|\u6027\u4ea4|\u556a\u556a\u556a|\u6253\u70ae|\u7ea6\u70ae|\u4ea4\u914d|\u5978\u6deb|\u53cc\u98de|\u7fa4\u4ea4|\u8f6e\u6d41\u4e0a|(?<![a-zA-Z])(?:sex|fuck(?:ing)?|horny)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '亲密互动',
    enabled: true,
  },
  {
    id: 't3_act_oral_other',
    category: 'explicit_act_organ',
    pattern:
      '\u53e3\u4ea4|\u6df1\u5589|\u5439\u7bab|\u4e73\u4ea4|\u8db3\u4ea4|\u809b\u4ea4|\u8d70\u540e\u95e8|(?<![a-zA-Z])(?:blowjob|handjob|footjob|titjob|paizuri|fellatio|cunnilingus)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '口头伺候',
    enabled: true,
  },
  {
    id: 't3_act_behind',
    category: 'explicit_act_organ',
    pattern: '\u4ece?\u540e\u5165|(?<![a-zA-Z])doggy\\s*style(?![a-zA-Z])',
    flags: 'gi',
    replacement: '从背后贴近',
    enabled: true,
  },
  {
    id: 't3_act_release',
    category: 'explicit_act_organ',
    pattern:
      '\u5185\u5c04|\u4e2d\u51fa|\u989c\u5c04|\u5c04\u6ee1|\u541e\u7cbe|(?<![a-zA-Z])(?:creampie|cumshot|bukkake)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '亲密释放',
    enabled: true,
  },
  {
    id: 't3_act_climax',
    category: 'explicit_act_organ',
    pattern:
      '\u6f6e\u5439|\u9ad8\u6f6e|\u55b7\u6c34|\u6deb\u53eb|\u6d6a\u53eb|(?<![a-zA-Z])(?:orgasm|ahegao|squirting)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '情动颤栗',
    enabled: true,
  },
  {
    id: 't3_act_solo',
    category: 'explicit_act_organ',
    pattern:
      '\u81ea\u6170|\u624b\u6deb|\u6253\u98de\u673a|\u6307\u5978|\u62a0\u903c|\u6263\u903c|(?<![a-zA-Z])(?:masturbat[a-z]*|fap(?:ping)?)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '自我纾解',
    enabled: true,
  },
  {
    id: 't3_verb_vulgar',
    category: 'explicit_act_organ',
    pattern:
      '\u808f(?:\u4f60|\u6211|\u5979|\u4ed6|\u6b7b|\u54ed|\u7ffb|\u70c2|\u723d)?|(?:\u64cd|\u8349|\u65e5|\u5e72)(?:\u6b7b\u4f60|\u54ed\u4f60|\u7ffb\u4f60|\u70c2\u4f60|\u723d\u4f60|\u4f60\u5988)|(?:\u64cd|\u808f)(?:\u4f60|\u5979|\u4ed6)',
    flags: 'gi',
    replacement: '狠狠欺负',
    enabled: true,
  },
  {
    id: 't3_organ_male',
    category: 'explicit_act_organ',
    pattern:
      '\u9e21\u5df4|\u8089\u68d2|\u9634\u830e|\u9f9f\u5934|\u5927\u5c4c|\u5de8\u6839|\u9633\u5177|\u777e\u4e38|(?<![a-zA-Z])(?:penis|cock|dick)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '要害',
    enabled: true,
  },
  {
    id: 't3_organ_female',
    category: 'explicit_act_organ',
    pattern:
      '\u5c0f\u7a74|\u5ae9\u7a74|\u871c\u7a74|\u9a9a\u7a74|\u6deb\u7a74|\u8089\u7a74|\u82b1\u7a74|\u9634\u9053|\u9634\u8482|\u9a9a\u903c|\u5ae9\u903c|\u70c2\u903c|\u6bcd\u72d7|(?<![a-zA-Z])(?:pussy|vagina|clit(?:oris)?|cunt)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '私密处',
    enabled: true,
  },
  {
    id: 't3_organ_chest',
    category: 'explicit_act_organ',
    pattern:
      '\u4e73\u5934|\u5976\u5934|\u5976\u5b50|\u5de8\u4e73|\u7f8e\u4e73|\u4e73\u623f|\u7206\u4e73|(?<![a-zA-Z])(?:nipples?|boobs?|tits|breasts?)(?![a-zA-Z])',
    flags: 'gi',
    replacement: '胸口',
    enabled: true,
  },
  {
    id: 't3_fluids',
    category: 'explicit_act_organ',
    pattern: '\u7cbe\u6db2|\u7231\u6db2|\u6deb\u6c34|\u9a9a\u6c34',
    flags: 'gi',
    replacement: '温热气息',
    enabled: true,
  },
];

function escapeRegExpLiteral(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileRules(rules: readonly InputSanitizerRule[]): CompiledSanitizerRule[] {
  const compiled: CompiledSanitizerRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern.trim()) continue;
    try {
      const regex = new RegExp(rule.pattern, normalizeRegexFlags(rule.flags));
      if (regex.exec('')?.[0] === '') continue;
      compiled.push({ id: rule.id, regex, replacement: rule.replacement });
    } catch {
      // Ignore malformed custom rule so chat flow never fails
    }
  }
  return compiled;
}

function buildProtectionRegex(protectedTerms: readonly string[]): RegExp {
  const uniqueSorted = [...new Set(protectedTerms.map((t) => t.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const literalBranches = uniqueSorted.map(escapeRegExpLiteral);
  const structuralBranches = [
    '```[\\s\\S]*?```',
    'https?:\\/\\/\\S+',
    '<(?:@!?|@&|#)\\d{15,22}>',
    ':[a-zA-Z0-9_]{1,64}:',
  ];
  return new RegExp([...structuralBranches, ...literalBranches].join('|'), 'g');
}

interface CompiledSanitizerBundle {
  protectRegex: RegExp;
  rules: CompiledSanitizerRule[];
}

const DEFAULT_COMPILED_BUNDLE: CompiledSanitizerBundle = {
  protectRegex: buildProtectionRegex(BUILTIN_PROTECTED_TERMS),
  rules: compileRules(BUILTIN_INPUT_SANITIZER_RULES),
};

function isValidCategory(val: unknown): val is InputSanitizerCategory {
  return (
    val === 'underage_or_taboo' ||
    val === 'explicit_photo_nudity' ||
    val === 'explicit_act_organ' ||
    val === 'custom'
  );
}

/**
 * Hot-reloadable external pack store for `data/ai-packs/input-sanitizer.json`.
 */
export class AiInputSanitizerStore {
  private lastMtimeMs = -1;
  private cachedBundle: CompiledSanitizerBundle = DEFAULT_COMPILED_BUNDLE;

  constructor(private readonly filePath: string) {}

  getFilePath(): string {
    return this.filePath;
  }

  getCompiledBundle(): CompiledSanitizerBundle {
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.mtimeMs === this.lastMtimeMs) {
        return this.cachedBundle;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        this.lastMtimeMs = stat.mtimeMs;
        this.cachedBundle = DEFAULT_COMPILED_BUNDLE;
        return this.cachedBundle;
      }
      const obj = parsed as Record<string, unknown>;
      const customProtected = Array.isArray(obj['protectedTerms'])
        ? obj['protectedTerms'].filter((t): t is string => typeof t === 'string' && Boolean(t.trim()))
        : [];
      const mergedRulesMap = new Map<string, InputSanitizerRule>(
        BUILTIN_INPUT_SANITIZER_RULES.map((r) => [r.id, r]),
      );
      if (Array.isArray(obj['rules'])) {
        for (const item of obj['rules']) {
          if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
          const r = item as Record<string, unknown>;
          const id = typeof r['id'] === 'string' ? r['id'].trim() : '';
          const pattern = typeof r['pattern'] === 'string' ? r['pattern'].trim() : '';
          const replacement = typeof r['replacement'] === 'string' ? r['replacement'] : '';
          const enabled = typeof r['enabled'] === 'boolean' ? r['enabled'] : true;
          const flags = typeof r['flags'] === 'string' ? r['flags'] : 'gi';
          const category = isValidCategory(r['category']) ? r['category'] : 'custom';
          if (!id) continue;
          const existing = mergedRulesMap.get(id);
          if (!enabled && existing) {
            mergedRulesMap.set(id, { ...existing, enabled: false });
            continue;
          }
          if (!pattern) continue;
          mergedRulesMap.set(id, { id, category, pattern, flags, replacement, enabled });
        }
      }

      this.cachedBundle = {
        protectRegex: buildProtectionRegex([...BUILTIN_PROTECTED_TERMS, ...customProtected]),
        rules: compileRules([...mergedRulesMap.values()]),
      };
      this.lastMtimeMs = stat.mtimeMs;
      return this.cachedBundle;
    } catch {
      this.lastMtimeMs = -1;
      this.cachedBundle = DEFAULT_COMPILED_BUNDLE;
      return this.cachedBundle;
    }
  }
}

const PLACEHOLDER_RESTORE_RE = /\uE000(\d+)\uE001/g;

/**
 * Deterministic input-only softener for text sent to the chat LLM.
 * Never call this on LLM outputs or on rawUserText consumed by the NAI V5 selfie compiler.
 */
export function sanitizeLlmInputText(
  text: string,
  options?: { store?: AiInputSanitizerStore },
): string {
  if (!text) return text;
  const bundle = options?.store ? options.store.getCompiledBundle() : DEFAULT_COMPILED_BUNDLE;
  if (bundle.rules.length === 0) return text;

  const cleanInput = text.replace(/[\uE000\uE001]/g, '');
  const maskedValues: string[] = [];
  const masked = cleanInput.replace(bundle.protectRegex, (match) => {
    const idx = maskedValues.length;
    maskedValues.push(match);
    return `\uE000${idx}\uE001`;
  });

  let transformed = masked;
  for (const rule of bundle.rules) {
    transformed = transformed.replace(rule.regex, rule.replacement);
  }

  if (maskedValues.length === 0) {
    return transformed;
  }
  return transformed.replace(PLACEHOLDER_RESTORE_RE, (_full, idxStr: string) => {
    const idx = Number(idxStr);
    return maskedValues[idx] ?? '';
  });
}

/**
 * Run input sanitizer (if enabled) followed by input-stage custom regex rules.
 */
export function normalizeChatInputSegment(params: {
  text: string;
  inputSanitizerEnabled?: boolean;
  sanitizerStore?: AiInputSanitizerStore;
  regexRules?: ReadonlyArray<AiRegexRule>;
}): string {
  const { text, inputSanitizerEnabled = true, sanitizerStore, regexRules } = params;
  if (!text) return text;
  const sanitized = inputSanitizerEnabled
    ? sanitizeLlmInputText(text, { store: sanitizerStore })
    : text;
  if (regexRules && regexRules.length > 0) {
    return applyAiRegexRules(sanitized, regexRules, 'input');
  }
  return sanitized;
}
