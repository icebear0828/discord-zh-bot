import { Client, GatewayIntentBits } from 'discord.js';
import { loadEnv } from './config/env.js';
import { createDatabase } from './db/database.js';
import { GuildConfigRepo } from './db/repositories/guildConfigRepo.js';
import { ProfileRepo } from './db/repositories/profileRepo.js';
import { ShopRepo } from './db/repositories/shopRepo.js';
import { FunRepo } from './db/repositories/funRepo.js';
import { TicketRepo } from './db/repositories/ticketRepo.js';
import { GiveawayRepo } from './db/repositories/giveawayRepo.js';
import { InviteRepo } from './db/repositories/inviteRepo.js';
import { RolePanelRepo } from './db/repositories/rolePanelRepo.js';
import { LevelingService } from './services/levelingService.js';
import { EconomyService } from './services/economyService.js';
import { BlackjackManager } from './services/blackjackService.js';
import { ShopService } from './services/shopService.js';
import { FunService } from './services/funService.js';
import { TicketService } from './services/ticketService.js';
import { GiveawayService } from './services/giveawayService.js';
import { InviteService } from './services/inviteService.js';
import { RolePanelService } from './services/rolePanelService.js';
import type { AppContext } from './ui/embeds.js';
import { registerReadyEvent } from './events/ready.js';
import { registerMessageCreateEvent } from './events/messageCreate.js';
import { registerGuildMemberAddEvent } from './events/guildMemberAdd.js';
import { registerGuildMemberRemoveEvent } from './events/guildMemberRemove.js';
import { registerInviteEvents } from './events/inviteEvents.js';
import { registerInteractionCreateEvent } from './events/interactionCreate.js';

function main(): void {
  const env = loadEnv();
  const db = createDatabase(env.dbPath);

  const guildConfigRepo = new GuildConfigRepo(db);
  const profileRepo = new ProfileRepo(db);
  const shopRepo = new ShopRepo(db);
  const funRepo = new FunRepo(db);
  const ticketRepo = new TicketRepo(db);
  const giveawayRepo = new GiveawayRepo(db);
  const inviteRepo = new InviteRepo(db);
  const rolePanelRepo = new RolePanelRepo(db);

  const ctx: AppContext = {
    db,
    timezone: env.timezone,
    repos: {
      guildConfig: guildConfigRepo,
      profile: profileRepo,
      shop: shopRepo,
      fun: funRepo,
      ticket: ticketRepo,
      giveaway: giveawayRepo,
      invite: inviteRepo,
      rolePanel: rolePanelRepo,
    },
    services: {
      leveling: new LevelingService(guildConfigRepo, profileRepo, inviteRepo),
      economy: new EconomyService(db, guildConfigRepo, profileRepo, env.timezone),
      blackjack: new BlackjackManager(db, profileRepo),
      shop: new ShopService(db, profileRepo, shopRepo),
      fun: new FunService(db, profileRepo, shopRepo, funRepo, env.timezone),
      ticket: new TicketService(guildConfigRepo, ticketRepo),
      giveaway: new GiveawayService(giveawayRepo),
      invite: new InviteService(inviteRepo),
      rolePanel: new RolePanelService(rolePanelRepo),
    },
  };

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildInvites,
    ],
  });

  const schedulers = registerReadyEvent(client, ctx);
  registerMessageCreateEvent(client, ctx);
  registerGuildMemberAddEvent(client, ctx);
  registerGuildMemberRemoveEvent(client, ctx);
  registerInviteEvents(client, ctx);
  registerInteractionCreateEvent(client, ctx);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[bot] 收到 ${signal}，正在安全关闭...`);
    schedulers.stop();
    void client.destroy();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  void client.login(env.discordToken);
}

main();
