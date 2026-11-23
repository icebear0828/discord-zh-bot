import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { TicketRecord, TicketRepo } from '../db/repositories/ticketRepo.js';

export class TicketService {
  constructor(
    private readonly configRepo: GuildConfigRepo,
    private readonly ticketRepo: TicketRepo,
  ) {}

  canOpenTicket(
    guildId: string,
    userId: string,
  ): { allowed: boolean; openCount: number; maxOpen: number } {
    const cfg = this.configRepo.getOrCreate(guildId).ticket;
    const openCount = this.ticketRepo.countOpenByCreator(guildId, userId);
    return {
      allowed: openCount < cfg.maxOpenPerUser,
      openCount,
      maxOpen: cfg.maxOpenPerUser,
    };
  }

  createTicket(
    guildId: string,
    channelId: string,
    creatorId: string,
    subject: string,
    nowMs = Date.now(),
  ): TicketRecord {
    const ticketNumber = this.configRepo.incrementTicketCounter(guildId);
    return this.ticketRepo.create({
      guildId,
      channelId,
      ticketNumber,
      creatorId,
      subject,
      createdAt: nowMs,
    });
  }

  getByChannel(channelId: string): TicketRecord | null {
    return this.ticketRepo.getByChannel(channelId);
  }

  closeTicket(channelId: string, closedBy: string, nowMs = Date.now()): TicketRecord | null {
    return this.ticketRepo.close(channelId, closedBy, nowMs);
  }
}
