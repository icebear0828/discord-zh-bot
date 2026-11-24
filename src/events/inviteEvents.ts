import { Events, type Client } from 'discord.js';
import type { AppContext } from '../ui/embeds.js';

export function registerInviteEvents(client: Client, ctx: AppContext): void {
  client.on(Events.InviteCreate, (invite) => {
    if (!invite.guild) return;
    ctx.services.invite.upsertInvite(invite.guild.id, invite.code, invite.uses ?? 0, {
      inviterId: invite.inviterId,
      maxUses: invite.maxUses,
    });
  });

  client.on(Events.InviteDelete, (invite) => {
    if (!invite.guild) return;
    ctx.services.invite.deleteInvite(invite.guild.id, invite.code);
  });

  client.on(Events.GuildCreate, async (guild) => {
    try {
      const invites = await guild.invites.fetch();
      ctx.services.invite.syncGuildInvites(
        guild.id,
        [...invites.values()].map((inv) => ({
          code: inv.code,
          uses: inv.uses ?? 0,
          inviterId: inv.inviterId,
          maxUses: inv.maxUses,
        })),
      );
    } catch {
      // Missing ManageGuild permission on newly joined guild — skip gracefully
    }
  });
}
