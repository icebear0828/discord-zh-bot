import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { RolePanelRepo } from '../../src/db/repositories/rolePanelRepo.js';
import { computeRoleDiff, RolePanelService } from '../../src/services/rolePanelService.js';

describe('rolePanelService', () => {
  it('computes single-select and multi-select diffs for buttons and select menus', () => {
    const panelRoleIds = ['r1', 'r2', 'r3'];

    // Button + multi: toggles clicked role only
    expect(computeRoleDiff(panelRoleIds, ['r1', 'other'], ['r2'], 'button', 'multi')).toEqual({
      toAdd: ['r2'],
      toRemove: [],
    });
    expect(computeRoleDiff(panelRoleIds, ['r1', 'other'], ['r1'], 'button', 'multi')).toEqual({
      toAdd: [],
      toRemove: ['r1'],
    });

    // Button + single: switches from r1 to r2, or removes r1 if clicked again
    expect(computeRoleDiff(panelRoleIds, ['r1', 'other'], ['r2'], 'button', 'single')).toEqual({
      toAdd: ['r2'],
      toRemove: ['r1'],
    });
    expect(computeRoleDiff(panelRoleIds, ['r1', 'other'], ['r1'], 'button', 'single')).toEqual({
      toAdd: [],
      toRemove: ['r1'],
    });

    // Select + multi: syncs panel subset without touching unrelated 'other' role
    expect(computeRoleDiff(panelRoleIds, ['r1', 'r2', 'other'], ['r2', 'r3'], 'select', 'multi')).toEqual({
      toAdd: ['r3'],
      toRemove: ['r1'],
    });

    // Select + single: clears old panel roles and adds selected
    expect(computeRoleDiff(panelRoleIds, ['r1', 'r2', 'other'], ['r3'], 'select', 'single')).toEqual({
      toAdd: ['r3'],
      toRemove: ['r1', 'r2'],
    });
  });

  it('enforces max 25 options and no duplicate roles per panel', () => {
    const db = createDatabase(':memory:');
    const repo = new RolePanelRepo(db);
    const svc = new RolePanelService(repo);

    const panel = svc.createPanel({
      guildId: 'g1',
      title: '颜色',
      description: '选择你喜欢的颜色',
      displayMode: 'select',
      selectionMode: 'single',
    });

    expect(
      svc.addOption('g1', panel.id, { roleId: 'r1', label: '红', emoji: '🔴', description: null }).ok,
    ).toBe(true);
    expect(
      svc.addOption('g1', panel.id, { roleId: 'r1', label: '红2', emoji: null, description: null }).ok,
    ).toBe(false);

    for (let i = 2; i <= 25; i++) {
      expect(
        svc.addOption('g1', panel.id, { roleId: `r${i}`, label: `选项${i}`, emoji: null, description: null }).ok,
      ).toBe(true);
    }
    expect(
      svc.addOption('g1', panel.id, { roleId: 'r26', label: '超限', emoji: null, description: null }).ok,
    ).toBe(false);

    db.close();
  });
});
