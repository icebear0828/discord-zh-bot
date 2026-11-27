import type { ModalSubmitInteraction } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { parseCardColor, renderLevelUpTemplate } from '../../services/levelingService.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../../ui/menuShared.js';
import { dispatchByAction, type ActionRouteTable } from '../menu/subRouter.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  parseIntInRange,
  parseNumberInRange,
  respondFromModal,
} from '../menuHelpers.js';

interface SystemModalInput {
  interaction: ModalSubmitInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: readonly string[];
}

async function replyModalMenu(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  view: MenuView,
  feedback: MenuFeedback,
): Promise<true> {
  await respondFromModal(interaction, buildMenuMessage(ctx, guildId, actor, view, feedback));
  return true;
}

const SYSTEM_MODAL_ROUTES: ActionRouteTable<SystemModalInput> = {
  exact: {
    admin_cl_loan: async ({ interaction, ctx, guildId, actor }) => {
      if (!actor.isAdmin) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      const bankLoanMaxCap = parseIntInRange(
        interaction.fields.getTextInputValue('bankLoanMaxCap'),
        1_000,
        1_000_000_000,
      );
      const usuryLoanMax = parseIntInRange(
        interaction.fields.getTextInputValue('usuryLoanMax'),
        1_000,
        1_000_000_000,
      );
      const usuryDailyRatePct = parseNumberInRange(
        interaction.fields.getTextInputValue('usuryDailyRatePct'),
        1,
        100,
      );
      const usuryTermDays = parseIntInRange(
        interaction.fields.getTextInputValue('usuryTermDays'),
        1,
        30,
      );
      const garnishRatePct = parseNumberInRange(
        interaction.fields.getTextInputValue('garnishRatePct'),
        10,
        100,
      );
      if (
        bankLoanMaxCap === null ||
        usuryLoanMax === null ||
        usuryDailyRatePct === null ||
        usuryTermDays === null ||
        garnishRatePct === null
      ) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_credit_rpg' },
          { type: 'error', text: '参数格式或范围无效，请检查各栏数值要求后重试。' },
        );
      }

      ctx.repos.guildConfig.updateCreditLoan(guildId, {
        ...cfg.creditLoan,
        bankLoanMaxCap,
        usuryLoanMax,
        usuryDailyRate: Number((usuryDailyRatePct / 100).toFixed(4)),
        usuryTermDays,
        garnishRate: Number((garnishRatePct / 100).toFixed(4)),
      });
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_credit_rpg' },
        { type: 'success', text: '已保存银行贷款、高利贷与逾期强扣参数！' },
      );
    },

    admin_cl_hustle: async ({ interaction, ctx, guildId, actor }) => {
      if (!actor.isAdmin) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      const hustleCooldownSec = parseIntInRange(
        interaction.fields.getTextInputValue('hustleCooldownSec'),
        60,
        604_800,
      );
      const hustleMinMultiplier = parseNumberInRange(
        interaction.fields.getTextInputValue('hustleMinMultiplier'),
        1,
        20,
      );
      const hustleMaxMultiplier = parseNumberInRange(
        interaction.fields.getTextInputValue('hustleMaxMultiplier'),
        1,
        50,
      );
      const hustleCreditPenalty = parseIntInRange(
        interaction.fields.getTextInputValue('hustleCreditPenalty'),
        0,
        100,
      );
      const dailyReviewLimit = parseIntInRange(
        interaction.fields.getTextInputValue('dailyReviewLimit'),
        1,
        20,
      );
      if (
        hustleCooldownSec === null ||
        hustleMinMultiplier === null ||
        hustleMaxMultiplier === null ||
        hustleCreditPenalty === null ||
        dailyReviewLimit === null ||
        hustleMaxMultiplier < hustleMinMultiplier
      ) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_credit_rpg' },
          { type: 'error', text: '卖屁股/评价参数无效（上限倍率须 >= 下限倍率）。' },
        );
      }

      ctx.repos.guildConfig.updateCreditLoan(guildId, {
        ...cfg.creditLoan,
        hustleCooldownSec,
        hustleMinMultiplier,
        hustleMaxMultiplier,
        hustleCreditPenalty,
        dailyReviewLimit,
      });
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_credit_rpg' },
        { type: 'success', text: '已保存卖屁股与信用互评参数！' },
      );
    },

    admin_rpg_cfg: async ({ interaction, ctx, guildId, actor }) => {
      if (!actor.isAdmin) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      const dailyStamina = parseIntInRange(
        interaction.fields.getTextInputValue('dailyStamina'),
        1,
        50,
      );
      const staminaPotionPrice = parseIntInRange(
        interaction.fields.getTextInputValue('staminaPotionPrice'),
        0,
        10_000_000,
      );
      const staminaPotionDailyLimit = parseIntInRange(
        interaction.fields.getTextInputValue('staminaPotionDailyLimit'),
        0,
        20,
      );
      const classSwitchCost = parseIntInRange(
        interaction.fields.getTextInputValue('classSwitchCost'),
        0,
        10_000_000,
      );
      const bagCapacity = parseIntInRange(
        interaction.fields.getTextInputValue('bagCapacity'),
        10,
        200,
      );
      if (
        dailyStamina === null ||
        staminaPotionPrice === null ||
        staminaPotionDailyLimit === null ||
        classSwitchCost === null ||
        bagCapacity === null
      ) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_credit_rpg' },
          { type: 'error', text: '西幻 RPG 参数格式或范围无效，请检查后重试。' },
        );
      }

      ctx.repos.guildConfig.updateRpg(guildId, {
        ...cfg.rpg,
        dailyStamina,
        staminaPotionPrice,
        staminaPotionDailyLimit,
        classSwitchCost,
        bagCapacity,
      });
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_credit_rpg' },
        { type: 'success', text: '已保存西幻 RPG 地牢参数！' },
      );
    },

    edit_card: async ({ interaction, ctx, guildId, actor }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'leveling', '等级与热度');
      if (disabledMsg) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'home' },
          { type: 'error', text: disabledMsg },
        );
      }
      const rawNickname = interaction.fields.getTextInputValue('cardNickname').trim();
      const rawTag = interaction.fields.getTextInputValue('cardTag').trim();
      const rawBio = interaction.fields.getTextInputValue('cardBio').trim();
      const rawColor = interaction.fields.getTextInputValue('cardColor').trim();

      if (rawNickname.length > 24 || rawTag.length > 32 || rawBio.length > 80) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'rank' },
          { type: 'error', text: '输入超长：昵称限24字、标签限32字、签名限80字。' },
        );
      }

      const parsedColor = parseCardColor(rawColor);
      if (!parsedColor.ok) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'rank' },
          {
            type: 'error',
            text: '主题色格式无效，请填常用色（红/橙/黄/绿/青/蓝/紫/粉/金/黑/白）或 6 位 HEX 色值（如 `#FF6B8B`），留空可恢复默认。',
          },
        );
      }

      ctx.repos.profile.updateCard(guildId, actor.id, {
        cardNickname: rawNickname || null,
        cardTag: rawTag || null,
        cardBio: rawBio || null,
        cardColor: parsedColor.normalized,
      });

      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'rank' },
        { type: 'success', text: '🪪 个人身份证名片已更新！可点击「📢 晒出我的名片」向群友展示。' },
      );
    },

    admin_lvl_msg: async ({ interaction, ctx, guildId, actor }) => {
      if (!actor.isAdmin) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const levelUpTitle = interaction.fields.getTextInputValue('levelUpTitle').trim();
      const levelUpTemplate = interaction.fields.getTextInputValue('levelUpTemplate').trim();

      if (
        levelUpTitle.length < 1 ||
        levelUpTitle.length > 60 ||
        levelUpTemplate.length < 1 ||
        levelUpTemplate.length > 400
      ) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl' },
          { type: 'error', text: '升级播报标题需 1~60 字，提示语模板需 1~400 字。' },
        );
      }

      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      ctx.repos.guildConfig.updateLeveling(guildId, {
        ...cfg.leveling,
        levelUpTitle,
        levelUpTemplate,
      });

      const preview = renderLevelUpTemplate(levelUpTemplate, {
        user: `<@${actor.id}>`,
        username: actor.displayName,
        level: 5,
        oldLevel: 4,
        coins: cfg.leveling.levelUpCoinReward,
        currency: cfg.economy.currencyName,
        roles: '@示例身份组',
        stat: 18,
        statGained: 2,
        statUnit: cfg.leveling.statUnit,
      });

      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_lvl' },
        { type: 'success', text: `✅ 升级提示语已保存！\n效果预览：${preview}` },
      );
    },

    admin_lvl_reward_add: async ({ interaction, ctx, guildId, actor, parts }) => {
      if (!actor.isAdmin) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const roleId = parts[3];
      const level = parseIntInRange(interaction.fields.getTextInputValue('level'), 1, 200);
      if (!roleId || level === null) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl_rewards' },
          { type: 'error', text: '等级无效，请输入 1 ~ 200 之间的整数。' },
        );
      }

      ctx.repos.profile.setLevelReward(guildId, level, roleId);
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_lvl_rewards' },
        { type: 'success', text: `✅ 已设置：**Lv.${level}** 将自动发放 <@&${roleId}>。` },
      );
    },
  },
};

export async function tryHandleConfigSystemModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return dispatchByAction(parts[2], { interaction, ctx, guildId, actor, parts }, SYSTEM_MODAL_ROUTES);
}
