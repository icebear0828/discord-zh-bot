import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type User,
  type UserSelectMenuInteraction,
} from 'discord.js';
import type { ModuleKey } from '../../../config/defaults.js';
import type { AppContext } from '../../../core/context.js';
import type { DiceChoice } from '../../../services/economyService.js';
import type { InteractionAction } from '../../../services/funService.js';
import type { LeaderboardType } from '../../../services/levelingService.js';
import { buildMenuMessage, truncateText } from '../../../ui/menuBuilder.js';
import type { BuiltMenuMessage, MenuActor, MenuFeedback, MenuView } from '../../../ui/menuShared.js';
import { respondFromModal, safeEditOrFollowUp } from '../../menuHelpers.js';

export interface MenuButtonContext {
  interaction: ButtonInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: string[];
}

export interface MenuStringSelectContext {
  interaction: StringSelectMenuInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: string[];
  selected: string | undefined;
}

export interface MenuUserSelectContext {
  interaction: UserSelectMenuInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: string[];
  actionType: string | undefined;
  targetId: string;
  targetUser: User | undefined;
}

export interface MenuModalContext {
  interaction: ModalSubmitInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: string[];
  modalType: string | undefined;
}

export interface ActionWithHighlight {
  msg: BuiltMenuMessage;
  highlight?: MessageCreateOptions;
}

export const VALID_SOCIAL_ACTIONS: ReadonlySet<string> = new Set([
  'pat',
  'hug',
  'cuddle',
  'poke',
  'feed',
  'snowball',
]);

export const VALID_MODULE_KEYS: ReadonlySet<string> = new Set<ModuleKey>([
  'leveling',
  'economy',
  'fun',
  'welcome',
  'tickets',
  'giveaways',
  'invites',
  'rolePanels',
  'socialGames',
  'worldEvents',
  'petsAndCp',
  'ai',
  'imageGen',
  'creditLoan',
  'rpg',
]);

export const LEADERBOARD_MODULE_MAP: Record<LeaderboardType, { key: ModuleKey; name: string }> = {
  xp: { key: 'leveling', name: '等级与热度' },
  coins: { key: 'economy', name: '经济系统' },
  invites: { key: 'invites', name: '邀请追踪' },
  stat: { key: 'leveling', name: '等级与热度' },
  credit: { key: 'creditLoan', name: '征信与借贷' },
  deadbeat: { key: 'creditLoan', name: '征信与借贷' },
  hustle: { key: 'creditLoan', name: '征信与借贷' },
  gambling_profit: { key: 'creditLoan', name: '征信与借贷' },
  gambling_loss: { key: 'creditLoan', name: '征信与借贷' },
  rpg: { key: 'rpg', name: '奇幻RPG地牢' },
};

export function parseDiceChoice(raw: string | undefined): DiceChoice {
  if (raw === 'small' || raw === 'triple') return raw;
  return 'big';
}

export function parseSocialAction(raw: string | undefined): InteractionAction {
  if (raw && VALID_SOCIAL_ACTIONS.has(raw)) {
    return raw as InteractionAction;
  }
  return 'pat';
}

export function parseLeaderboardType(raw: string | undefined): LeaderboardType {
  if (
    raw === 'coins' ||
    raw === 'invites' ||
    raw === 'stat' ||
    raw === 'credit' ||
    raw === 'deadbeat' ||
    raw === 'hustle' ||
    raw === 'gambling_profit' ||
    raw === 'gambling_loss' ||
    raw === 'rpg'
  ) {
    return raw;
  }
  return 'xp';
}

export function buildAmountModal(
  customId: string,
  title: string,
  label: string,
  placeholder: string,
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(truncateText(label, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setPlaceholder(placeholder)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(truncateText(title, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export function buildRedPacketModal(currencyName: string): ModalBuilder {
  const totalAmount = new TextInputBuilder()
    .setCustomId('totalAmount')
    .setLabel(truncateText(`红包总金额（1 ~ 1,000,000,000 ${currencyName}）`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setPlaceholder('例如：50000')
    .setRequired(true);

  const totalCount = new TextInputBuilder()
    .setCustomId('totalCount')
    .setLabel('红包份数（2 ~ 100 份）')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(4)
    .setPlaceholder('例如：5')
    .setRequired(true);

  const greeting = new TextInputBuilder()
    .setCustomId('greeting')
    .setLabel('红包祝福语（可选）')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(50)
    .setPlaceholder('恭喜发财，大吉大利！')
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:redpacket')
    .setTitle('🧧 发拼手气红包')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(totalAmount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(totalCount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(greeting),
    );
}

export function buildAdminRedPacketModal(
  customId: string,
  title: string,
  minCount: number,
  currencyName: string,
): ModalBuilder {
  const totalAmount = new TextInputBuilder()
    .setCustomId('totalAmount')
    .setLabel(truncateText(`红包总金额（1 ~ 1,000,000,000 ${currencyName}）`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setPlaceholder('例如：5000000')
    .setRequired(true);

  const totalCount = new TextInputBuilder()
    .setCustomId('totalCount')
    .setLabel(truncateText(`红包份数（${minCount} ~ 100 份）`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(4)
    .setPlaceholder('例如：10')
    .setRequired(true);

  const greeting = new TextInputBuilder()
    .setCustomId('greeting')
    .setLabel('红包祝福语（可选）')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(50)
    .setPlaceholder('管理员天降大红包，见者有份！')
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(truncateText(title, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(totalAmount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(totalCount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(greeting),
    );
}

export function buildCustomTitleModal(customId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('✍️ 兑换自定义专属称号')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('titleText')
          .setLabel('输入你的专属称号（1 ~ 20 字）')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(20)
          .setPlaceholder('例如：全服第一大冤种')
          .setRequired(true),
      ),
    );
}

export async function deferModalForWrite(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
}

export function readOptionalModalField(
  interaction: ModalSubmitInteraction,
  customId: string,
): string {
  try {
    return interaction.fields.getTextInputValue(customId).trim();
  } catch {
    return '';
  }
}

export async function replyModalPage(
  input: MenuModalContext,
  view: MenuView,
  feedback?: MenuFeedback,
): Promise<void> {
  await respondFromModal(
    input.interaction,
    buildMenuMessage(input.ctx, input.guildId, input.actor, view, feedback),
  );
}

export async function editModalPage(
  input: MenuModalContext,
  view: MenuView,
  feedback?: MenuFeedback,
): Promise<void> {
  await safeEditOrFollowUp(
    input.interaction,
    buildMenuMessage(input.ctx, input.guildId, input.actor, view, feedback),
  );
}

export async function updateButtonPage(
  input: MenuButtonContext,
  view: MenuView,
  feedback?: MenuFeedback,
): Promise<void> {
  await input.interaction.update(
    buildMenuMessage(input.ctx, input.guildId, input.actor, view, feedback),
  );
}
