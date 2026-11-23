import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { EconomyConfig } from '../config/defaults.js';
import type {
  PetBattle,
  RelationshipProposal,
  UserPet,
} from '../db/repositories/socialPetRepo.js';
import { getDateKey } from '../services/economyService.js';
import {
  PET_SPECIES_MAP,
  xpNeededForPetLevel,
} from '../services/socialPetService.js';
import {
  COLORS,
  formatDurationZh,
  renderProgressBar,
  type AppContext,
} from './embeds.js';
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
} from './menuShared.js';

const RARITY_BADGE: Record<string, string> = {
  N: '⚪ [N]',
  R: '🔵 [R]',
  SR: '🟣 [SR]',
  SSR: '🟡 [SSR]',
};

export function buildSocialHubView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const rels = ctx.services.socialPet.listUserRelationships(guildId, actor.id);
  const marriage = rels.find((r) => r.relType === 'marriage');
  const swornCount = rels.filter((r) => r.relType === 'sworn').length;
  const activePet = ctx.services.socialPet.getActivePet(guildId, actor.id);
  const totalPets = ctx.services.socialPet.listUserPets(guildId, actor.id).length;

  let marriageLine = '💍 婚姻状态：单身贵族（可在下方发起求婚）';
  if (marriage) {
    const partnerId = marriage.userA === actor.id ? marriage.userB : marriage.userA;
    marriageLine = `💍 伴侣：<@${partnerId}>（亲密度 **${marriage.affinity}**）`;
  }

  let petLine = '🐾 出战宠物：暂无宠物（去抽第一只盲盒吧！）';
  if (activePet) {
    const sp = PET_SPECIES_MAP.get(activePet.speciesKey);
    petLine = `🐾 出战宠物：${sp?.emoji ?? '🐾'} **${activePet.nickname}** ${RARITY_BADGE[activePet.rarity] ?? ''} Lv.${activePet.level}（共持有 ${totalPets} 只）`;
  }

  const description = [
    marriageLine,
    `🍻 结拜/死党：**${swornCount}** 段`,
    petLine,
    '',
    '• **💍 结婚 / 结拜 CP**：公开求婚/结拜仪式，每日打卡涨亲密度解锁专属 CP 称号并冲亲密榜',
    '• **🐾 盲盒与宠物屋**：N/R/SR/SSR 盲盒抽宠，喂食训练升级，派宠物打工，还能带它助战世界 Boss！',
    '• **🏟️ 宠物斗兽场**：指定群友或公开摆擂台进行回合制战报押注 PVP！',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 关系与宠物中心`, iconURL: actor.avatarUrl })
    .setTitle('💞 关系社交与电子宠物')
    .setDescription(withFeedback(description, feedback))
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:nav:cp', '💍 结婚/结拜 CP', ButtonStyle.Primary),
        makeButton('menu:nav:cp_lb:1', '💕 亲密度榜', ButtonStyle.Secondary),
        makeButton('menu:nav:pets', '🐾 盲盒与宠物屋', ButtonStyle.Success),
        makeButton('menu:nav:pet_arena', '🏟️ 宠物斗兽场', ButtonStyle.Danger),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildCpView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const rels = ctx.services.socialPet.listUserRelationships(guildId, actor.id);
  const today = getDateKey(nowMs, ctx.timezone);

  const relLines =
    rels.length > 0
      ? rels.map((r) => {
          const otherId = r.userA === actor.id ? r.userB : r.userA;
          const badge = r.relType === 'marriage' ? '💍 伴侣' : '🍻 死党';
          const checked = r.lastCheckinDate === today ? '✅ 今日已打卡' : '⏰ 今日可打卡';
          return `• **#${r.id}** ${badge} <@${otherId}> ｜ 亲密度 **${r.affinity}** ｜ ${checked}`;
        })
      : ['你还没有结婚或结拜关系，从下方选人发起公开仪式吧！'];

  const description = [
    `仪式手续费：${cfg.economy.currencyEmoji} **${cfg.games.cpProposeCost}** ${cfg.economy.currencyName}（对方拒绝或过期自动退回）`,
    `规则：结婚限 **1对1**，结拜最多 **${cfg.games.cpMaxSworn}** 人；纯社交向不分割个人财产。`,
    `亲密度里程碑 **50 / 150 / 400** 自动向双方发放专属 CP 称号！`,
    '',
    '**我的关系列表：**',
    ...relLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 结婚与结拜系统`, iconURL: actor.avatarUrl })
    .setTitle('💍 结婚与结拜 CP 系统')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 发起求婚/结拜与达成亲密度称号都会在当前频道撒花广播' })
    .setTimestamp();

  const components: MenuComponentRow[] = [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('menu:user:cp_marry')
        .setPlaceholder('💍 选择群友发起「求婚」仪式...')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('menu:user:cp_sworn')
        .setPlaceholder('🍻 选择群友发起「结拜/死党」仪式...')
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];

  if (rels.length > 0) {
    const sliced = rels.slice(0, 25);
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('menu:cp_checkin')
          .setPlaceholder('💕 选择一段关系完成今日贴贴打卡...')
          .addOptions(
            sliced.map((r) => {
              const labelType = r.relType === 'marriage' ? '💍 伴侣' : '🍻 死党';
              const status = r.lastCheckinDate === today ? '今日已打卡' : '可打卡 +10~20';
              return new StringSelectMenuOptionBuilder()
                .setLabel(`#${r.id} ${labelType}（亲密度 ${r.affinity}）`)
                .setValue(String(r.id))
                .setDescription(status);
            }),
          ),
      ),
    );
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('menu:cp_dissolve')
          .setPlaceholder('💔 和平解除一段指定关系...')
          .addOptions(
            sliced.map((r) => {
              const labelType = r.relType === 'marriage' ? '💍 伴侣' : '🍻 死党';
              return new StringSelectMenuOptionBuilder()
                .setLabel(`解除 #${r.id} ${labelType}（亲密度 ${r.affinity}）`)
                .setValue(String(r.id))
                .setDescription('点击后立即和平解除该关系（不扣资产）');
            }),
          ),
      ),
    );
  }

  components.push(
    buttonRow(
      makeButton('menu:nav:cp_lb:1', '💕 亲密度榜', ButtonStyle.Primary),
      makeButton('menu:nav:cp', '🔄 刷新', ButtonStyle.Secondary),
      makeButton('menu:nav:social_hub', '💞 关系宠物', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

export function buildPublicAffinityLeaderboardEmbed(
  ctx: AppContext,
  guildId: string,
  page: number,
): { embed: EmbedBuilder; page: number; totalPages: number } {
  const perPage = 10;
  const first = ctx.services.socialPet.listAffinityLeaderboard(guildId, perPage, 0);
  const totalPages = Math.max(1, Math.ceil(first.total / perPage));
  const safePage = Math.max(1, Math.min(totalPages, page));
  const data =
    safePage === 1
      ? first
      : ctx.services.socialPet.listAffinityLeaderboard(guildId, perPage, (safePage - 1) * perPage);

  const lines =
    data.items.length > 0
      ? data.items.map((r, idx) => {
          const rank = (safePage - 1) * perPage + idx + 1;
          const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**#${rank}**`;
          const icon = r.relType === 'marriage' ? '💍' : '🍻';
          return `${medal} <@${r.userA}> ${icon} <@${r.userB}> — 亲密度 **${r.affinity}**`;
        })
      : ['暂无任何结婚或结拜记录，快去绑定全服第一对 CP！'];

  const embed = new EmbedBuilder()
    .setColor(COLORS.FUN)
    .setTitle('💕 全服 CP 亲密度排行榜')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `第 ${safePage} / ${totalPages} 页 ｜ 共 ${data.total} 对关系` })
    .setTimestamp();

  return { embed, page: safePage, totalPages };
}

export function buildCpLeaderboardView(
  ctx: AppContext,
  guildId: string,
  page: number,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const { embed, page: safePage, totalPages } = buildPublicAffinityLeaderboardEmbed(
    ctx,
    guildId,
    page,
  );
  if (feedback) {
    const raw = embed.data.description ?? '';
    embed.setDescription(withFeedback(raw, feedback));
  }

  const prevPage = Math.max(1, safePage - 1);
  const nextPage = Math.min(totalPages, safePage + 1);
  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(`menu:nav:cp_lb:${prevPage}:prev`, '⬅️ 上一页', ButtonStyle.Secondary, safePage <= 1),
        makeButton(
          `menu:nav:cp_lb:${nextPage}:next`,
          '➡️ 下一页',
          ButtonStyle.Secondary,
          safePage >= totalPages,
        ),
        makeButton(`menu:share:cp_lb:${safePage}`, '📢 晒出亲密榜', ButtonStyle.Success),
        makeButton('menu:nav:cp', '💍 返回 CP', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildPetsView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const pets = ctx.services.socialPet.listUserPets(guildId, actor.id);
  const activePet = pets.find((p) => p.isActive) ?? pets[0] ?? null;
  const today = getDateKey(nowMs, ctx.timezone);

  const lines: string[] = [
    `${cfg.economy.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.economy.currencyName} ｜ 宠物栏：**${pets.length} / ${cfg.games.petMaxOwned}**`,
    `🎲 盲盒抽宠 **${cfg.games.petGachaPrice}** ${cfg.economy.currencyName}（N 55% / R 30% / SR 12% / SSR 3%）`,
    '',
  ];

  if (activePet) {
    const sp = PET_SPECIES_MAP.get(activePet.speciesKey);
    const needXp = xpNeededForPetLevel(activePet.level);
    const ratio = activePet.xp / Math.max(1, needXp);
    const trainRemain =
      activePet.lastTrainAt > 0
        ? Math.max(0, activePet.lastTrainAt + 3600 * 1000 - nowMs)
        : 0;
    const workRemain =
      activePet.lastWorkAt > 0
        ? Math.max(0, activePet.lastWorkAt + 2 * 3600 * 1000 - nowMs)
        : 0;

    lines.push(
      `⭐ **当前出战：${sp?.emoji ?? '🐾'} ${activePet.nickname}** ${RARITY_BADGE[activePet.rarity] ?? ''}`,
      `Lv.**${activePet.level}** \`${renderProgressBar(ratio, 10)}\` (${activePet.xp}/${needXp} XP) ｜ 性格：**${activePet.trait}**`,
      `❤️ HP **${activePet.hp}** ｜ ⚔️ 攻击 **${activePet.atk}** ｜ 💨 速度 **${activePet.spd}** ｜ 💥 暴击 **${Math.round(activePet.critRate * 100)}%**`,
      `🏅 战绩：**${activePet.wins} 胜 ${activePet.losses} 负** ｜ 世界Boss助战 **+${Math.floor(activePet.atk * 0.5)}** 伤害`,
      `🍖 今日喂食：${activePet.lastFeedDate === today ? '✅ 已喂' : `⏰ 未喂 (${cfg.games.petFeedPrice}币)`} ｜ 🏋️ 训练：${trainRemain > 0 ? formatDurationZh(trainRemain) : '✅ 就绪'} ｜ 💼 打工：${workRemain > 0 ? formatDurationZh(workRemain) : '✅ 就绪'}`,
    );
  } else {
    lines.push('你还没有任何电子宠物，点击下方「抽盲盒」迎娶你的第一只搞怪伙伴！');
  }

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 电子宠物屋`, iconURL: actor.avatarUrl })
    .setTitle('🐾 盲盒电子宠物与养成')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '🌟 抽中 SR / SSR 稀有宠物将自动在当前频道发欧皇喜报！' })
    .setTimestamp();

  const components: MenuComponentRow[] = [
    buttonRow(
      makeButton('menu:pet:gacha', `🎁 抽盲盒(${cfg.games.petGachaPrice})`, ButtonStyle.Success),
      makeButton('menu:pet:feed', `🍖 喂食(${cfg.games.petFeedPrice})`, ButtonStyle.Primary, !activePet),
      makeButton('menu:pet:train', '🏋️ 训练(+XP)', ButtonStyle.Primary, !activePet),
      makeButton('menu:pet:work', '💼 宠物打工', ButtonStyle.Secondary, !activePet),
      makeButton('menu:modal:pet_rename', '✏️ 改名', ButtonStyle.Secondary, !activePet),
    ),
  ];

  if (pets.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('menu:pet_select')
          .setPlaceholder('🐾 切换出战 / 管理的宠物...')
          .addOptions(
            pets.slice(0, 25).map((p) => {
              const sp = PET_SPECIES_MAP.get(p.speciesKey);
              return new StringSelectMenuOptionBuilder()
                .setLabel(
                  truncateText(
                    `${p.isActive ? '⭐ ' : ''}${sp?.emoji ?? '🐾'} [${p.rarity}] ${p.nickname} (Lv.${p.level})`,
                    100,
                  ),
                )
                .setValue(String(p.id))
                .setDescription(`HP ${p.hp} / ATK ${p.atk} / SPD ${p.spd} · 性格:${p.trait}`);
            }),
          ),
      ),
    );
  }

  components.push(
    buttonRow(
      makeButton('menu:pet:release', '🕊️ 放生当前宠', ButtonStyle.Danger, !activePet),
      makeButton('menu:nav:pet_arena', '🏟️ 宠物斗兽场', ButtonStyle.Primary),
      makeButton('menu:nav:social_hub', '💞 关系宠物', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

export function buildPetArenaView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const activePet = ctx.services.socialPet.getActivePet(guildId, actor.id);
  const sp = activePet ? PET_SPECIES_MAP.get(activePet.speciesKey) : undefined;

  const petLine = activePet
    ? `⭐ 当前出战宠物：${sp?.emoji ?? '🐾'} **${activePet.nickname}** ${RARITY_BADGE[activePet.rarity] ?? ''} Lv.${activePet.level}\n❤️ HP **${activePet.hp}** ｜ ⚔️ ATK **${activePet.atk}** ｜ 💨 SPD **${activePet.spd}** ｜ 🏅 ${activePet.wins}胜/${activePet.losses}负`
    : '⚠️ 你当前没有出战宠物，请先去「盲盒与宠物屋」抽取至少一只宠物！';

  const description = [
    `${cfg.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.currencyName}`,
    '',
    petLine,
    '',
    '🏟️ **斗兽场规则**：最多 12 回合自动回合制比拼，速度高者先手，含暴击与闪避机制，胜者赢走赌注且宠物获得更多经验升级！',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.ERROR, feedback))
    .setAuthor({ name: `${actor.displayName} · 宠物斗兽场`, iconURL: actor.avatarUrl })
    .setTitle('🏟️ 公开宠物斗兽场 PVP')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 发起定向约战或公开摆擂台都会在当前频道发出战报卡' })
    .setTimestamp();

  const userRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:pet_battle')
      .setPlaceholder('⚔️ 选择一位群友发起宠物一对一对决...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  const btnRow = buttonRow(
    makeButton('menu:modal:pet_open_battle', '📢 全群公开摆擂台', ButtonStyle.Danger, !activePet),
    makeButton('menu:nav:pets', '🐾 返回宠物屋', ButtonStyle.Secondary),
    makeButton('menu:nav:social_hub', '💞 关系宠物', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [userRow, btnRow] };
}

export function buildProposalCard(
  proposal: RelationshipProposal,
  economyCfg: EconomyConfig,
): BuiltButtonMessage {
  const isMarriage = proposal.relType === 'marriage';
  const titleText = isMarriage ? '💍 全群浪漫求婚仪式' : '🍻 全群桃园结拜仪式';
  const actionDesc = isMarriage ? '单膝跪地，向' : '备好酒碗，诚邀';
  const verb = isMarriage ? '结为合法伴侣！' : '义结金兰成为死党！';

  if (proposal.status === 'pending') {
    const expUnix = Math.floor(proposal.expiresAt / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.FUN)
      .setTitle(titleText)
      .setDescription(
        [
          `<@${proposal.proposerId}> ${actionDesc} <@${proposal.targetId}> 发出邀请：愿与你${verb}`,
          `仪式花费：${economyCfg.currencyEmoji} **${proposal.cost}** ${economyCfg.currencyName}`,
          `⏳ 有效响应：<t:${expUnix}:R>`,
        ].join('\n'),
      )
      .setFooter({ text: `仪式编号 #${proposal.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(
            `sp:prop:accept:${proposal.id}`,
            isMarriage ? '💖 我愿意！' : '🍻 干了这碗！',
            ButtonStyle.Success,
          ),
          makeButton(`sp:prop:decline:${proposal.id}`, '💔 礼貌婉拒', ButtonStyle.Danger),
        ),
      ],
    };
  }

  if (proposal.status === 'accepted') {
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(isMarriage ? '💐 礼成！恭喜喜结良缘！' : '🔥 礼成！铁血结拜达成！')
      .setDescription(
        `🎉 全群见证：<@${proposal.proposerId}> 与 <@${proposal.targetId}> 正式${verb}\n快去 \`/菜单\` → 关系宠物里每日打卡涨亲密度领专属称号吧！`,
      )
      .setFooter({ text: `仪式编号 #${proposal.id}` })
      .setTimestamp();

    return { embeds: [embed], components: [] };
  }

  const isExpired = proposal.status === 'expired';
  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle(isExpired ? '⌛ 仪式邀请已过期' : '💔 仪式邀请已拒绝/取消')
    .setDescription(
      `<@${proposal.proposerId}> 对 <@${proposal.targetId}> 发起的邀请未成行，仪式花费 **${proposal.cost}** ${economyCfg.currencyName} 已自动退还。`,
    )
    .setFooter({ text: `仪式编号 #${proposal.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}

export function buildPetBattleCard(
  battle: PetBattle,
  challengerPet: UserPet | null,
  opponentPet: UserPet | null,
  economyCfg: EconomyConfig,
): BuiltButtonMessage {
  const cSp = challengerPet ? PET_SPECIES_MAP.get(challengerPet.speciesKey) : undefined;
  const oSp = opponentPet ? PET_SPECIES_MAP.get(opponentPet.speciesKey) : undefined;
  const cLabel = challengerPet
    ? `${cSp?.emoji ?? '🐾'} **${challengerPet.nickname}** [${challengerPet.rarity} Lv.${challengerPet.level}]`
    : '未知宠物';
  const oLabel = opponentPet
    ? `${oSp?.emoji ?? '🐾'} **${opponentPet.nickname}** [${opponentPet.rarity} Lv.${opponentPet.level}]`
    : '等待应战宠物';

  if (battle.status === 'pending') {
    const expUnix = Math.floor(battle.expiresAt / 1000);
    const targetText = battle.opponentId
      ? `<@${battle.challengerId}> 向 <@${battle.opponentId}> 发起宠物决斗！`
      : `<@${battle.challengerId}> 在全群公开发起宠物斗兽场擂台！任何人皆可上台接招！`;
    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle(`🏟️ 宠物斗兽场挑战 #${battle.id}`)
      .setDescription(
        [
          targetText,
          `⚔️ 守擂宠：${cLabel}`,
          `💰 赌注金额：${economyCfg.currencyEmoji} **${battle.bet}** ${economyCfg.currencyName}`,
          `⏳ 有效时间：<t:${expUnix}:R>`,
        ].join('\n'),
      )
      .setFooter({ text: `斗兽场 #${battle.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(`sp:petbattle:accept:${battle.id}`, '⚔️ 派宠出战！', ButtonStyle.Success),
          makeButton(`sp:petbattle:decline:${battle.id}`, '🏃 拒绝 / 撤擂', ButtonStyle.Danger),
        ),
      ],
    };
  }

  if (battle.status === 'completed') {
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`🏆 宠物斗兽场 #${battle.id} 决出胜负！`)
      .setDescription(
        truncateText(
          [
            `<@${battle.challengerId}>（${cLabel}） VS <@${battle.opponentId}>（${oLabel}）`,
            `🏆 **胜者：<@${battle.winnerId}>**${battle.bet > 0 ? ` 赢走 ${economyCfg.currencyEmoji} **+${battle.bet}** ${economyCfg.currencyName}！` : '（友谊切磋局）'}`,
            '',
            '**⚡ 战斗回放：**',
            ...(battle.logs.length > 0 ? battle.logs : ['一招制敌！']),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `斗兽场 #${battle.id}` })
      .setTimestamp();

    return { embeds: [embed], components: [] };
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle(battle.status === 'expired' ? `⌛ 宠物斗兽场 #${battle.id} 已过期` : `🏃 宠物斗兽场 #${battle.id} 已取消`)
    .setDescription(
      `<@${battle.challengerId}> 发起的宠物擂台（赌注 **${battle.bet}** ${economyCfg.currencyName}）已关闭。`,
    )
    .setFooter({ text: `斗兽场 #${battle.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}
