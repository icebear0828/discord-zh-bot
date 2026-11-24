import { DiscordAPIError, MessageFlags, type Interaction } from 'discord.js';
import { commandMap } from '../commands/registry.js';
import {
  MonitorRepo,
  type InteractionKind,
  type InteractionLogStatus,
} from '../db/repositories/monitorRepo.js';
import { createErrorEmbed, type AppContext } from '../ui/embeds.js';
import { handleHelpSelect } from './helpHandler.js';
import { handleLeaderboardButton } from './leaderboardHandler.js';
import { handleBlackjackButton } from './blackjackHandler.js';
import { handleTicketButton, handleTicketModal } from './ticketHandler.js';
import { handleGiveawayButton } from './giveawayHandler.js';
import { handleRolePanelButton, handleRolePanelSelect } from './rolePanelHandler.js';
import {
  handleMenuButton,
  handleMenuChannelSelect,
  handleMenuModal,
  handleMenuRoleSelect,
  handleMenuStringSelect,
  handleMenuUserSelect,
} from './menuHandler.js';
import { handleMultiplayerButton } from './multiplayerHandler.js';
import { handleChaosButton, handleChaosModal } from './chaosHandler.js';
import {
  handleWorldEventButton,
  handleWorldEventModal,
  handleWorldEventStringSelect,
} from './worldEventHandler.js';
import { handleSocialPetButton } from './socialPetHandler.js';

import { extractDiscordErrorCode } from './menuHelpers.js';

const SLOW_INTERACTION_THRESHOLD_MS = 1500;

export function formatFriendlyError(err: unknown): string {
  const code = extractDiscordErrorCode(err);
  if (code === 50013) {
    return '机器人权限不足（50013），请检查 Bot 身份组权限与身份组顺序（需将 Bot 身份组拖到目标身份组上方）。';
  }
  if (code === 50001) {
    return '机器人缺少访问目标频道的权限（50001），请检查频道查看与发言权限设置。';
  }
  if (code === 10008 || code === 50027) {
    return '面板已超过 15 分钟有效期或原消息已被删除，请重新输入 `/菜单` 打开。';
  }
  if (code === 10062) {
    return '交互已超时失效（10062），请重试刚才的操作。';
  }
  if (code === 50035) {
    return '表单内容、参数长度或表情（Emoji）格式无效（50035），请检查后重新提交。';
  }
  return '执行操作时发生内部异常，请稍后再试或查看服务端日志。';
}

function getInteractionMeta(interaction: Interaction): {
  interactionType: InteractionKind;
  interactionKey: string;
} {
  if (interaction.isChatInputCommand()) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    const parts = [`/${interaction.commandName}`];
    if (group) parts.push(group);
    if (sub) parts.push(sub);
    return {
      interactionType: 'command',
      interactionKey: parts.join(' '),
    };
  }
  if (interaction.isButton()) {
    return { interactionType: 'button', interactionKey: interaction.customId };
  }
  if (interaction.isStringSelectMenu()) {
    return { interactionType: 'string_select', interactionKey: interaction.customId };
  }
  if (interaction.isUserSelectMenu()) {
    return { interactionType: 'user_select', interactionKey: interaction.customId };
  }
  if (interaction.isRoleSelectMenu()) {
    return { interactionType: 'role_select', interactionKey: interaction.customId };
  }
  if (interaction.isChannelSelectMenu()) {
    return { interactionType: 'channel_select', interactionKey: interaction.customId };
  }
  if (interaction.isModalSubmit()) {
    return { interactionType: 'modal', interactionKey: interaction.customId };
  }
  return { interactionType: 'other', interactionKey: 'unknown' };
}

function extractErrorDetails(err: unknown): {
  errorName: string;
  errorCode: string | null;
  errorMessage: string;
  errorStack: string | null;
} {
  if (err instanceof DiscordAPIError) {
    return {
      errorName: err.name || 'DiscordAPIError',
      errorCode: String(err.code),
      errorMessage: err.message,
      errorStack: err.stack ?? null,
    };
  }
  if (err instanceof Error) {
    const maybeCode = (err as { code?: unknown }).code;
    return {
      errorName: err.name || 'Error',
      errorCode:
        typeof maybeCode === 'string' || typeof maybeCode === 'number'
          ? String(maybeCode)
          : null,
      errorMessage: err.message,
      errorStack: err.stack ?? null,
    };
  }
  return {
    errorName: 'UnknownError',
    errorCode: null,
    errorMessage: String(err),
    errorStack: null,
  };
}

