import { describe, expect, it } from 'vitest';
import { createDefaultGuildConfig } from '../../src/config/defaults.js';
import { isBotAdmin, isModuleEnabled } from '../../src/services/permissionService.js';

describe('permissionService', () => {
  it('grants admin to server admins, manage-guild holders, and configured admin roles', () => {
    expect(
      isBotAdmin({
        isGuildAdmin: true,
        hasManageGuild: false,
        memberRoleIds: [],
        configuredAdminRoleIds: [],
      }),
    ).toBe(true);

    expect(
      isBotAdmin({
        isGuildAdmin: false,
        hasManageGuild: true,
        memberRoleIds: [],
        configuredAdminRoleIds: [],
      }),
    ).toBe(true);

    expect(
      isBotAdmin({
        isGuildAdmin: false,
        hasManageGuild: false,
        memberRoleIds: ['role-mod'],
        configuredAdminRoleIds: ['role-mod'],
      }),
    ).toBe(true);

    expect(
      isBotAdmin({
        isGuildAdmin: false,
        hasManageGuild: false,
        memberRoleIds: ['role-member'],
        configuredAdminRoleIds: ['role-mod'],
      }),
    ).toBe(false);
  });

  it('checks whether a module is enabled', () => {
    const cfg = createDefaultGuildConfig('g1');
    expect(isModuleEnabled(cfg, 'leveling')).toBe(true);
    cfg.modules.economy = false;
    expect(isModuleEnabled(cfg, 'economy')).toBe(false);
  });
});
