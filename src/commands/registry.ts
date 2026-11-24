import type { CommandDefinition } from '../ui/embeds.js';
import { helpCommand } from './general/help.js';
import { menuCommand } from './general/menu.js';
import { configCommand } from './general/config.js';
import { rankCommand } from './leveling/rank.js';
import { leaderboardCommand } from './leveling/leaderboard.js';
import { levelAdminCommand } from './leveling/levelAdmin.js';
import { dailyCommand } from './economy/daily.js';
import { workCommand } from './economy/work.js';
import { robCommand } from './economy/rob.js';
import { balanceCommand } from './economy/balance.js';
import { payCommand } from './economy/pay.js';
import { diceCommand } from './economy/dice.js';
import { slotsCommand } from './economy/slots.js';
import { blackjackCommand } from './economy/blackjack.js';
import { shopCommand } from './economy/shop.js';
import { inventoryCommand } from './economy/inventory.js';
import { creditCommand } from './economy/credit.js';
import { loanCommand } from './economy/loan.js';
import { hustleCommand } from './economy/hustle.js';
import { fortuneCommand } from './fun/fortune.js';
import { interactCommand } from './fun/interact.js';
import { titleCommand } from './fun/title.js';
import { adventureCommand } from './fun/adventure.js';
import { welcomeConfigCommand } from './welcome/welcomeConfig.js';
import { ticketConfigCommand } from './tickets/ticketConfig.js';
import { ticketCommand } from './tickets/ticket.js';
import { giveawayCommand } from './giveaways/giveaway.js';
import { invitesCommand } from './invites/invites.js';
import { rolePanelCommand } from './roles/rolePanel.js';
import { aiCommand } from './ai/ai.js';

export const commands: readonly CommandDefinition[] = [
  helpCommand,
  menuCommand,
  configCommand,
  rankCommand,
  leaderboardCommand,
  levelAdminCommand,
  dailyCommand,
  workCommand,
  robCommand,
  balanceCommand,
  payCommand,
  diceCommand,
  slotsCommand,
  blackjackCommand,
  shopCommand,
  inventoryCommand,
  creditCommand,
  loanCommand,
  hustleCommand,
  fortuneCommand,
  interactCommand,
  titleCommand,
  adventureCommand,
  welcomeConfigCommand,
  ticketConfigCommand,
  ticketCommand,
  giveawayCommand,
  invitesCommand,
  rolePanelCommand,
  aiCommand,
];

export const commandMap: ReadonlyMap<string, CommandDefinition> = new Map(
  commands.map((cmd) => [cmd.name, cmd]),
);