function recordInteractionTelemetry(
  ctx: AppContext,
  input: {
    guildId: string | null;
    channelId: string | null;
    userId: string;
    userTag: string;
    interactionType: InteractionKind;
    interactionKey: string;
    status: InteractionLogStatus;
    durationMs: number;
    errorName?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    errorStack?: string | null;
    createdAt: number;
  },
): void {
  const baseLine = `[interaction:${input.status}] type=${input.interactionType} key=${input.interactionKey} user=${input.userTag}(${input.userId}) guild=${input.guildId ?? 'dm'} channel=${input.channelId ?? '-'} duration=${input.durationMs}ms`;
  if (input.status === 'error') {
    console.error(
      `${baseLine} err=${input.errorName ?? 'Error'}${input.errorCode ? `(${input.errorCode})` : ''}: ${input.errorMessage ?? ''}`,
    );
    if (input.errorStack) {
      console.error(input.errorStack);
    }
  } else if (input.status === 'unhandled' || input.status === 'slow') {
    console.warn(`${baseLine}${input.errorMessage ? ` detail=${input.errorMessage}` : ''}`);
  } else {
    console.log(baseLine);
  }

  try {
    const repo = ctx.repos.monitor ?? new MonitorRepo(ctx.db);
    repo.record({
      guildId: input.guildId,
      channelId: input.channelId,
      userId: input.userId,
      userName: input.userTag,
      interactionType: input.interactionType,
      interactionKey: input.interactionKey,
      status: input.status,
      durationMs: input.durationMs,
      errorCode: input.errorCode ?? input.errorName ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt: input.createdAt,
    });
  } catch (dbErr) {
    console.error('[interaction:monitor_write_failed]', dbErr);
  }
}

