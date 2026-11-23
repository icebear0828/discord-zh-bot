import { DiscordAPIError, MessageFlags, type Interaction } from 'discord.js';
import { commandMap } from '../commands/registry.js';
import { createErrorEmbed, type AppContext } from '../ui/embeds.js';
import { handleHelpSelect } from './helpHandler.js';
import { handleLeaderboardButton } from './leaderboardHandler.js';
import { handleBlackjackButton } from './blackjackHandler.js';
import { handleTicketButton, handleTicketModal } from './ticketHandler.js';
import { handleGiveawayButton } from './giveawayHandler.js';
import { handleRolePanelButton, handleRolePanelSelect } from './rolePanelHandler.js';
import {
  handleMenuButton,
  handleMenuModal,
  handleMenuStringSelect,
  handleMenuUserSelect,
} from './menuHandler.js';
import { handleMultiplayerButton } from './multiplayerHandler.js';

function formatFriendlyError(err: unknown): string {
  if (err instanceof DiscordAPIError && err.code === 50013) {
    return '机器人权限不足（50013），请检查 Bot 身份组权限与身份组顺序。';
  }
  return '执行操作时发生内部异常，请稍后再试或查看服务端日志。';
}

export async function routeInteraction(
  interaction: Interaction,
  ctx: AppContext,
): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = commandMap.get(interaction.commandName);
      if (!cmd) {
        await interaction.reply({
          embeds: [createErrorEmbed('❓ 未知指令', '找不到该指令的处理程序，请尝试重新同步斜杠命令。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await cmd.execute(interaction, ctx);
      return;
    }

    if (interaction.isButton()) {
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
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const prefix = interaction.customId.split(':')[0];
      if (prefix === 'help') {
        await handleHelpSelect(interaction);
      } else if (prefix === 'rolepanel') {
        await handleRolePanelSelect(interaction, ctx);
      } else if (prefix === 'menu') {
        await handleMenuStringSelect(interaction, ctx);
      }
      return;
    }

    if (interaction.isUserSelectMenu()) {
      const prefix = interaction.customId.split(':')[0];
      if (prefix === 'menu') {
        await handleMenuUserSelect(interaction, ctx);
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const prefix = interaction.customId.split(':')[0];
      if (interaction.customId === 'ticket:create') {
        await handleTicketModal(interaction, ctx);
      } else if (prefix === 'menu') {
        await handleMenuModal(interaction, ctx);
      }
    }
  } catch (err) {
    console.error('[interaction] 处理交互失败:', err);
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
