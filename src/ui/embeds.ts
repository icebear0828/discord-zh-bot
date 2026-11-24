import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
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
import type { MonitorRepo } from '../db/repositories/monitorRepo.js';
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
    monitor?: MonitorRepo;
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
  };
}

export interface CommandDefinition {
  name: string;
  data: {
    toJSON(): unknown;
  };
  execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void>;
}

export const COLORS = {
  PRIMARY: 0x5865f2,
  SUCCESS: 0x57f287,
  WARNING: 0xfee75c,
  ERROR: 0xed4245,
  GOLD: 0xf1c40f,
  FUN: 0xeb459e,
} as const;

export function renderProgressBar(ratio: number, width = 12): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export function formatDurationZh(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (mins > 0) parts.push(`${mins}分钟`);
  if (parts.length === 0 || secs > 0) parts.push(`${secs}秒`);
  return parts.join('');
}

export function createInfoEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle(title).setTimestamp();
  if (description) {
    embed.setDescription(description);
  }
  return embed;
}

export function createSuccessEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle(title).setTimestamp();
  if (description) {
    embed.setDescription(description);
  }
  return embed;
}

export function createErrorEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLORS.ERROR).setTitle(title).setTimestamp();
  if (description) {
    embed.setDescription(description);
  }
  return embed;
}
