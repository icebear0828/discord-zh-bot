import type { AppContext } from '../core/context.js';
import {
  buildAdminLvlRewardsView,
  buildAdminMonitorView,
  buildAdminRolesView,
  buildAdminShopView,
  buildSelfRolesView,
} from './adminConfigMenuBuilder.js';
import { buildAdminAiView } from './aiAdminMenuBuilder.js';
import {
  buildBombView,
  buildBountyView,
  buildPropsView,
  buildRouletteView,
} from './chaosMenuBuilder.js';
import {
  buildCreditView,
  buildHustleView,
  buildLoanView,
} from './creditLoanMenuBuilder.js';
import { buildDuelLobbyView } from './duelArenaBuilder.js';
import {
  buildAdminImageView,
  buildUserImageMenuView,
} from './imageMenuBuilder.js';
import {
  buildAdminCreditRpgView,
  buildAdminEconView,
  buildAdminGamesView,
  buildAdminLvlView,
  buildAdminModView,
  buildAdminOpsView,
  buildAdminOverviewView,
} from './menu/adminOverviewAndSubViews.js';
import {
  SOCIAL_ACTIONS,
  buildBankView,
  buildMultiView,
  buildPayView,
  buildRobView,
  buildSocialView,
} from './menu/bankAndMultiViews.js';
import {
  buildDuelMessage,
  buildRedPacketMessage,
} from './menu/duelAndRedPacketCards.js';
import {
  buildHomeView,
  buildLobbyMessage,
} from './menu/lobbyAndHomeViews.js';
import {
  buildLeaderboardView,
  buildPublicLeaderboardEmbed,
  buildPublicRankEmbed,
  buildRankView,
} from './menu/rankAndLeaderboardViews.js';
import {
  buildBagView,
  buildShopView,
} from './menu/shopAndBagViews.js';
import {
  buildBlackjackView,
  buildDiceView,
  buildSlotsView,
  buildSoloView,
} from './menu/soloAndGambleViews.js';
import {
  truncateText,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
  type MenuView,
} from './menuShared.js';
import { buildRpgHomeView } from './rpgMenuBuilder.js';
import {
  buildCpLeaderboardView,
  buildCpView,
  buildPetArenaView,
  buildPetsView,
  buildSocialHubView,
} from './socialPetMenuBuilder.js';
import {
  buildEventsHubView,
  buildPredDetailView,
  buildPredictionsListView,
  buildWorldStatusView,
} from './worldEventMenuBuilder.js';

export {
  SOCIAL_ACTIONS,
  buildDuelMessage,
  buildLobbyMessage,
  buildPublicLeaderboardEmbed,
  buildPublicRankEmbed,
  buildRedPacketMessage,
  truncateText,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
  type MenuView,
};

export type MenuViewBuilder = (
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  view: MenuView,
  feedback: MenuFeedback | undefined,
  nowMs: number,
) => BuiltMenuMessage;

function forPage<P extends MenuView['page']>(
  page: P,
  render: (
    ctx: AppContext,
    guildId: string,
    actor: MenuActor,
    view: Extract<MenuView, { page: P }>,
    feedback: MenuFeedback | undefined,
    nowMs: number,
  ) => BuiltMenuMessage,
): MenuViewBuilder {
  return (ctx, guildId, actor, view, feedback, nowMs) => {
    if (view.page !== page) {
      throw new Error(`Mismatched MenuView page: expected ${page}, got ${view.page}`);
    }
    return render(ctx, guildId, actor, view as Extract<MenuView, { page: P }>, feedback, nowMs);
  };
}

