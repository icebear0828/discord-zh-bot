import { Events, type Client } from 'discord.js';
import { routeInteraction } from '../interactions/router.js';
import type { AppContext } from '../ui/embeds.js';

export function registerInteractionCreateEvent(client: Client, ctx: AppContext): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void routeInteraction(interaction, ctx);
  });
}
