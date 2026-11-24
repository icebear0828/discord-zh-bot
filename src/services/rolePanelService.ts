import {
  type RolePanel,
  type RolePanelDisplayMode,
  type RolePanelOption,
  type RolePanelRepo,
  type RolePanelSelectionMode,
} from '../db/repositories/rolePanelRepo.js';

export interface RoleDiff {
  toAdd: string[];
  toRemove: string[];
}

export function computeRoleDiff(
  panelRoleIds: readonly string[],
  currentMemberRoleIds: readonly string[],
  selectedRoleIds: readonly string[],
  displayMode: RolePanelDisplayMode,
  selectionMode: RolePanelSelectionMode,
): RoleDiff {
  const panelSet = new Set(panelRoleIds);
  const currentSet = new Set(currentMemberRoleIds);
  const selectedFiltered = [...new Set(selectedRoleIds.filter((id) => panelSet.has(id)))];

  if (displayMode === 'button') {
    const clickedRoleId = selectedFiltered[0];
    if (!clickedRoleId) {
      return { toAdd: [], toRemove: [] };
    }
    const alreadyHas = currentSet.has(clickedRoleId);

    if (selectionMode === 'multi') {
      return alreadyHas
        ? { toAdd: [], toRemove: [clickedRoleId] }
        : { toAdd: [clickedRoleId], toRemove: [] };
    }

    // Single-select button: clicking owned role removes it; clicking another swaps
    const otherOwnedPanelRoles = panelRoleIds.filter(
      (id) => id !== clickedRoleId && currentSet.has(id),
    );
    if (alreadyHas) {
      return { toAdd: [], toRemove: [clickedRoleId, ...otherOwnedPanelRoles] };
    }
    return { toAdd: [clickedRoleId], toRemove: otherOwnedPanelRoles };
  }

  // Select menu
  if (selectionMode === 'single') {
    const target = selectedFiltered[0];
    if (!target) {
      const toRemove = panelRoleIds.filter((id) => currentSet.has(id));
      return { toAdd: [], toRemove };
    }
    const toAdd = currentSet.has(target) ? [] : [target];
    const toRemove = panelRoleIds.filter((id) => id !== target && currentSet.has(id));
    return { toAdd, toRemove };
  }

  // Multi-select menu
  const selectedSet = new Set(selectedFiltered);
  const toAdd = selectedFiltered.filter((id) => !currentSet.has(id));
  const toRemove = panelRoleIds.filter((id) => !selectedSet.has(id) && currentSet.has(id));
  return { toAdd, toRemove };
}

export class RolePanelService {
  constructor(private readonly rolePanelRepo: RolePanelRepo) {}

  createPanel(input: {
    guildId: string;
    title: string;
    description: string;
    displayMode: RolePanelDisplayMode;
    selectionMode: RolePanelSelectionMode;
  }): RolePanel {
    return this.rolePanelRepo.create(input);
  }

  getPanelWithOptions(
    guildId: string,
    panelId: number,
  ): { panel: RolePanel; options: RolePanelOption[] } | null {
    const panel = this.rolePanelRepo.getByGuildAndId(guildId, panelId);
    if (!panel) {
      return null;
    }
    return {
      panel,
      options: this.rolePanelRepo.listOptions(panel.id),
    };
  }

  getPanelById(panelId: number): { panel: RolePanel; options: RolePanelOption[] } | null {
    const panel = this.rolePanelRepo.getById(panelId);
    if (!panel) {
      return null;
    }
    return {
      panel,
      options: this.rolePanelRepo.listOptions(panel.id),
    };
  }

  listPanels(guildId: string): RolePanel[] {
    return this.rolePanelRepo.listByGuild(guildId);
  }

  addOption(
    guildId: string,
    panelId: number,
    input: {
      roleId: string;
      label: string;
      emoji: string | null;
      description: string | null;
    },
  ):
    | { ok: true; option: RolePanelOption }
    | { ok: false; reason: 'panel_not_found' | 'limit_reached' | 'duplicate_role' } {
    const panel = this.rolePanelRepo.getByGuildAndId(guildId, panelId);
    if (!panel) {
      return { ok: false, reason: 'panel_not_found' };
    }
    const existing = this.rolePanelRepo.listOptions(panelId);
    if (existing.length >= 25) {
      return { ok: false, reason: 'limit_reached' };
    }
    if (existing.some((o) => o.roleId === input.roleId)) {
      return { ok: false, reason: 'duplicate_role' };
    }

    const option = this.rolePanelRepo.addOption({
      panelId,
      roleId: input.roleId,
      label: input.label,
      emoji: input.emoji,
      description: input.description,
      sortOrder: existing.length,
    });
    return { ok: true, option };
  }

  removeOption(guildId: string, panelId: number, roleId: string): boolean {
    const panel = this.rolePanelRepo.getByGuildAndId(guildId, panelId);
    if (!panel) {
      return false;
    }
    return this.rolePanelRepo.removeOption(panelId, roleId);
  }

  setPanelMessage(panelId: number, channelId: string, messageId: string): void {
    this.rolePanelRepo.setMessage(panelId, channelId, messageId);
  }

  updatePanelModes(
    guildId: string,
    panelId: number,
    displayMode: RolePanelDisplayMode,
    selectionMode: RolePanelSelectionMode,
  ): RolePanel | null {
    return this.rolePanelRepo.updateModes(panelId, guildId, displayMode, selectionMode);
  }

  deletePanel(guildId: string, panelId: number): boolean {
    return this.rolePanelRepo.delete(panelId, guildId);
  }
}
