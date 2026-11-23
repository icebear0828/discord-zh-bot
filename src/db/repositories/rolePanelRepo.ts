import type Database from 'better-sqlite3';

export type RolePanelDisplayMode = 'button' | 'select';
export type RolePanelSelectionMode = 'multi' | 'single';

export interface RolePanel {
  id: number;
  guildId: string;
  title: string;
  description: string;
  displayMode: RolePanelDisplayMode;
  selectionMode: RolePanelSelectionMode;
  channelId: string | null;
  messageId: string | null;
  createdAt: number;
}

export interface RolePanelOption {
  id: number;
  panelId: number;
  roleId: string;
  label: string;
  emoji: string | null;
  description: string | null;
  sortOrder: number;
}

interface RolePanelRow {
  id: number;
  guild_id: string;
  title: string;
  description: string;
  display_mode: RolePanelDisplayMode;
  selection_mode: RolePanelSelectionMode;
  channel_id: string | null;
  message_id: string | null;
  created_at: number;
}

interface RolePanelOptionRow {
  id: number;
  panel_id: number;
  role_id: string;
  label: string;
  emoji: string | null;
  description: string | null;
  sort_order: number;
}

function mapPanel(row: RolePanelRow): RolePanel {
  return {
    id: row.id,
    guildId: row.guild_id,
    title: row.title,
    description: row.description,
    displayMode: row.display_mode,
    selectionMode: row.selection_mode,
    channelId: row.channel_id,
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

function mapOption(row: RolePanelOptionRow): RolePanelOption {
  return {
    id: row.id,
    panelId: row.panel_id,
    roleId: row.role_id,
    label: row.label,
    emoji: row.emoji,
    description: row.description,
    sortOrder: row.sort_order,
  };
}

export class RolePanelRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    guildId: string;
    title: string;
    description: string;
    displayMode: RolePanelDisplayMode;
    selectionMode: RolePanelSelectionMode;
    createdAt?: number;
  }): RolePanel {
    const now = input.createdAt ?? Date.now();
    const res = this.db
      .prepare(
        `INSERT INTO role_panels (
          guild_id, title, description, display_mode, selection_mode, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.guildId,
        input.title,
        input.description,
        input.displayMode,
        input.selectionMode,
        now,
      );
    return this.getById(Number(res.lastInsertRowid))!;
  }

  getById(panelId: number): RolePanel | null {
    const row = this.db
      .prepare('SELECT * FROM role_panels WHERE id = ?')
      .get(panelId) as RolePanelRow | undefined;
    return row ? mapPanel(row) : null;
  }

  getByGuildAndId(guildId: string, panelId: number): RolePanel | null {
    const row = this.db
      .prepare('SELECT * FROM role_panels WHERE guild_id = ? AND id = ?')
      .get(guildId, panelId) as RolePanelRow | undefined;
    return row ? mapPanel(row) : null;
  }

  listByGuild(guildId: string): RolePanel[] {
    const rows = this.db
      .prepare('SELECT * FROM role_panels WHERE guild_id = ? ORDER BY id ASC')
      .all(guildId) as RolePanelRow[];
    return rows.map(mapPanel);
  }

  setMessage(panelId: number, channelId: string, messageId: string): void {
    this.db
      .prepare('UPDATE role_panels SET channel_id = ?, message_id = ? WHERE id = ?')
      .run(channelId, messageId, panelId);
  }

  delete(panelId: number, guildId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM role_panels WHERE id = ? AND guild_id = ?')
      .run(panelId, guildId);
    return res.changes > 0;
  }

  listOptions(panelId: number): RolePanelOption[] {
    const rows = this.db
      .prepare('SELECT * FROM role_panel_options WHERE panel_id = ? ORDER BY sort_order ASC, id ASC')
      .all(panelId) as RolePanelOptionRow[];
    return rows.map(mapOption);
  }

  addOption(input: {
    panelId: number;
    roleId: string;
    label: string;
    emoji: string | null;
    description: string | null;
    sortOrder: number;
  }): RolePanelOption {
    const res = this.db
      .prepare(
        `INSERT INTO role_panel_options (
          panel_id, role_id, label, emoji, description, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.panelId,
        input.roleId,
        input.label,
        input.emoji,
        input.description,
        input.sortOrder,
      );
    const row = this.db
      .prepare('SELECT * FROM role_panel_options WHERE id = ?')
      .get(Number(res.lastInsertRowid)) as RolePanelOptionRow;
    return mapOption(row);
  }

  removeOption(panelId: number, roleId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM role_panel_options WHERE panel_id = ? AND role_id = ?')
      .run(panelId, roleId);
    return res.changes > 0;
  }
}
