import type { GuildConfig, ModuleKey } from '../config/defaults.js';

export interface AdminCheckInput {
  isGuildAdmin: boolean;
  hasManageGuild: boolean;
  memberRoleIds: readonly string[];
  configuredAdminRoleIds: readonly string[];
}

export function isBotAdmin(input: AdminCheckInput): boolean {
  if (input.isGuildAdmin || input.hasManageGuild) {
    return true;
  }
  if (input.configuredAdminRoleIds.length === 0) {
    return false;
  }
  const roleSet = new Set(input.memberRoleIds);
  return input.configuredAdminRoleIds.some((id) => roleSet.has(id));
}

export function isModuleEnabled(config: GuildConfig, moduleKey: ModuleKey): boolean {
  return config.modules[moduleKey];
}
