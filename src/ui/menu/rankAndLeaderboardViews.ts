import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { parseCardColor, type LeaderboardType } from '../../services/levelingService.js';
import { getRpgRealmInfo } from '../../services/rpgService.js';
import { PET_SPECIES_MAP } from '../../services/socialPetService.js';
import { COLORS, formatDurationZh, renderProgressBar } from '../embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuFeedback,
} from '../menuShared.js';

function createRankEmbed(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): EmbedBuilder {
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const cfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;
  const data = ctx.services.leveling.getRankCardData(guildId, actor.id, nowMs);
  const titleBadge = data.profile.equippedTitle ? `「${data.profile.equippedTitle}」` : '';
  const bar = renderProgressBar(data.progress.progressRatio, 14);
  const pct = Math.round(data.progress.progressRatio * 100);
  const boostText =
    data.activeBoostMultiplier > 1 && data.boostExpiresAt > nowMs
      ? `⚡ **${data.activeBoostMultiplier}x**（剩余 ${formatDurationZh(data.boostExpiresAt - nowMs)}）`
      : '未启用';

  const rels = ctx.services.socialPet.listUserRelationships(guildId, actor.id);
  const marriage = rels.find((r) => r.relType === 'marriage');
  const swornCount = rels.filter((r) => r.relType === 'sworn').length;
  const activePet = ctx.services.socialPet.getActivePet(guildId, actor.id);
  const partnerPart = marriage
    ? `💍 <@${marriage.userA === actor.id ? marriage.userB : marriage.userA}>（亲密 ${marriage.affinity}）`
    : swornCount > 0
      ? `🍻 结拜死党 ${swornCount} 人`
      : '暂无 CP 绑定';
  const activeSp = activePet ? PET_SPECIES_MAP.get(activePet.speciesKey) : undefined;
  const petPart = activePet
    ? `${activeSp?.emoji ?? '🐾'} **${activePet.nickname}** [${activePet.rarity} Lv.${activePet.level}]`
    : '暂无出战宠';
  const creditProfile = ctx.services.creditLoan.getCreditProfile(guildId, actor.id, nowMs);
  const gamblingStats = ctx.services.creditLoan.getGamblingStats(guildId, actor.id);
  const hustleStats = ctx.services.creditLoan.getHustleStats(guildId, actor.id);
  const rpgChar = ctx.repos.rpg.getCharacter(guildId, actor.id);
  const netSign = gamblingStats.netProfit >= 0 ? '+' : '';
  const rpgPart = rpgChar
    ? `${getRpgRealmInfo(rpgChar.level).fullLabel}（Lv.**${rpgChar.level}** · 破境 **${rpgChar.totalBreakthroughs}** 次）`
    : '尚未踏入冒险';

  const parsedColor = parseCardColor(data.profile.cardColor);
  const customColor = parsedColor.ok ? parsedColor.colorInt : null;
  const displayCardName = data.profile.cardNickname || actor.displayName;
  const cardHeaderLines: string[] = [];
  if (data.profile.cardTag) {
    cardHeaderLines.push(`🏷️ **${data.profile.cardTag}**`);
  }
  if (data.profile.cardBio) {
    cardHeaderLines.push(`💬 *${data.profile.cardBio}*`);
  }
  const statLine = lvlCfg.statEnabled
    ? `📏 ${lvlCfg.statName}：**${data.profile.statValue}** ${lvlCfg.statUnit}`
    : null;
  const rankDescription = [
    ...cardHeaderLines,
    `🏅 **Lv.${data.progress.level}** ｜ 全服第 **#${data.rank}** / ${data.totalMembers} 名`,
    ...(statLine ? [statLine] : []),
    `\`${bar}\` **${pct}%**（${data.progress.currentLevelXp} / ${data.progress.nextLevelXp} XP，累计 ${data.profile.xp} XP）`,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(resolveColor(customColor ?? COLORS.PRIMARY, feedback))
    .setAuthor({
      name: `${titleBadge}${displayCardName} 的身份证名片`,
      iconURL: actor.avatarUrl,
    })
    .setThumbnail(actor.avatarUrl)
    .setDescription(withFeedback(rankDescription, feedback))
    .addFields(
      {
        name: `${cfg.currencyEmoji} 总资产`,
        value: `**${data.profile.coins + data.profile.bankCoins}** ${cfg.currencyName}\n（现金 ${data.profile.coins} / 银行 ${data.profile.bankCoins}）`,
        inline: true,
      },
      {
        name: '🔥 聊天热度 / 经验卡',
        value: `热度 **${data.heatMultiplier}x**（连击 ${data.profile.heatStreak}）\n经验卡：${boostText}`,
        inline: true,
      },
      {
        name: '💞 社交与宠物',
        value: `${partnerPart}\n出战宠：${petPart}`,
      },
      {
        name: '💬 活跃统计',
        value: `有效发言 **${data.profile.messageCount}** 条 ｜ 语音挂机 **${data.profile.voiceMinutes}** 分钟`,
      },
      {
        name: '📜 征信与江湖档案',
        value: [
          `信用分：**${creditProfile.account.score}**（${creditProfile.tier.label}）${creditProfile.overdueLoans.length > 0 ? ' ⚠️ 逾期老赖' : ''}`,
          `博弈战绩：净盈亏 **${netSign}${gamblingStats.netProfit.toLocaleString()}** ${cfg.currencyName}（${gamblingStats.gamesPlayed} 局） ｜ 卖屁股：**${hustleStats.totalCount}** 次`,
          `⚔️ 西幻RPG：${rpgPart}`,
        ].join('\n'),
      },
    )
    .setTimestamp();
}

export function buildPublicRankEmbed(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  nowMs = Date.now(),
): EmbedBuilder {
  return createRankEmbed(ctx, guildId, actor, undefined, nowMs);
}

export function buildRankView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const lvlCfg = ctx.repos.guildConfig.getOrCreate(guildId).leveling;
  const embed = createRankEmbed(ctx, guildId, actor, feedback, nowMs).setFooter({
    text: '🔒 当前仅自己可见；点击「📢 晒出我的名片」可发送到当前频道展示',
  });

  const row = buttonRow(
    makeButton('menu:nav:rank', '🪪 我的名片', ButtonStyle.Primary),
    makeButton('menu:rank:xp:1', '📈 经验榜', ButtonStyle.Secondary),
    makeButton('menu:rank:coins:1', '💰 富豪榜', ButtonStyle.Secondary),
    makeButton('menu:rank:invites:1', '📨 邀请榜', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  );

  const shareRow = buttonRow(
    makeButton('menu:modal:edit_card', '✏️ 编辑身份证', ButtonStyle.Primary),
    makeButton('menu:nav:self_roles', '🎭 自助身份组', ButtonStyle.Secondary),
    makeButton('menu:rank:stat:1', `📏 ${lvlCfg.statName}榜`, ButtonStyle.Secondary),
    makeButton('menu:share:rank', '📢 晒出我的名片', ButtonStyle.Success),
    makeButton('menu:nav:bag', '🎒 背包称号', ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row, shareRow] };
}

function createLeaderboardEmbedAndMeta(
  ctx: AppContext,
  guildId: string,
  lbType: LeaderboardType,
  lbPage: number,
  feedback: MenuFeedback | undefined,
): { embed: EmbedBuilder; page: number; totalPages: number } {
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const cfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;
  const res = ctx.services.leveling.getLeaderboard(guildId, lbType, lbPage, 10);

  const titleMap: Record<LeaderboardType, string> = {
    xp: '📈 服务器等级经验排行榜',
    coins: `💰 服务器${cfg.currencyName}富豪榜`,
    invites: '📨 服务器邀请贡献排行榜',
    stat: `📏 服务器${lvlCfg.statName}排行榜`,
    credit: '📜 服务器信用分红榜',
    deadbeat: '💀 服务器老赖黑名单',
    hustle: '🍑 服务器卖屁股营收榜',
    gambling_profit: '🎰 服务器赌神盈利榜',
    gambling_loss: '🪦 服务器冤大头亏损榜',
    rpg: '⚔️ 服务器西幻 RPG 勇者阶位榜',
  };

  const lines = res.items.map((item, idx) => {
    const rankNum = (res.page - 1) * 10 + idx + 1;
    const medal =
      rankNum === 1 ? '🥇' : rankNum === 2 ? '🥈' : rankNum === 3 ? '🥉' : `**#${rankNum}**`;
    const titleTag = item.equippedTitle ? `「${item.equippedTitle}」` : '';
    if (lbType === 'xp') {
      return `${medal} <@${item.userId}> ${titleTag} — Lv.**${item.secondaryValue}**（${item.primaryValue} XP）`;
    }
    if (lbType === 'coins') {
      return `${medal} <@${item.userId}> ${titleTag} — ${cfg.currencyEmoji} **${item.primaryValue}** ${cfg.currencyName}（银行 ${item.secondaryValue}）`;
    }
    if (lbType === 'stat') {
      return `${medal} <@${item.userId}> ${titleTag} — 📏 **${item.primaryValue}** ${lvlCfg.statUnit}（Lv.${item.secondaryValue}）`;
    }
    if (lbType === 'credit') {
      return `${medal} <@${item.userId}> — 📜 信用分 **${item.primaryValue}**`;
    }
    if (lbType === 'deadbeat') {
      return `${medal} <@${item.userId}> — 💀 逾期欠款 **${item.primaryValue.toLocaleString()}** ${cfg.currencyName}（信用分 ${item.secondaryValue}）`;
    }
    if (lbType === 'hustle') {
      return `${medal} <@${item.userId}> — 🍑 累计营收 **${item.primaryValue.toLocaleString()}** ${cfg.currencyName}（营业 ${item.secondaryValue} 次）`;
    }
    if (lbType === 'gambling_profit' || lbType === 'gambling_loss') {
      const sign = item.primaryValue >= 0 ? '+' : '';
      const won = (item.totalWon ?? 0).toLocaleString();
      const lost = (item.totalLost ?? 0).toLocaleString();
      return `${medal} <@${item.userId}> — 🎰 净盈亏 **${sign}${item.primaryValue.toLocaleString()}** ${cfg.currencyName}（总赢 +${won} / 总亏 -${lost} · ${item.secondaryValue} 局）`;
    }
    if (lbType === 'rpg') {
      const realm = getRpgRealmInfo(item.primaryValue);
      return `${medal} <@${item.userId}> — ${realm.fullLabel}（Lv.${item.primaryValue} · 破境 ${item.secondaryValue} 次）`;
    }
    return `${medal} <@${item.userId}> — 成功邀请 **${item.primaryValue}** 人`;
  });

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setTitle(titleMap[lbType])
    .setDescription(
      withFeedback(
        lines.length > 0 ? lines.join('\n') : '暂无上榜数据，快去频道活跃互动吧！',
        feedback,
      ),
    )
    .setFooter({ text: `第 ${res.page} / ${res.totalPages} 页 · 共 ${res.totalItems} 名成员` })
    .setTimestamp();

  return { embed, page: res.page, totalPages: res.totalPages };
}

export function buildPublicLeaderboardEmbed(
  ctx: AppContext,
  guildId: string,
  lbType: LeaderboardType,
  lbPage: number,
): EmbedBuilder {
  return createLeaderboardEmbedAndMeta(ctx, guildId, lbType, lbPage, undefined).embed;
}

export function buildLeaderboardView(
  ctx: AppContext,
  guildId: string,
  lbType: LeaderboardType,
  lbPage: number,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const { embed, page, totalPages } = createLeaderboardEmbedAndMeta(
    ctx,
    guildId,
    lbType,
    lbPage,
    feedback,
  );

  const tabRow = buttonRow(
    makeButton('menu:nav:rank', '🪪 我的名片', ButtonStyle.Secondary),
    makeButton('menu:rank:xp:1', '📈 经验榜', lbType === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    makeButton('menu:rank:coins:1', '💰 富豪榜', lbType === 'coins' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    makeButton('menu:rank:invites:1', '📨 邀请榜', lbType === 'invites' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  );

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const lvlCfg = guildCfg.leveling;
  const ecoCfg = guildCfg.economy;
  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  const pagerRow = buttonRow(
    makeButton(`menu:rank:${lbType}:${prevPage}:prev`, '⬅️ 上一页', ButtonStyle.Secondary, page <= 1),
    makeButton(`menu:rank:${lbType}:${nextPage}:next`, '➡️ 下一页', ButtonStyle.Secondary, page >= totalPages),
    makeButton('menu:rank:stat:1', `📏 ${lvlCfg.statName}榜`, lbType === 'stat' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    makeButton(`menu:share:lb:${lbType}:${page}`, '📢 晒出排行榜', ButtonStyle.Success),
  );

  const boardOptions: Array<{ label: string; value: string; isDefault?: boolean }> = [
    { label: '📈 等级经验榜', value: 'xp', isDefault: lbType === 'xp' },
    { label: truncateText(`💰 ${ecoCfg.currencyName}富豪榜`, 100), value: 'coins', isDefault: lbType === 'coins' },
    { label: truncateText(`📏 ${lvlCfg.statName}榜`, 100), value: 'stat', isDefault: lbType === 'stat' },
    { label: '📨 邀请贡献榜', value: 'invites', isDefault: lbType === 'invites' },
    { label: '📜 信用分红榜', value: 'credit', isDefault: lbType === 'credit' },
    { label: '💀 老赖黑名单', value: 'deadbeat', isDefault: lbType === 'deadbeat' },
    { label: '🍑 卖屁股营收榜', value: 'hustle', isDefault: lbType === 'hustle' },
    { label: '🎰 赌神盈利榜', value: 'gambling_profit', isDefault: lbType === 'gambling_profit' },
    { label: '🪦 冤大头亏损榜', value: 'gambling_loss', isDefault: lbType === 'gambling_loss' },
    { label: '⚔️ 西幻RPG地牢榜', value: 'rpg', isDefault: lbType === 'rpg' },
    { label: '💕 CP 亲密度榜', value: 'cp_lb' },
    { label: '🎯 悬赏通缉榜', value: 'bounty' },
  ];

  const boardSelect = new StringSelectMenuBuilder()
    .setCustomId('menu:lb_select')
    .setPlaceholder('🔀 切换全服 12 大排行榜...')
    .addOptions(
      boardOptions.map((opt) => {
        const builder = new StringSelectMenuOptionBuilder().setLabel(opt.label).setValue(opt.value);
        if (opt.isDefault !== undefined) {
          builder.setDefault(opt.isDefault);
        }
        return builder;
      }),
    );

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(boardSelect);

  return { embeds: [embed], components: [tabRow, pagerRow, selectRow] };
}
