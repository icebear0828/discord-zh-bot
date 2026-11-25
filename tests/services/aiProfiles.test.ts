import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { AiMemoryRepo } from '../../src/db/repositories/aiMemoryRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import {
  formatAiRelationBadge,
  formatAiRelationLabel,
  MAX_AI_USER_ALIAS_LEN,
  MAX_AI_USER_NOTE_LEN,
  MAX_AI_USER_PROFILES,
  sanitizeStoredUserProfiles,
  validateAiUserProfileInput,
} from '../../src/services/aiProfiles.js';
import { AiService } from '../../src/services/aiService.js';
import { LlmClient } from '../../src/services/llmClient.js';

describe('aiProfiles validation & AiService profile CRUD', () => {
  it('validates userId, alias, relation, and note bounds', () => {
    expect(
      validateAiUserProfileInput({
        userId: 'not-a-snowflake',
        alias: '冰吊王',
        relation: 'vip',
      }).ok,
    ).toBe(false);

    expect(
      validateAiUserProfileInput({
        userId: '100000000000000001',
        alias: '',
        relation: 'vip',
      }).ok,
    ).toBe(false);

    expect(
      validateAiUserProfileInput({
        userId: '100000000000000001',
        alias: 'a'.repeat(MAX_AI_USER_ALIAS_LEN + 1),
        relation: 'vip',
      }).ok,
    ).toBe(false);

    expect(
      validateAiUserProfileInput({
        userId: '100000000000000001',
        alias: '冰吊王',
        relation: 'admin',
      }).ok,
    ).toBe(false);

    expect(
      validateAiUserProfileInput({
        userId: '100000000000000001',
        alias: '冰吊王',
        relation: 'vip',
        note: 'n'.repeat(MAX_AI_USER_NOTE_LEN + 1),
      }).ok,
    ).toBe(false);

    const ok = validateAiUserProfileInput({
      userId: ' 100000000000000001 ',
      alias: '  冰吊王  ',
      relation: 'VIP',
      note: '  老大   护短  ',
    });
    expect(ok).toEqual({
      ok: true,
      profile: {
        userId: '100000000000000001',
        alias: '冰吊王',
        relation: 'vip',
        note: '老大 护短',
      },
    });
    expect(formatAiRelationLabel('vip')).toBe('核心偏爱');
    expect(formatAiRelationLabel('friend')).toBe('熟人');
    expect(formatAiRelationLabel('rival')).toBe('重点怼');
    expect(formatAiRelationBadge('rival')).toBe('🎯 重点怼');
  });

  it('sanitizes stored profiles with deduplication, invalid entry filtering, and capacity cap', () => {
    const raw = [
      null,
      { userId: 'bad', alias: 'x', relation: 'vip' },
      { userId: '100000000000000001', alias: '冰吊王', relation: 'vip', note: 'first' },
      { userId: '100000000000000001', alias: '重复', relation: 'rival', note: 'dup' },
      ...Array.from({ length: MAX_AI_USER_PROFILES + 5 }, (_, i) => ({
        userId: String(200000000000000000n + BigInt(i)),
        alias: `群友${i}`,
        relation: i % 2 === 0 ? 'friend' : 'rival',
      })),
    ];

    const sanitized = sanitizeStoredUserProfiles(raw);
    expect(sanitized).toHaveLength(MAX_AI_USER_PROFILES);
    expect(sanitized[0]).toEqual({
      userId: '100000000000000001',
      alias: '冰吊王',
      relation: 'vip',
      note: 'first',
    });
  });

  it('supports CRUD, updates existing profile without consuming extra slot, and enforces max limit in AiService', () => {
    const db = createDatabase(':memory:');
    const guildConfigRepo = new GuildConfigRepo(db);
    const aiMemoryRepo = new AiMemoryRepo(db);
    const llmClient = new LlmClient(undefined);
    const aiService = new AiService(guildConfigRepo, aiMemoryRepo, llmClient);

    for (let i = 0; i < MAX_AI_USER_PROFILES; i++) {
      const uid = String(300000000000000000n + BigInt(i));
      const added = aiService.upsertUserProfile('g1', {
        userId: uid,
        alias: `成员${i}`,
        relation: 'friend',
      });
      expect(added.ok).toBe(true);
      if (added.ok) expect(added.updated).toBe(false);
    }

    // 51st new user fails cap
    const overflow = aiService.upsertUserProfile('g1', {
      userId: '400000000000000001',
      alias: '溢出',
      relation: 'rival',
    });
    expect(overflow.ok).toBe(false);

    // Updating existing user succeeds even at max capacity
    const updated = aiService.upsertUserProfile('g1', {
      userId: '300000000000000000',
      alias: '冰吊王',
      relation: 'vip',
      note: '核心大佬',
    });
    expect(updated).toEqual({
      ok: true,
      updated: true,
      profile: {
        userId: '300000000000000000',
        alias: '冰吊王',
        relation: 'vip',
        note: '核心大佬',
      },
    });
    expect(aiService.listUserProfiles('g1')).toHaveLength(MAX_AI_USER_PROFILES);

    // Reload from SQLite verifies persistence
    const reloaded = guildConfigRepo.getOrCreate('g1').ai.userProfiles;
    expect(reloaded[0]?.alias).toBe('冰吊王');
    expect(reloaded[0]?.relation).toBe('vip');

    const del = aiService.deleteUserProfile('g1', '300000000000000000');
    expect(del.ok).toBe(true);
    expect(aiService.listUserProfiles('g1')).toHaveLength(MAX_AI_USER_PROFILES - 1);

    const delMissing = aiService.deleteUserProfile('g1', '999999999999999999');
    expect(delMissing.ok).toBe(false);

    db.close();
  });
});
