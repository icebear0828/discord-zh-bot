import { Events, type Client } from 'discord.js';
import type { AppContext } from '../ui/embeds.js';

export function registerInviteEvents(client: Client, ctx: AppContext): void {
  client.on(Events.InviteCreate, (invite) => {
    if (!invite.guild) return;
    ctx.services.invite.upsertInvite(invite.guild.id, invite.code, invite.uses ?? 0);
  });

  client.on(Events.InviteDelete, (invite) => {
    if (!invite.guild) return;
    ctx.services.invite.deleteInvite(invite.guild.id, invite.code);
  });
}