export async function routeInteraction(
  interaction: Interaction,
  ctx: AppContext,
): Promise<void> {
  const startMs = Date.now();
  const { interactionType, interactionKey } = getInteractionMeta(interaction);
  const userTag =
    interaction.user?.username ?? interaction.user?.displayName ?? interaction.user?.id ?? 'unknown';
  const userId = interaction.user?.id ?? 'unknown';
  const guildId = interaction.guildId ?? null;
  const channelId = interaction.channelId ?? null;

  let acknowledgedByAction = false;
  const mutableInteraction = interaction as unknown as Record<string, unknown>;
  for (const methodName of ['reply', 'update', 'deferReply', 'deferUpdate', 'showModal'] as const) {
    const candidate = mutableInteraction[methodName];
    if (typeof candidate === 'function') {
      const orig = (candidate as (...args: unknown[]) => unknown).bind(interaction);
      mutableInteraction[methodName] = async (...args: unknown[]) => {
        acknowledgedByAction = true;
        return orig(...args);
      };
    }
  }

  try {
    const isDmAllowed =
      (interaction.isChatInputCommand() && interaction.commandName === 'help') ||
      (interaction.isStringSelectMenu() && interaction.customId.startsWith('help:'));

    if (!guildId && !isDmAllowed) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 仅限服务器内使用', '该功能仅限服务器内使用，请在 Discord 服务器频道中操作。')],
          flags: MessageFlags.Ephemeral,
        });
      }
    } else if (interaction.isChatInputCommand()) {
      const cmd = commandMap.get(interaction.commandName);
      if (!cmd) {
        await interaction.reply({
          embeds: [createErrorEmbed('❓ 未知指令', '找不到该指令的处理程序，请尝试重新同步斜杠命令。')],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await cmd.execute(interaction, ctx);
      }
    } else if (interaction.isButton()) {
      const prefix = interaction.customId.split(':')[0];
      if (prefix === 'lb') {
        await handleLeaderboardButton(interaction, ctx);
      } else if (prefix === 'bj') {
        await handleBlackjackButton(interaction, ctx);
      } else if (prefix === 'ticket') {
        await handleTicketButton(interaction, ctx);
      } else if (prefix === 'giveaway') {
        await handleGiveawayButton(interaction, ctx);
      } else if (prefix === 'rolepanel') {
        await handleRolePanelButton(interaction, ctx);
      } else if (prefix === 'menu') {
        await handleMenuButton(interaction, ctx);
      } else if (prefix === 'mp') {
        await handleMultiplayerButton(interaction, ctx);
      } else if (prefix === 'ch') {
        await handleChaosButton(interaction, ctx);
      } else if (prefix === 'ev') {
        await handleWorldEventButton(interaction, ctx);
      } else if (prefix === 'sp') {
        await handleSocialPetButton(interaction, ctx);
      }
    } else if (interaction.isStringSelectMenu()) {
      const prefix = interaction.customId.split(':')[0];
      if (prefix === 'help') {
        await handleHelpSelect(interaction);
      } else if (prefix === 'rolepanel') {
        await handleRolePanelSelect(interaction, ctx);
      } else if (prefix === 'menu') {
        await handleMenuStringSelect(interaction, ctx);
      } else if (prefix === 'ev') {
        await handleWorldEventStringSelect(interaction, ctx);
      }
    } else if (interaction.isUserSelectMenu()) {
      const prefix = interaction.customId.split(':')[0];
      if (prefix === 'menu') {
        await handleMenuUserSelect(interaction, ctx);
      }
    } else if (interaction.isRoleSelectMenu()) {
      const prefix = interaction.customId.split(':')[0];
      if (prefix === 'menu') {
        await handleMenuRoleSelect(interaction, ctx);
      }
    } else if (interaction.isChannelSelectMenu()) {
      const prefix = interaction.customId.split(':')[0];
      if (prefix === 'menu') {
        await handleMenuChannelSelect(interaction, ctx);
      }
    } else if (interaction.isModalSubmit()) {
      const prefix = interaction.customId.split(':')[0];
      if (interaction.customId === 'ticket:create') {
        await handleTicketModal(interaction, ctx);
      } else if (prefix === 'menu') {
        await handleMenuModal(interaction, ctx);
      } else if (prefix === 'ch') {
        await handleChaosModal(interaction, ctx);
      } else if (prefix === 'ev') {
        await handleWorldEventModal(interaction, ctx);
      }
    }

    const durationMs = Math.max(0, Date.now() - startMs);
    const acknowledged =
      acknowledgedByAction ||
      (interaction.isRepliable() && Boolean(interaction.replied || interaction.deferred));

    if (interaction.isRepliable() && !acknowledged) {
      await interaction
        .reply({
          embeds: [
            createErrorEmbed(
              '⚠️ 交互未响应',
              `该交互（\`${interactionKey}\`）未能完成响应（可能该面板已过期或参数失效），请重新打开 \`/菜单\` 再试。`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined);

      recordInteractionTelemetry(ctx, {
        guildId,
        channelId,
        userId,
        userTag,
        interactionType,
        interactionKey,
        status: 'unhandled',
        durationMs,
        errorName: 'UnhandledInteraction',
        errorMessage: 'Interaction handler returned without reply/update/showModal',
        createdAt: startMs,
      });
      return;
    }

    const status: InteractionLogStatus =
      durationMs >= SLOW_INTERACTION_THRESHOLD_MS ? 'slow' : 'ok';
    recordInteractionTelemetry(ctx, {
      guildId,
      channelId,
      userId,
      userTag,
      interactionType,
      interactionKey,
      status,
      durationMs,
      createdAt: startMs,
    });
  } catch (err) {
    const durationMs = Math.max(0, Date.now() - startMs);
    const details = extractErrorDetails(err);
    recordInteractionTelemetry(ctx, {
      guildId,
      channelId,
      userId,
      userTag,
      interactionType,
      interactionKey,
      status: 'error',
      durationMs,
      errorName: details.errorName,
      errorCode: details.errorCode,
      errorMessage: details.errorMessage,
      errorStack: details.errorStack,
      createdAt: startMs,
    });

    if (interaction.isRepliable()) {
      const embed = createErrorEmbed('⚠️ 操作失败', formatFriendlyError(err));
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => undefined);
      } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  }
}
