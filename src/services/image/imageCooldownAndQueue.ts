import type { GuildConfig } from '../../config/defaults.js';
import type {
  ImageQueueSnapshot,
  ImageServiceErrorCode,
  QueuedImageJob,
} from './imageTypes.js';

export type ImageGateCheckResult =
  | { ok: true }
  | {
      ok: false;
      errorCode: ImageServiceErrorCode;
      errorMessage: string;
      retryAfterSec?: number;
    };

export class ImageCooldownAndQueue {
  private readonly userLastRunAt = new Map<string, number>();
  private readonly selfieLastRunAt = new Map<string, number>();
  private readonly queue: QueuedImageJob[] = [];
  private activeCount = 0;

  getQueueSnapshot(): ImageQueueSnapshot {
    return { running: this.activeCount, pending: this.queue.length };
  }

  getUserCooldownRemainingSec(
    guildId: string,
    userId: string,
    cooldownSec: number,
    isAdmin = false,
    nowMs = Date.now(),
  ): number {
    if (isAdmin) return 0;
    const cooldownMs = Math.max(0, cooldownSec * 1000);
    if (cooldownMs <= 0) return 0;
    const prev = this.userLastRunAt.get(`${guildId}:${userId}`);
    if (prev === undefined) return 0;
    const remainingMs = cooldownMs - (nowMs - prev);
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  checkChannelAllowed(cfg: GuildConfig, channelId: string): ImageGateCheckResult {
    if (!cfg.modules.imageGen) {
      return {
        ok: false,
        errorCode: 'module_disabled',
        errorMessage: '当前服务器已关闭 **AI 绘图** 模块，请联系管理员开启。',
      };
    }
    if (cfg.imageGen.ignoredChannelIds.includes(channelId)) {
      return {
        ok: false,
        errorCode: 'channel_ignored',
        errorMessage: '当前频道已被管理员设置为禁用 AI 生图。',
      };
    }
    if (
      cfg.imageGen.allowedChannelIds.length > 0 &&
      !cfg.imageGen.allowedChannelIds.includes(channelId)
    ) {
      const allowedList = cfg.imageGen.allowedChannelIds.map((id) => `<#${id}>`).join('、');
      return {
        ok: false,
        errorCode: 'channel_not_allowed',
        errorMessage: `当前频道未开放 AI 生图，请前往指定频道使用：${allowedList}`,
      };
    }
    return { ok: true };
  }

  checkDrawCooldown(
    cooldownKey: string,
    cooldownSec: number,
    isAdmin: boolean,
    nowMs = Date.now(),
  ): ImageGateCheckResult & { prevTimestamp?: number } {
    const cooldownMs = Math.max(0, cooldownSec * 1000);
    const prevTimestamp = this.userLastRunAt.get(cooldownKey);

    if (!isAdmin && cooldownMs > 0 && prevTimestamp !== undefined) {
      const elapsed = nowMs - prevTimestamp;
      if (elapsed < cooldownMs) {
        const retryAfterSec = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
        return {
          ok: false,
          errorCode: 'cooldown',
          retryAfterSec,
          errorMessage: `画师还在喘气中，请等待 **${retryAfterSec} 秒**后再试。`,
        };
      }
    }
    return { ok: true, prevTimestamp };
  }

  checkSelfieCooldown(
    cooldownKey: string,
    cooldownSec: number,
    isAdmin: boolean,
    nowMs = Date.now(),
  ): ImageGateCheckResult & { prevTimestamp?: number } {
    const cooldownMs = Math.max(0, cooldownSec * 1000);
    const prevTimestamp = this.selfieLastRunAt.get(cooldownKey);

    if (!isAdmin && cooldownMs > 0 && prevTimestamp !== undefined) {
      const elapsed = nowMs - prevTimestamp;
      if (elapsed < cooldownMs) {
        const retryAfterSec = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
        return {
          ok: false,
          errorCode: 'cooldown',
          retryAfterSec,
          errorMessage: `相机刚拍完还在冷却中，请等待 **${retryAfterSec} 秒**后再拍。`,
        };
      }
    }
    return { ok: true, prevTimestamp };
  }

  checkQueueCapacity(maxConcurrencyRaw: number, maxPendingRaw: number): ImageGateCheckResult {
    const maxConcurrency = Math.max(1, Math.min(5, maxConcurrencyRaw));
    const maxPending = Math.max(1, Math.min(20, maxPendingRaw));
    if (this.activeCount >= maxConcurrency && this.queue.length >= maxPending) {
      return {
        ok: false,
        errorCode: 'queue_full',
        errorMessage: `当前生图排队已满（正在生成 ${this.activeCount} 张 / 排队 ${this.queue.length} 张），请稍后再试。`,
      };
    }
    return { ok: true };
  }

  recordDrawRun(cooldownKey: string, nowMs: number, maxCooldownMs: number): void {
    if (this.userLastRunAt.size > 1000) {
      for (const [key, ts] of this.userLastRunAt.entries()) {
        if (nowMs - ts >= maxCooldownMs) {
          this.userLastRunAt.delete(key);
        }
      }
    }
    this.userLastRunAt.set(cooldownKey, nowMs);
  }

  rollbackDrawCooldown(
    cooldownKey: string,
    runTimestamp: number,
    prevTimestamp: number | undefined,
  ): void {
    if (this.userLastRunAt.get(cooldownKey) === runTimestamp) {
      if (prevTimestamp !== undefined) {
        this.userLastRunAt.set(cooldownKey, prevTimestamp);
      } else {
        this.userLastRunAt.delete(cooldownKey);
      }
    }
  }

  recordSelfieRun(cooldownKey: string, nowMs: number, maxCooldownMs: number): void {
    if (this.selfieLastRunAt.size > 1000) {
      for (const [key, ts] of this.selfieLastRunAt.entries()) {
        if (nowMs - ts >= maxCooldownMs) {
          this.selfieLastRunAt.delete(key);
        }
      }
    }
    this.selfieLastRunAt.set(cooldownKey, nowMs);
  }

  rollbackSelfieCooldown(
    cooldownKey: string,
    runTimestamp: number,
    prevTimestamp: number | undefined,
  ): void {
    if (this.selfieLastRunAt.get(cooldownKey) === runTimestamp) {
      if (prevTimestamp !== undefined) {
        this.selfieLastRunAt.set(cooldownKey, prevTimestamp);
      } else {
        this.selfieLastRunAt.delete(cooldownKey);
      }
    }
  }

  enqueue(maxConcurrency: number, run: () => Promise<void>): void {
    this.queue.push({ run });
    this.drainQueue(maxConcurrency);
  }

  private drainQueue(maxConcurrency: number): void {
    const limit = Math.max(1, Math.min(5, Math.floor(maxConcurrency)));
    while (this.activeCount < limit && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) continue;
      this.activeCount++;
      void next.run().finally(() => {
        this.activeCount = Math.max(0, this.activeCount - 1);
        const latestLimit = Math.max(1, Math.min(5, Math.floor(maxConcurrency)));
        this.drainQueue(latestLimit);
      });
    }
  }
}
