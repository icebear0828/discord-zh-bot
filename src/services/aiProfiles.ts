export type AiUserRelation = 'vip' | 'friend' | 'rival';

export interface AiUserProfile {
  userId: string;
  alias: string;
  relation: AiUserRelation;
  note: string;
}

export interface AiUserProfileInput {
  userId: string;
  alias: string;
  relation: string;
  note?: string;
}

export const MAX_AI_USER_PROFILES = 50;
export const MAX_AI_USER_ALIAS_LEN = 24;
export const MAX_AI_USER_NOTE_LEN = 200;

const VALID_RELATIONS: ReadonlySet<string> = new Set(['vip', 'friend', 'rival']);
const DISCORD_SNOWFLAKE_RE = /^\d{15,22}$/;

export function isValidAiUserRelation(raw: unknown): raw is AiUserRelation {
  return typeof raw === 'string' && VALID_RELATIONS.has(raw);
}

export function formatAiRelationLabel(relation: AiUserRelation): string {
  if (relation === 'vip') return '核心偏爱';
  if (relation === 'rival') return '重点怼';
  return '熟人';
}

export function formatAiRelationBadge(relation: AiUserRelation): string {
  if (relation === 'vip') return '👑 核心偏爱';
  if (relation === 'rival') return '🎯 重点怼';
  return '🤝 熟人';
}

export type ValidateAiUserProfileResult =
  | {
      ok: true;
      profile: AiUserProfile;
    }
  | {
      ok: false;
      error: string;
    };

export function validateAiUserProfileInput(
  input: AiUserProfileInput,
): ValidateAiUserProfileResult {
  const userId = input.userId.trim();
  const alias = input.alias.replace(/\s+/g, ' ').trim();
  const relationRaw = input.relation.trim().toLowerCase();
  const note = (input.note ?? '').replace(/\s+/g, ' ').trim();

  if (!DISCORD_SNOWFLAKE_RE.test(userId)) {
    return {
      ok: false,
      error: '成员 ID 格式无效，请直接选择 Discord 群友。',
    };
  }
  if (!alias || alias.length > MAX_AI_USER_ALIAS_LEN) {
    return {
      ok: false,
      error: `称呼长度需在 1 ~ ${MAX_AI_USER_ALIAS_LEN} 字之间。`,
    };
  }
  if (!isValidAiUserRelation(relationRaw)) {
    return {
      ok: false,
      error: '关系档位无效，必须为 `vip`（核心偏爱）、`friend`（熟人）或 `rival`（重点怼）。',
    };
  }
  if (note.length > MAX_AI_USER_NOTE_LEN) {
    return {
      ok: false,
      error: `备注长度不能超过 ${MAX_AI_USER_NOTE_LEN} 字。`,
    };
  }

  return {
    ok: true,
    profile: {
      userId,
      alias,
      relation: relationRaw,
      note,
    },
  };
}

export function sanitizeStoredUserProfiles(raw: unknown): AiUserProfile[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: AiUserProfile[] = [];
  const seenIds = new Set<string>();

  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const userId = typeof obj['userId'] === 'string' ? obj['userId'] : '';
    const alias = typeof obj['alias'] === 'string' ? obj['alias'] : '';
    const relation = typeof obj['relation'] === 'string' ? obj['relation'] : '';
    const note = typeof obj['note'] === 'string' ? obj['note'] : '';

    const validated = validateAiUserProfileInput({ userId, alias, relation, note });
    if (!validated.ok) continue;
    if (seenIds.has(validated.profile.userId)) continue;

    seenIds.add(validated.profile.userId);
    result.push(validated.profile);

    if (result.length >= MAX_AI_USER_PROFILES) break;
  }

  return result;
}
