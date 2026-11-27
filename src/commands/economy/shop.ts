import type { ChatInputCommandInteraction } from 'discord.js';
import type { AppContext, CommandDefinition } from '../../core/context.js';
import { requireBotAdmin, requireGuildMember, requireModuleEnabled } from '../guards.js';
import { executeShopAdmin } from './shop/shopAdminExec.js';
import { buildShopSlashCommand } from './shop/shopSlashBuilder.js';
import { executeShopBuy, executeShopList } from './shop/shopUserExec.js';

export const shopCommand: CommandDefinition = {
  name: 'shop',
  data: buildShopSlashCommand(),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'list' || sub === 'buy') {
      if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;
    }

    if (sub === 'list') {
      await executeShopList(interaction, ctx, guildCtx.guildId);
      return;
    }

    if (sub === 'buy') {
      await executeShopBuy(interaction, ctx, guildCtx);
      return;
    }

    const adminCtx = await requireBotAdmin(interaction, ctx);
    if (!adminCtx) return;

    await executeShopAdmin(interaction, ctx, sub, adminCtx.guildId);
  },
};
