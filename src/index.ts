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
import { RedPacketRepo } from './db/repositories/redPacketRepo.js';
import { ChaosRepo } from './db/repositories/chaosRepo.js';
import { WorldEventRepo } from './db/repositories/worldEventRepo.js';
import { SocialPetRepo } from './db/repositories/socialPetRepo.js';
import { AiMemoryRepo } from './db/repositories/aiMemoryRepo.js';
import { BlackjackRepo } from './db/repositories/blackjackRepo.js';
import { DuelRepo } from './db/repositories/duelRepo.js';
import { MonitorRepo } from './db/repositories/monitorRepo.js';
import { LevelingService } from './services/levelingService.js';
import { EconomyService } from './services/economyService.js';
import { BlackjackManager } from './services/blackjackService.js';
import { ShopService } from './services/shopService.js';
import { FunService } from './services/funService.js';
import { TicketService } from './services/ticketService.js';
import { GiveawayService } from './services/giveawayService.js';
import { InviteService } from './services/inviteService.js';
import { RolePanelService } from './services/rolePanelService.js';
import { MultiplayerService } from './services/multiplayerService.js';
import { ChaosService } from './services/chaosService.js';
import { WorldEventService } from './services/worldEventService.js';
import { SocialPetService } from './services/socialPetService.js';
import { LlmClient } from './services/llmClient.js';
import { AiService } from './services/aiService.js';
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
  const redPacketRepo = new RedPacketRepo(db);
  const chaosRepo = new ChaosRepo(db);
  const worldEventRepo = new WorldEventRepo(db);
  const socialPetRepo = new SocialPetRepo(db);
  const aiMemoryRepo = new AiMemoryRepo(db);
  const blackjackRepo = new BlackjackRepo(db);
  const duelRepo = new DuelRepo(db);
  const monitorRepo = new MonitorRepo(db);
  const llmClient = new LlmClient(env.llm);

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
      redPacket: redPacketRepo,
      chaos: chaosRepo,
      worldEvent: worldEventRepo,
      socialPet: socialPetRepo,
      aiMemory: aiMemoryRepo,
      blackjack: blackjackRepo,
      duel: duelRepo,
      monitor: monitorRepo,
    },
    services: {
      leveling: new LevelingService(guildConfigRepo, profileRepo, inviteRepo),
      economy: new EconomyService(db, guildConfigRepo, profileRepo, env.timezone, chaosRepo),
      blackjack: new BlackjackManager(db, profileRepo),
      shop: new ShopService(db, profileRepo, shopRepo, {
        guildConfigRepo,
        chaosRepo,
        socialPetRepo,
        timezone: env.timezone,
      }),
      fun: new FunService(db, profileRepo, shopRepo, funRepo, env.timezone),
      ticket: new TicketService(guildConfigRepo, ticketRepo),
      giveaway: new GiveawayService(giveawayRepo),
      invite: new InviteService(inviteRepo),
      rolePanel: new RolePanelService(rolePanelRepo),
      multiplayer: new MultiplayerService(db, profileRepo, redPacketRepo, chaosRepo),
      chaos: new ChaosService(db, guildConfigRepo, profileRepo, chaosRepo),
      worldEvent: new WorldEventService(
        db,
        guildConfigRepo,
        profileRepo,
        worldEventRepo,
        socialPetRepo,
      ),
      socialPet: new SocialPetService(
        db,
        guildConfigRepo,
        profileRepo,
        shopRepo,
        socialPetRepo,
        env.timezone,
      ),
      ai: new AiService(guildConfigRepo, aiMemoryRepo, llmClient),
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

  client.on('error', (err) => {
    console.error('[discord:client_error]', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[process:unhandledRejection]', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[process:uncaughtException]', err);
  });

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
