import type {
  AiMemoryRecord,
  AiMemoryScopeType,
  AiUsageLogRecord,
  AiUsageSummary,
} from '../../db/repositories/aiMemoryRepo.js';
import {
  MAX_AI_USER_PROFILES,
  validateAiUserProfileInput,
  type AiUserProfile,
  type AiUserRelation,
} from '../aiProfiles.js';
import {
  applyAiRegexRules,
  cloneDefaultAiRegexRules,
  generateAiRegexRuleId,
  MAX_AI_REGEX_RULES,
  validateAiRegexRuleInput,
  type AiRegexRule,
  type AiRegexRuleInput,
} from '../aiRegex.js';
import { sanitizeLlmInputText } from './aiInputSanitizer.js';
import type { AiServiceRuntimeDeps } from './aiTypes.js';

type MemConfigDeps = Pick<AiServiceRuntimeDeps, 'guildConfigRepo' | 'aiMemoryRepo'>;
type ConfigOnlyDeps = Pick<AiServiceRuntimeDeps, 'guildConfigRepo' | 'inputSanitizerStore'>;
type MemOnlyDeps = Pick<AiServiceRuntimeDeps, 'aiMemoryRepo'>;

export function getChannelResetAtOp(deps: MemOnlyDeps, guildId: string, channelId: string): number {
  return deps.aiMemoryRepo.getChannelResetAt(guildId, channelId);
}

export function resetChannelContextOp(
  deps: MemOnlyDeps,
  guildId: string,
  channelId: string,
  nowMs = Date.now(),
): void {
  deps.aiMemoryRepo.setChannelResetAt(guildId, channelId, nowMs);
}

export function listMemoriesOp(
  deps: MemOnlyDeps,
  guildId: string,
  scopeType: AiMemoryScopeType,
  scopeId: string,
  limit = 30,
): AiMemoryRecord[] {
  return deps.aiMemoryRepo.listMemories(guildId, scopeType, scopeId, limit);
}

export function addMemoryOp(
  deps: MemConfigDeps,
  input: {
    guildId: string;
    scopeType: AiMemoryScopeType;
    scopeId: string;
    category: string;
    content: string;
    createdBy: string;
  },
): AiMemoryRecord {
  const cfg = deps.guildConfigRepo.getOrCreate(input.guildId);
  return deps.aiMemoryRepo.addMemory({
    ...input,
    maxPerScope: cfg.ai.maxMemoriesPerScope,
  });
}

export function getMemoryByIdOp(
  deps: MemOnlyDeps,
  guildId: string,
  id: number,
): AiMemoryRecord | null {
  return deps.aiMemoryRepo.getById(guildId, id);
}

export function deleteMemoryOp(deps: MemOnlyDeps, guildId: string, id: number): boolean {
  return deps.aiMemoryRepo.deleteById(guildId, id);
}

export function clearMemoriesOp(
  deps: MemOnlyDeps,
  guildId: string,
  scopeType: AiMemoryScopeType,
  scopeId: string,
): number {
  return deps.aiMemoryRepo.clearScope(guildId, scopeType, scopeId);
}

export function countMemoriesOp(
  deps: MemOnlyDeps,
  guildId: string,
): {
  total: number;
  user: number;
  channel: number;
  guild: number;
} {
  return deps.aiMemoryRepo.countByGuild(guildId);
}

export function addRegexRuleOp(
  deps: ConfigOnlyDeps,
  guildId: string,
  input: AiRegexRuleInput,
): { ok: true; rule: AiRegexRule } | { ok: false; error: string } {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  if (cfg.ai.regexRules.length >= MAX_AI_REGEX_RULES) {
    return {
      ok: false,
      error: `正则规则数量已达上限（最多 ${MAX_AI_REGEX_RULES} 条），请先删除不用的规则。`,
    };
  }

  const validated = validateAiRegexRuleInput(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const existingIds = new Set(cfg.ai.regexRules.map((r) => r.id));
  const rule: AiRegexRule = {
    id: generateAiRegexRuleId(existingIds),
    ...validated.ruleInput,
    enabled: true,
  };

  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    regexRules: [...cfg.ai.regexRules, rule],
  });
  return { ok: true, rule };
}

export function toggleRegexRuleOp(
  deps: ConfigOnlyDeps,
  guildId: string,
  ruleId: string,
): { ok: true; rule: AiRegexRule } | { ok: false; error: string } {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const target = cfg.ai.regexRules.find((r) => r.id === ruleId);
  if (!target) {
    return { ok: false, error: `找不到编号为 \`${ruleId}\` 的正则规则。` };
  }
  const updated: AiRegexRule = { ...target, enabled: !target.enabled };
  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    regexRules: cfg.ai.regexRules.map((r) => (r.id === ruleId ? updated : r)),
  });
  return { ok: true, rule: updated };
}

export function deleteRegexRuleOp(
  deps: ConfigOnlyDeps,
  guildId: string,
  ruleId: string,
): { ok: true; rule: AiRegexRule } | { ok: false; error: string } {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const target = cfg.ai.regexRules.find((r) => r.id === ruleId);
  if (!target) {
    return { ok: false, error: `找不到编号为 \`${ruleId}\` 的正则规则。` };
  }
  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    regexRules: cfg.ai.regexRules.filter((r) => r.id !== ruleId),
  });
  return { ok: true, rule: target };
}

