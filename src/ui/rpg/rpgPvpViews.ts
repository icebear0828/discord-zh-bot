import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { EconomyConfig } from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import type { RpgDuel, RpgDuelRulesMode } from '../../db/repositories/rpgRepo.js';
import {
  DAILY_ARENA_FIGHTS,
  MAX_RPG_DUEL_BET,
  RPG_CLASSES,
  RPG_CLASS_MAP,
  getRpgRealmInfo,
} from '../../services/rpgService.js';
import { COLORS } from '../embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
} from '../menuShared.js';
import { buildClassOnboardingView } from './rpgHomeAndClassViews.js';

export function buildRpgPvpView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
  if (!character.classSelected) {
    return buildClassOnboardingView(actor, feedback);
  }

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const economy = guildCfg.economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const arenaPreview = ctx.services.rpg.previewDailyArenaReward(guildId, actor.id, nowMs);
  const arenaRank = ctx.services.rpg.getArenaRank(guildId, actor.id);
  const arenaLb = ctx.services.rpg.getArenaLeaderboard(guildId, 5, 0);
  const candidates = ctx.services.rpg.listArenaCandidates(guildId, actor.id, 25);
  const pendingDuel = ctx.services.rpg.getPendingDuelForUser(guildId, actor.id);

  const rankText = arenaRank ? `第 **#${arenaRank.rank}** / ${arenaRank.total} 名` : '暂未上榜';

  const lines: string[] = [
    `🏆 天梯积分：**${arenaPreview.rating.toLocaleString('en-US')}**（${arenaPreview.tierLabel} · ${rankText}）`,
    `⚔️ 今日免费天梯挑战：剩余 **${arenaPreview.fightsRemaining}/${DAILY_ARENA_FIGHTS}** 次 ｜ 🎁 每日段位俸禄：${economy.currencyEmoji} **+${arenaPreview.coins.toLocaleString('en-US')}** ＋ ✨ **+${arenaPreview.dust}** 魔尘（${arenaPreview.claimedToday ? '✅ 今日已领' : '🔥 可领取'}）`,
    `${economy.currencyEmoji} 口袋现金：**${profile.coins.toLocaleString('en-US')}** ${economy.currencyName} ｜ ✨ 奥术魔尘：**${character.arcaneDust.toLocaleString('en-US')}**`,
  ];

  if (pendingDuel) {
    const expSec = Math.floor(pendingDuel.expiresAt / 1000);
    const modeTag = pendingDuel.rulesMode === 'equalized' ? '⚖️ 同阶拉平局' : '🔥 满配神装局';
    lines.push(
      '',
      `📣 **你有进行中的公屏战书（#${pendingDuel.id} · ${modeTag}）**：已发布于 <#${pendingDuel.channelId}>，截止 <t:${expSec}:R>（可在战书卡片撤回）`,
    );
  }

  if (arenaLb.items.length > 0) {
    lines.push('', '👑 **本服天梯战神榜（Top 5）**');
    arenaLb.items.forEach((hero, idx) => {
      const cls = RPG_CLASS_MAP.get(hero.classKey) ?? RPG_CLASSES[0]!;
      const realm = getRpgRealmInfo(hero.level);
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`#${idx + 1}\``;
      lines.push(
        `${medal} <@${hero.userId}> — **${hero.arenaRating}** 分 ｜ ${cls.emoji} ${realm.fullLabel}`,
      );
    });
  }

  lines.push(
    '',
    '⚔️ **#游戏聊天 公屏押注约战（10分钟有效）**',
    `• **🔥 满配神装局**：全额代入真实等级、强化装备、词条与战宠，巅峰硬碰硬！`,
    `• **⚖️ 同阶拉平局**：双方白值统一拉平至 Lv.45 公平模板，保留职业流派、强化比例与词条/神铸搭配！`,
    `• 赌注范围：**0 ~ ${MAX_RPG_DUEL_BET.toLocaleString('en-US')}** ${economy.currencyName}（填 **0** 为无赌注荣誉切磋；逾期老赖禁押注但可 0 赌注切磋）`,
  );

  const components: MenuComponentRow[] = [];

  if (candidates.length > 0) {
    const options = candidates.slice(0, 25).map((cand) => {
      const cls = RPG_CLASS_MAP.get(cand.classKey) ?? RPG_CLASSES[0]!;
      const realm = getRpgRealmInfo(cand.level);
      const candProfile = ctx.repos.profile.getOrCreate(guildId, cand.userId);
      const heroName = candProfile.cardNickname?.trim() || `勇者 ${cand.userId.slice(-4)}`;
      return new StringSelectMenuOptionBuilder()
        .setLabel(truncateText(`${cls.emoji} ${heroName}（天梯 ${cand.arenaRating} 分）`, 80))
        .setValue(cand.userId)
        .setDescription(
          truncateText(`${realm.fullLabel} · Lv.${cand.level} · 击败防守镜像不扣对方星币`, 100),
        );
    });

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('rpg:arena_fight')
          .setPlaceholder(
            arenaPreview.fightsRemaining > 0
              ? `⚔️ 选择本服勇者镜像立即天梯挑战（余 ${arenaPreview.fightsRemaining}/${DAILY_ARENA_FIGHTS} 次）...`
              : '⏳ 今日 5 次天梯挑战已用完，明日再来！',
          )
          .setDisabled(arenaPreview.fightsRemaining <= 0)
          .addOptions(options),
      ),
    );
  } else {
    lines.push('', '> 💡 本服暂未发现其他已选职的勇者镜像，快喊群友输入 `/冒险` 创建角色吧！');
  }

  components.push(
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('rpg:duel_target:full')
        .setPlaceholder('🔥 指定群友发起【满配神装】押注约战 (#游戏聊天)...')
        .setDisabled(Boolean(pendingDuel)),
    ),
  );

  components.push(
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('rpg:duel_target:equalized')
        .setPlaceholder('⚖️ 指定群友发起【同阶拉平】押注约战 (#游戏聊天)...')
        .setDisabled(Boolean(pendingDuel)),
    ),
  );

  components.push(
    buttonRow(
      makeButton(
        'rpg:arena_claim',
        arenaPreview.claimedToday ? '🎁 今日俸禄已领' : '🎁 领取每日天梯俸禄',
        ButtonStyle.Success,
        !arenaPreview.canClaim,
      ),
      makeButton(
        'rpg:duel_open:full',
        '🔥 发起满配约战',
        ButtonStyle.Danger,
        Boolean(pendingDuel),
      ),
      makeButton(
        'rpg:duel_open:equalized',
        '⚖️ 发起同阶拉平约战',
        ButtonStyle.Primary,
        Boolean(pendingDuel),
      ),
    ),
  );

  components.push(
    buttonRow(
      makeButton('rpg:nav:pvp', '🔄 刷新竞技场', ButtonStyle.Secondary),
      makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
    ),
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 竞技场与公屏切磋`, iconURL: actor.avatarUrl })
    .setTitle('🏆 勇者异步天梯 & #游戏聊天 押注切磋')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '异步天梯防守方零损失；公屏约战仅投递至 #游戏聊天，10分钟无人应战自动退还押注' })
    .setTimestamp();

  return {
    embeds: [embed],
    components,
  };
}

export function buildRpgDuelBetModal(
  mode: RpgDuelRulesMode,
  targetIdOrOpen: string,
  currencyName: string,
): ModalBuilder {
  const modeTitle = mode === 'equalized' ? '⚖️ 发起同阶拉平约战' : '🔥 发起满配神装约战';
  const targetSuffix = targetIdOrOpen === 'open' ? '（公开摆擂）' : '（指定挑战）';

  const betInput = new TextInputBuilder()
    .setCustomId('bet_amount')
    .setLabel(truncateText(`押注 ${currencyName} (0~10亿，填0为荣誉切磋)`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(10)
    .setValue('0')
    .setPlaceholder('填 0 为无赌注荣誉切磋，最高 1000000000')
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`rpg:modal:duel:${mode}:${targetIdOrOpen}`)
    .setTitle(truncateText(`${modeTitle}${targetSuffix}`, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(betInput));
}

export function buildRpgPublicDuelCard(
  duel: RpgDuel,
  economy: EconomyConfig,
): BuiltButtonMessage {
  const modeLabel =
    duel.rulesMode === 'equalized'
      ? '⚖️ 同阶拉平局（统一 Lv.45 公平模板 · 纯拼流派与词条）'
      : '🔥 满配神装局（真实等级与强化神装全开）';
  const betLine =
    duel.betAmount > 0
      ? `${economy.currencyEmoji} **${duel.betAmount.toLocaleString('en-US')}** ${economy.currencyName}（胜者独揽 **${(duel.betAmount * 2).toLocaleString('en-US')}** 奖池！）`
      : '🏅 **0 赌注 · 荣誉切磋**';
  const targetLine = duel.opponentId
    ? `🎯 指定对手：<@${duel.opponentId}>`
    : '🌐 挑战对象：**全服公开摆擂（任意已选职勇者可接）**';

  const statusHeading =
    duel.status === 'pending'
      ? '⚔️ 战书已立 · 等待拔剑应战！'
      : duel.status === 'completed'
        ? duel.winnerId
          ? '🏆 对决落幕 · 胜负已分！'
          : '🤝 棋逢对手 · 握手言和！'
        : duel.status === 'expired'
          ? '⌛ 逾时未战 · 押注退回'
          : '🏳️ 战书已撤回';

  const color =
    duel.status === 'completed'
      ? COLORS.SUCCESS
      : duel.status === 'pending'
        ? COLORS.GOLD
        : COLORS.PRIMARY;

  const lines: string[] = [
    `🗡️ 发起勇者：<@${duel.challengerId}> ｜ ${targetLine}`,
    `📜 竞技规则：**${modeLabel}**`,
    `🪙 切磋赌注：${betLine}`,
  ];

  if (duel.status === 'pending') {
    const expSec = Math.floor(duel.expiresAt / 1000);
    lines.push(`⏱️ 战书有效期：<t:${expSec}:R> 超时自动退回押注`);
  } else {
    if (duel.resultSummary) {
      lines.push('', `📣 **结算战果**：${duel.resultSummary}`);
    }
    if (duel.highlights.length > 0) {
      lines.push('', '🎬 **高光回合实录**：', ...duel.highlights.slice(0, 8).map((h) => `> ${h}`));
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⚔️ 西幻勇者约战 #${duel.id} — ${statusHeading}`)
    .setDescription(truncateText(lines.join('\n'), 4096))
    .setFooter({ text: '西幻 RPG 公屏切磋仅在 #游戏聊天 进行' })
    .setTimestamp(duel.resolvedAt || duel.createdAt);

  if (duel.status !== 'pending') {
    return { embeds: [embed], components: [] };
  }

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(`rpg:duel_accept:${duel.id}`, '⚔️ 拔剑应战', ButtonStyle.Success),
        makeButton(`rpg:duel_cancel:${duel.id}`, '🏳️ 撤回战书', ButtonStyle.Danger),
      ),
    ],
  };
}
