import type { ChatInputCommandInteraction } from 'discord.js';
import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { ShopRepo } from '../db/repositories/shopRepo.js';
import type { FunRepo } from '../db/repositories/funRepo.js';
import type { TicketRepo } from '../db/repositories/ticketRepo.js';
import type { GiveawayRepo } from '../db/repositories/giveawayRepo.js';
import type { InviteRepo } from '../db/repositories/inviteRepo.js';
import type { RolePanelRepo } from '../db/repositories/rolePanelRepo.js';
import type { RedPacketRepo } from '../db/repositories/redPacketRepo.js';
import type { ChaosRepo } from '../db/repositories/chaosRepo.js';
import type { WorldEventRepo } from '../db/repositories/worldEventRepo.js';
import type { SocialPetRepo } from '../db/repositories/socialPetRepo.js';
import type { AiMemoryRepo } from '../db/repositories/aiMemoryRepo.js';
import type { BlackjackRepo } from '../db/repositories/blackjackRepo.js';
import type { CreditLoanRepo } from '../db/repositories/creditLoanRepo.js';
import type { DuelRepo } from '../db/repositories/duelRepo.js';
import type { ImageRepo } from '../db/repositories/imageRepo.js';
import type { MonitorRepo } from '../db/repositories/monitorRepo.js';
import type { RpgRepo } from '../db/repositories/rpgRepo.js';
import type { LevelingService } from '../services/levelingService.js';
import type { EconomyService } from '../services/economyService.js';
import type { BlackjackManager } from '../services/blackjackService.js';
import type { ShopService } from '../services/shopService.js';
import type { FunService } from '../services/funService.js';
import type { TicketService } from '../services/ticketService.js';
import type { GiveawayService } from '../services/giveawayService.js';
import type { InviteService } from '../services/inviteService.js';
import type { RolePanelService } from '../services/rolePanelService.js';
import type { MultiplayerService } from '../services/multiplayerService.js';
import type { ChaosService } from '../services/chaosService.js';
import type { WorldEventService } from '../services/worldEventService.js';
import type { SocialPetService } from '../services/socialPetService.js';
import type { AiService } from '../services/aiService.js';
import type { ImageService } from '../services/imageService.js';
import type { CreditLoanService } from '../services/creditLoanService.js';
import type { DuelArenaService } from '../services/duelArenaService.js';
import type { RpgService } from '../services/rpgService.js';

/**
 * Shared application dependency container passed across commands, events, and interaction handlers.
 */
export interface AppContext {
  db: Database.Database;
  timezone: string;
  repos: {
    guildConfig: GuildConfigRepo;
    profile: ProfileRepo;
    shop: ShopRepo;
    fun: FunRepo;
    ticket: TicketRepo;
    giveaway: GiveawayRepo;
    invite: InviteRepo;
    rolePanel: RolePanelRepo;
    redPacket: RedPacketRepo;
    chaos: ChaosRepo;
    worldEvent: WorldEventRepo;
    socialPet: SocialPetRepo;
    aiMemory: AiMemoryRepo;
    creditLoan: CreditLoanRepo;
    rpg: RpgRepo;
    blackjack?: BlackjackRepo;
    duel?: DuelRepo;
    monitor?: MonitorRepo;
    image?: ImageRepo;
  };
  services: {
    leveling: LevelingService;
    economy: EconomyService;
    blackjack: BlackjackManager;
    shop: ShopService;
    fun: FunService;
    ticket: TicketService;
    giveaway: GiveawayService;
    invite: InviteService;
    rolePanel: RolePanelService;
    multiplayer: MultiplayerService;
    chaos: ChaosService;
    worldEvent: WorldEventService;
    socialPet: SocialPetService;
    ai: AiService;
    image?: ImageService;
    creditLoan: CreditLoanService;
    rpg: RpgService;
    duelArena?: DuelArenaService;
  };
}

/**
 * Slash command registration and execution contract.
 */
export interface CommandDefinition {
  name: string;
  data: {
    toJSON(): unknown;
  };
  execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void>;
}
