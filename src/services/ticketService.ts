import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { TicketRecord, TicketRepo } from '../db/repositories/ticketRepo.js';

export type ReserveTicketSlotResult =
  | { ok: true; ticketNumber: number; reservationId: number }
  | { ok: false; openCount: number; maxOpen: number };

export class TicketService {
  private readonly pendingByUser = new Map<string, Set<number>>();
  private nextReservationId = 1;

  constructor(
    private readonly configRepo: GuildConfigRepo,
    private readonly ticketRepo: TicketRepo,
    private readonly db?: Database.Database,
  ) {}

  private reservationKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  private getPendingCount(guildId: string, userId: string): number {
    return this.pendingByUser.get(this.reservationKey(guildId, userId))?.size ?? 0;
  }

  canOpenTicket(
    guildId: string,
    userId: string,
  ): { allowed: boolean; openCount: number; maxOpen: number } {
    const cfg = this.configRepo.getOrCreate(guildId).ticket;
    const openCount =
      this.ticketRepo.countOpenByCreator(guildId, userId) + this.getPendingCount(guildId, userId);
    return {
      allowed: openCount < cfg.maxOpenPerUser,
      openCount,
      maxOpen: cfg.maxOpenPerUser,
    };
  }

  /**
   * Atomically verify user ticket quota (including in-flight creations) and allocate the next
   * ticket number before performing async Discord channel creation.
   */
  reserveTicketSlot(
    guildId: string,
    userId: string,
    dbOverride?: Database.Database,
  ): ReserveTicketSlotResult {
    const activeDb = dbOverride ?? this.db;
    const run = (): ReserveTicketSlotResult => {
      const cfg = this.configRepo.getOrCreate(guildId).ticket;
      const openCount =
        this.ticketRepo.countOpenByCreator(guildId, userId) + this.getPendingCount(guildId, userId);
      if (openCount >= cfg.maxOpenPerUser) {
        return {
          ok: false,
          openCount,
          maxOpen: cfg.maxOpenPerUser,
        };
      }

      const ticketNumber = this.configRepo.incrementTicketCounter(guildId);
      const reservationId = this.nextReservationId++;
      const key = this.reservationKey(guildId, userId);
      let set = this.pendingByUser.get(key);
      if (!set) {
        set = new Set<number>();
        this.pendingByUser.set(key, set);
      }
      set.add(reservationId);
      return { ok: true, ticketNumber, reservationId };
    };

    return activeDb ? activeDb.transaction(run)() : run();
  }

  releaseReservation(guildId: string, userId: string, reservationId: number): void {
    const key = this.reservationKey(guildId, userId);
    const set = this.pendingByUser.get(key);
    if (!set) return;
    set.delete(reservationId);
    if (set.size === 0) {
      this.pendingByUser.delete(key);
    }
  }

  finalizeReservedTicket(
    input: {
      guildId: string;
      channelId: string;
      creatorId: string;
      subject: string;
      ticketNumber: number;
      reservationId: number;
      nowMs?: number;
    },
    dbOverride?: Database.Database,
  ): TicketRecord {
    const activeDb = dbOverride ?? this.db;
    const run = (): TicketRecord => {
      const record = this.ticketRepo.create({
        guildId: input.guildId,
        channelId: input.channelId,
        ticketNumber: input.ticketNumber,
        creatorId: input.creatorId,
        subject: input.subject,
        createdAt: input.nowMs ?? Date.now(),
      });
      this.releaseReservation(input.guildId, input.creatorId, input.reservationId);
      return record;
    };

    return activeDb ? activeDb.transaction(run)() : run();
  }

  rollbackTicket(
    guildId: string,
    creatorId: string,
    channelId: string | null,
    reservationId: number,
    dbOverride?: Database.Database,
  ): void {
    const activeDb = dbOverride ?? this.db;
    const run = (): void => {
      this.releaseReservation(guildId, creatorId, reservationId);
      if (!channelId) return;
      if (activeDb) {
        activeDb.prepare('DELETE FROM tickets WHERE channel_id = ?').run(channelId);
      } else {
        this.ticketRepo.close(channelId, 'system:rollback', Date.now());
      }
    };

    if (activeDb) {
      activeDb.transaction(run)();
    } else {
      run();
    }
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