export function resetRegexRulesOp(deps: ConfigOnlyDeps, guildId: string): AiRegexRule[] {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const defaults = cloneDefaultAiRegexRules();
  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    antiClichePromptEnabled: true,
    inputSanitizerEnabled: true,
    regexRules: defaults,
  });
  return defaults;
}

export function toggleAntiClichePromptOp(deps: ConfigOnlyDeps, guildId: string): boolean {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const next = !cfg.ai.antiClichePromptEnabled;
  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    antiClichePromptEnabled: next,
  });
  return next;
}

export function toggleInputSanitizerOp(deps: ConfigOnlyDeps, guildId: string): boolean {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const next = cfg.ai.inputSanitizerEnabled === false;
  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    inputSanitizerEnabled: next,
  });
  return next;
}

export function previewRegexRulesOp(
  deps: ConfigOnlyDeps,
  guildId: string,
  text: string,
  stage: 'input' | 'output',
): { before: string; after: string; changed: boolean } {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const baseText =
    stage === 'input' && cfg.ai.inputSanitizerEnabled !== false
      ? sanitizeLlmInputText(text, { store: deps.inputSanitizerStore })
      : text;
  const after = applyAiRegexRules(baseText, cfg.ai.regexRules, stage, {
    preserveCodeBlocks: stage === 'output',
  });
  return {
    before: text,
    after,
    changed: after !== text,
  };
}

export function getUsageSummaryOp(
  deps: MemConfigDeps,
  guildId: string,
  windowHours: number,
  nowMs = Date.now(),
): AiUsageSummary {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const safeHours = Math.max(1, Math.min(720, Math.floor(windowHours)));
  const sinceMs = nowMs - safeHours * 3600_000;
  return deps.aiMemoryRepo.summarizeUsage(guildId, sinceMs, {
    inputPricePer1MUsd: cfg.ai.inputPricePer1MUsd,
    outputPricePer1MUsd: cfg.ai.outputPricePer1MUsd,
  });
}

export function listRecentUsageLogsOp(
  deps: MemOnlyDeps,
  guildId: string,
  limit = 10,
): AiUsageLogRecord[] {
  return deps.aiMemoryRepo.listRecentUsageLogs(guildId, limit);
}

export function clearUsageLogsOp(deps: MemOnlyDeps, guildId: string): number {
  return deps.aiMemoryRepo.clearUsageLogs(guildId);
}

export function updatePricingOp(
  deps: ConfigOnlyDeps,
  guildId: string,
  inputPricePer1MUsd: number,
  outputPricePer1MUsd: number,
): void {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    inputPricePer1MUsd: Number(Math.max(0, inputPricePer1MUsd).toFixed(4)),
    outputPricePer1MUsd: Number(Math.max(0, outputPricePer1MUsd).toFixed(4)),
  });
}

export function listUserProfilesOp(deps: ConfigOnlyDeps, guildId: string): AiUserProfile[] {
  return deps.guildConfigRepo.getOrCreate(guildId).ai.userProfiles;
}

export function upsertUserProfileOp(
  deps: ConfigOnlyDeps,
  guildId: string,
  input: { userId: string; alias: string; relation: AiUserRelation | string; note?: string },
): { ok: true; profile: AiUserProfile; updated: boolean } | { ok: false; error: string } {
  const validated = validateAiUserProfileInput(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const existingIdx = cfg.ai.userProfiles.findIndex(
    (p) => p.userId === validated.profile.userId,
  );
  if (existingIdx >= 0) {
    const next = cfg.ai.userProfiles.map((p, idx) =>
      idx === existingIdx ? validated.profile : p,
    );
    deps.guildConfigRepo.updateAi(guildId, { ...cfg.ai, userProfiles: next });
    return { ok: true, profile: validated.profile, updated: true };
  }

  if (cfg.ai.userProfiles.length >= MAX_AI_USER_PROFILES) {
    return {
      ok: false,
      error: `人物档案数量已达上限（最多 ${MAX_AI_USER_PROFILES} 条），请先删除不再需要的档案。`,
    };
  }

  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    userProfiles: [...cfg.ai.userProfiles, validated.profile],
  });
  return { ok: true, profile: validated.profile, updated: false };
}

export function deleteUserProfileOp(
  deps: ConfigOnlyDeps,
  guildId: string,
  userId: string,
): { ok: true; profile: AiUserProfile } | { ok: false; error: string } {
  const trimmed = userId.trim();
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const target = cfg.ai.userProfiles.find((p) => p.userId === trimmed);
  if (!target) {
    return { ok: false, error: `未找到用户 <@${trimmed}> 的人物档案。` };
  }
  deps.guildConfigRepo.updateAi(guildId, {
    ...cfg.ai,
    userProfiles: cfg.ai.userProfiles.filter((p) => p.userId !== trimmed),
  });
  return { ok: true, profile: target };
}
