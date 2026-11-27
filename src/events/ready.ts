import { ActivityType, Events, type Client } from 'discord.js';
import type { AppContext } from '../core/context.js';
import { runGamesTick } from './timers/gamesSettlementTimer.js';
import { runOverdueLoanTick, runRedPacketTick } from './timers/redPacketAndLoanTimers.js';
import {
  runGiveawayTick,
  runMonitorPruneTick,
  runVoiceXpTick,
} from './timers/voiceAndGiveawayTimers.js';

export {
  buildLevelUpEmbed,
  sendLevelUpNotice,
  syncLevelRewardRoles,
} from './timers/levelUpNotifier.js';
export {
  runGiveawayTick,
  runMonitorPruneTick,
  runVoiceXpTick,
} from './timers/voiceAndGiveawayTimers.js';
export { runOverdueLoanTick, runRedPacketTick } from './timers/redPacketAndLoanTimers.js';
export { runGamesTick } from './timers/gamesSettlementTimer.js';

export interface BackgroundSchedulers {
  stop(): void;
}

const MONITOR_PRUNE_INTERVAL_MS = 60 * 60_000;

export function registerReadyEvent(client: Client, ctx: AppContext): BackgroundSchedulers {
  let voiceTimer: NodeJS.Timeout | null = null;
  let giveawayTimer: NodeJS.Timeout | null = null;
  let redPacketTimer: NodeJS.Timeout | null = null;
  let gamesTimer: NodeJS.Timeout | null = null;
  let overdueTimer: NodeJS.Timeout | null = null;
  let monitorPruneTimer: NodeJS.Timeout | null = null;
  let giveawayRunning = false;
  let redPacketRunning = false;
  let gamesRunning = false;
  let overdueRunning = false;

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(
      `[bot] 已登录为 ${readyClient.user.tag}，正在守护 ${readyClient.guilds.cache.size} 个服务器`,
    );
    readyClient.user.setActivity('输入 /菜单 开始游玩 | /帮助', { type: ActivityType.Watching });

    // Sync invite cache & migrate legacy AI persona configs into ai-packs for all guilds
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        ctx.services.ai.migrateLegacyGuildConfigToPacks(guild.id);
      } catch (err) {
        console.error(`[ai:migrate:${guild.id}]`, err);
      }
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
        // Missing ManageGuild permission on this guild — skip invite cache gracefully
      }
    }

    // Voice XP tick (every 60s)
    voiceTimer = setInterval(() => {
      runVoiceXpTick(readyClient, ctx);
    }, 60_000);

    // Giveaway due tick (every 10s, with overlap guard)
    giveawayTimer = setInterval(() => {
      if (giveawayRunning) return;
      giveawayRunning = true;
      void runGiveawayTick(readyClient, ctx).finally(() => {
        giveawayRunning = false;
      });
    }, 10_000);

    // Red packet expiration tick (every 15s, with overlap guard)
    redPacketTimer = setInterval(() => {
      if (redPacketRunning) return;
      redPacketRunning = true;
      void runRedPacketTick(readyClient, ctx).finally(() => {
        redPacketRunning = false;
      });
    }, 15_000);

    // Games & events tick (every 5s, with overlap guard)
    gamesTimer = setInterval(() => {
      if (gamesRunning) return;
      gamesRunning = true;
      void runGamesTick(readyClient, ctx).finally(() => {
        gamesRunning = false;
      });
    }, 5_000);

    // Overdue loan collection & public shaming tick (every 60s, with overlap guard)
    overdueTimer = setInterval(() => {
      if (overdueRunning) return;
      overdueRunning = true;
      void runOverdueLoanTick(readyClient, ctx).finally(() => {
        overdueRunning = false;
      });
    }, 60_000);

    // Low-frequency monitor log retention cleanup (every 1h)
    monitorPruneTimer = setInterval(() => {
      runMonitorPruneTick(ctx);
    }, MONITOR_PRUNE_INTERVAL_MS);
  });

  return {
    stop(): void {
      if (voiceTimer) clearInterval(voiceTimer);
      if (giveawayTimer) clearInterval(giveawayTimer);
      if (redPacketTimer) clearInterval(redPacketTimer);
      if (gamesTimer) clearInterval(gamesTimer);
      if (overdueTimer) clearInterval(overdueTimer);
      if (monitorPruneTimer) clearInterval(monitorPruneTimer);
      voiceTimer = null;
      giveawayTimer = null;
      redPacketTimer = null;
      gamesTimer = null;
      overdueTimer = null;
      monitorPruneTimer = null;
    },
  };
}