export const MENU_VIEW_BUILDERS: Record<MenuView['page'], MenuViewBuilder> = {
  home: forPage('home', (ctx, g, a, _v, fb, now) => buildHomeView(ctx, g, a, fb, now)),
  solo: forPage('solo', (ctx, g, a, _v, fb, now) => buildSoloView(ctx, g, a, fb, now)),
  slots: forPage('slots', (ctx, g, a, _v, fb) => buildSlotsView(ctx, g, a, fb)),
  dice: forPage('dice', (ctx, g, a, v, fb) => buildDiceView(ctx, g, a, v.choice, fb)),
  bj: forPage('bj', (ctx, g, a, v, fb) => buildBlackjackView(ctx, g, a, v, fb)),
  bank: forPage('bank', (ctx, g, a, _v, fb, now) => buildBankView(ctx, g, a, fb, now)),
  credit: forPage('credit', (ctx, g, a, _v, fb, now) => buildCreditView(ctx, g, a, fb, now)),
  loan: forPage('loan', (ctx, g, a, _v, fb, now) => buildLoanView(ctx, g, a, fb, now)),
  hustle: forPage('hustle', (ctx, g, a, _v, fb, now) => buildHustleView(ctx, g, a, fb, now)),
  rpg: forPage('rpg', (ctx, g, a, _v, fb, now) => buildRpgHomeView(ctx, g, a, fb, now)),
  image: forPage('image', (ctx, g, a, v, fb) => buildUserImageMenuView(ctx, g, a, v.ratio, fb)),
  multi: forPage('multi', (ctx, g, a, _v, fb, now) => buildMultiView(ctx, g, a, fb, now)),
  rob: forPage('rob', (ctx, g, a, _v, fb, now) => buildRobView(ctx, g, a, fb, now)),
  pay: forPage('pay', (ctx, g, a, _v, fb) => buildPayView(ctx, g, a, fb)),
  duel: forPage('duel', (ctx, g, a, _v, fb, now) => buildDuelLobbyView(ctx, g, a, fb, now)),
  social: forPage('social', (_ctx, _g, a, v, fb) => buildSocialView(a, v.action, fb)),
  props: forPage('props', (ctx, g, a, _v, fb, now) => buildPropsView(ctx, g, a, fb, now)),
  bounty: forPage('bounty', (ctx, g, a, _v, fb) => buildBountyView(ctx, g, a, fb)),
  roulette: forPage('roulette', (ctx, g, a, _v, fb) => buildRouletteView(ctx, g, a, fb)),
  bomb: forPage('bomb', (ctx, g, a, _v, fb) => buildBombView(ctx, g, a, fb)),
  events: forPage('events', (ctx, g, a, _v, fb) => buildEventsHubView(ctx, g, a, fb)),
  predictions: forPage('predictions', (ctx, g, a, _v, fb) => buildPredictionsListView(ctx, g, a, fb)),
  pred_detail: forPage('pred_detail', (ctx, g, a, v, fb) => buildPredDetailView(ctx, g, a, v.predictionId, fb)),
  world_status: forPage('world_status', (ctx, g, a, _v, fb) => buildWorldStatusView(ctx, g, a, fb)),
  social_hub: forPage('social_hub', (ctx, g, a, _v, fb) => buildSocialHubView(ctx, g, a, fb)),
  cp: forPage('cp', (ctx, g, a, _v, fb, now) => buildCpView(ctx, g, a, fb, now)),
  cp_lb: forPage('cp_lb', (ctx, g, _a, v, fb) => buildCpLeaderboardView(ctx, g, v.lbPage, fb)),
  pets: forPage('pets', (ctx, g, a, _v, fb, now) => buildPetsView(ctx, g, a, fb, now)),
  pet_arena: forPage('pet_arena', (ctx, g, a, _v, fb) => buildPetArenaView(ctx, g, a, fb)),
  shop: forPage('shop', (ctx, g, a, v, fb, now) => buildShopView(ctx, g, a, fb, now, v.listPage)),
  bag: forPage('bag', (ctx, g, a, v, fb, now) => buildBagView(ctx, g, a, fb, now, v.listPage)),
  rank: forPage('rank', (ctx, g, a, _v, fb, now) => buildRankView(ctx, g, a, fb, now)),
  self_roles: forPage('self_roles', (ctx, g, a, v, fb) => buildSelfRolesView(ctx, g, a, v.panelId, fb, v.panelPage)),
  leaderboard: forPage('leaderboard', (ctx, g, _a, v, fb) => buildLeaderboardView(ctx, g, v.lbType, v.lbPage, fb)),
  admin: forPage('admin', (ctx, g, a, _v, fb) => buildAdminOverviewView(ctx, g, a, fb)),
  admin_econ: forPage('admin_econ', (ctx, g, a, v, fb) => buildAdminEconView(ctx, g, a, fb, v.confirmReset)),
  admin_lvl: forPage('admin_lvl', (ctx, g, a, v, fb) => buildAdminLvlView(ctx, g, a, fb, v.confirmReset)),
  admin_lvl_rewards: forPage('admin_lvl_rewards', (ctx, g, a, v, fb) => buildAdminLvlRewardsView(ctx, g, a, fb, v.listPage)),
  admin_roles: forPage('admin_roles', (ctx, g, a, v, fb) =>
    buildAdminRolesView(ctx, g, a, {
      panelId: v.panelId,
      panelPage: v.panelPage,
      optPage: v.optPage,
      confirmDeletePanelId: v.confirmDeletePanelId,
    }, fb),
  ),
  admin_shop: forPage('admin_shop', (ctx, g, a, v, fb) =>
    buildAdminShopView(ctx, g, a, fb, {
      listPage: v.listPage,
      confirmDeleteItemId: v.confirmDeleteItemId,
    }),
  ),
  admin_games: forPage('admin_games', (ctx, g, a, _v, fb) => buildAdminGamesView(ctx, g, a, fb)),
  admin_mod: forPage('admin_mod', (ctx, g, a, _v, fb) => buildAdminModView(ctx, g, a, fb)),
  admin_ops: forPage('admin_ops', (ctx, g, a, _v, fb) => buildAdminOpsView(ctx, g, a, fb)),
  admin_ai: forPage('admin_ai', (ctx, g, a, v, fb) =>
    buildAdminAiView(ctx, g, a, fb, v.tab ?? 'basic', v.regexPage ?? 1, v.profilePage ?? 1),
  ),
  admin_image: forPage('admin_image', (ctx, g, a, v, fb) => buildAdminImageView(ctx, g, a, fb, v.tab ?? 'basic')),
  admin_credit_rpg: forPage('admin_credit_rpg', (ctx, g, a, _v, fb) => buildAdminCreditRpgView(ctx, g, a, fb)),
  admin_monitor: forPage('admin_monitor', (ctx, g, a, v, fb, now) =>
    buildAdminMonitorView(ctx, g, a, v.filter ?? 'issues', fb, now, v.confirmClear ?? false),
  ),
};

export function buildMenuMessage(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  view: MenuView,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  return MENU_VIEW_BUILDERS[view.page](ctx, guildId, actor, view, feedback, nowMs);
}
