import { describe, expect, it } from 'vitest';
import {
  applyAiRegexRules,
  cloneDefaultAiRegexRules,
  generateAiRegexRuleId,
  normalizeRegexFlags,
  resolveDiscordUserMentions,
  sanitizeStoredRegexRules,
  validateAiRegexRuleInput,
} from '../../src/services/aiRegex.js';

describe('aiRegex module', () => {
  it('supports custom bidirectional alias regex alongside default anti-cliche output rules', () => {
    const customAliasRule = {
      id: 'alias_captain',
      label: '船长代称归一化',
      pattern: '草莓船长|老船长',
      flags: 'gi',
      replacement: '舰长',
      scope: 'both' as const,
      enabled: true,
    };
    const rules = [customAliasRule, ...cloneDefaultAiRegexRules()];

    const inputText = '@草莓船长 刚才和 老船长 在港口买了一箱草莓和草莓蛋糕';
    expect(applyAiRegexRules(inputText, rules, 'input')).toBe(
      '@舰长 刚才和 舰长 在港口买了一箱草莓和草莓蛋糕',
    );

    const outputText = '草莓船长说的没错，不过草莓味冰淇淋确实好吃，老船长也喜欢';
    expect(applyAiRegexRules(outputText, rules, 'output')).toBe(
      '舰长说的没错，不过草莓味冰淇淋确实好吃，舰长也喜欢',
    );
  });

  it('cleans common AI cliche words in output stage while preserving fenced code blocks', () => {
    const rules = cloneDefaultAiRegexRules();
    const raw = [
      '这波操作极其离谱，空气突然凝固了，他嘴角微微勾起一抹弧度，眼神带着一丝笑意，近乎无解，四肢百骸都发凉。',
      '```ts',
      'const label = "极其危险"; // 嘴角勾起弧度 草莓布丁酱',
      '```',
      '生理性地抖了一下，另外草莓很甜。',
    ].join('\n');

    const cleaned = applyAiRegexRules(raw, rules, 'output', { preserveCodeBlocks: true });
    expect(cleaned).toContain('特别离谱');
    expect(cleaned).toContain('气氛一时静了下来');
    expect(cleaned).toContain('轻笑了一下');
    expect(cleaned).toContain('一点笑意');
    expect(cleaned).toContain('几乎无解');
    expect(cleaned).not.toContain('四肢百骸');
    expect(cleaned).not.toContain('生理性');
    expect(cleaned).toContain('另外草莓很甜');
    // Code block untouched
    expect(cleaned).toContain('const label = "极其危险"; // 嘴角勾起弧度 草莓布丁酱');
  });

  it('only runs input rules on input stage and output rules on output stage', () => {
    const customAliasRule = {
      id: 'alias_captain',
      label: '船长代称',
      pattern: '草莓船长',
      flags: 'gi',
      replacement: '舰长',
      scope: 'both' as const,
      enabled: true,
    };
    const rules = [customAliasRule, ...cloneDefaultAiRegexRules()];
    expect(applyAiRegexRules('极其近乎草莓船长', rules, 'input')).toBe('极其近乎舰长');
    expect(applyAiRegexRules('极其近乎草莓船长', rules, 'output')).toBe('特别几乎舰长');
  });

  it('validates regex inputs and rejects malformed, empty-matching, or ReDoS-prone patterns', () => {
    expect(normalizeRegexFlags('')).toBe('gi');
    expect(normalizeRegexFlags('imiu')).toBe('gimu');

    expect(
      validateAiRegexRuleInput({
        label: '合法规则',
        pattern: '菜鸡|辣鸡',
        flags: 'i',
        replacement: '高手',
        scope: 'output',
      }),
    ).toEqual({
      ok: true,
      ruleInput: {
        label: '合法规则',
        pattern: '菜鸡|辣鸡',
        flags: 'gi',
        replacement: '高手',
        scope: 'output',
      },
    });

    expect(
      validateAiRegexRuleInput({
        label: '坏语法',
        pattern: '[unclosed',
        replacement: 'x',
        scope: 'both',
      }).ok,
    ).toBe(false);

    expect(
      validateAiRegexRuleInput({
        label: '空匹配',
        pattern: 'a*',
        replacement: 'x',
        scope: 'both',
      }).ok,
    ).toBe(false);

    expect(
      validateAiRegexRuleInput({
        label: '嵌套量词',
        pattern: '(a+)+',
        replacement: 'x',
        scope: 'both',
      }).ok,
    ).toBe(false);

    expect(
      validateAiRegexRuleInput({
        label: '非法标志',
        pattern: 'foo',
        flags: 'gx',
        replacement: 'bar',
        scope: 'both',
      }).ok,
    ).toBe(false);
  });

  it('distinguishes undefined vs empty array in sanitizeStoredRegexRules and generates unique IDs', () => {
    expect(sanitizeStoredRegexRules(undefined)).toBeUndefined();
    expect(sanitizeStoredRegexRules([])).toEqual([]);
    expect(
      sanitizeStoredRegexRules([
        { id: 'r1', label: 'ok', pattern: 'foo', flags: 'gi', replacement: 'bar', scope: 'both', enabled: false },
        { id: 'r1', label: 'dup', pattern: 'baz', flags: 'gi', replacement: 'qux', scope: 'both', enabled: true },
        { id: 'r2', label: 'bad', pattern: '(x+)+', flags: 'g', replacement: '', scope: 'output', enabled: true },
      ]),
    ).toEqual([
      { id: 'r1', label: 'ok', pattern: 'foo', flags: 'gi', replacement: 'bar', scope: 'both', enabled: false },
    ]);

    expect(generateAiRegexRuleId(new Set(['r1', 'r2']))).toBe('r3');
  });

  it('resolves non-bot Discord user mentions while keeping bot or unresolved mentions intact', () => {
    const out = resolveDiscordUserMentions(
      '请问 <@1001> 和 <@!1002> 跟 <@bot99> 以及 <@9999> 怎么看',
      'bot99',
      (id) => (id === '1001' ? '草莓布丁酱' : id === '1002' ? 'icebear' : null),
    );
    expect(out).toBe('请问 @草莓布丁酱 和 @icebear 跟 <@bot99> 以及 <@9999> 怎么看');
  });
});
