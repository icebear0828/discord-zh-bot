import { describe, expect, it } from 'vitest';
import { commands } from '../../src/commands/registry.js';

const DISCORD_NAME_REGEX = /^[-_\u02BC\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

interface JsonOptionLike {
  name: string;
  description: string;
  name_localizations?: Record<string, string>;
  description_localizations?: Record<string, string>;
  options?: JsonOptionLike[];
}

function validateNode(node: JsonOptionLike, path: string): void {
  expect(node.name, `${path}.name`).toMatch(DISCORD_NAME_REGEX);
  expect(node.description.length, `${path}.description length`).toBeGreaterThanOrEqual(1);
  expect(node.description.length, `${path}.description length`).toBeLessThanOrEqual(100);

  const zhCn = node.name_localizations?.['zh-CN'];
  expect(zhCn, `${path} missing zh-CN localization`).toBeTruthy();
  if (zhCn) {
    expect(zhCn, `${path}.zh-CN`).toMatch(DISCORD_NAME_REGEX);
  }

  for (const child of node.options ?? []) {
    validateNode(child, `${path}.${child.name}`);
  }
}

describe('command registry localization & Discord constraints', () => {
  it('registers 24 unique commands with valid names, zh-CN localizations, and descriptions', () => {
    expect(commands).toHaveLength(24);

    const names = new Set<string>();
    const zhNames = new Set<string>();

    for (const cmd of commands) {
      const json = cmd.data.toJSON() as JsonOptionLike;
      expect(names.has(json.name), `Duplicate command name: ${json.name}`).toBe(false);
      names.add(json.name);

      const zhCn = json.name_localizations?.['zh-CN'];
      if (zhCn) {
        expect(zhNames.has(zhCn), `Duplicate zh-CN command name: ${zhCn}`).toBe(false);
        zhNames.add(zhCn);
      }

      validateNode(json, json.name);
    }
  });
});
