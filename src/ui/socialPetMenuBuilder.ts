import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { EconomyConfig } from '../config/defaults.js';
import {
  PET_BOSS_BONUS_CAP,
  PET_MAX_LEVEL,
  PET_PVP_DAILY_XP_CAP,
  PET_WORK_COOLDOWN_MS,
  PET_WORK_LEVEL_BONUS_CAP,
} from '../config/economyConstants.js';
import type {
  PetBattle,
  RelationshipProposal,
  UserPet,
} from '../db/repositories/socialPetRepo.js';
import { getDateKey } from '../services/economyService.js';
import {
  calculatePetReleaseRefund,
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
    .setFooter({ text: '📢 发起求婚/结拜与达成亲密度称号都会在当前频道广播' })
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
              const otherId = r.userA === actor.id ? r.userB : r.userA;
              const labelType = r.relType === 'marriage' ? '💍 伴侣' : '🍻 死党';
              const status = r.lastCheckinDate === today ? '今日已打卡' : '可打卡 +10~20';
              return new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(`#${r.id} ${labelType} <@${otherId}>（亲密度 ${r.affinity}）`, 100))
                .setValue(String(r.id))
                .setDescription(truncateText(`对方 ID:${otherId} · ${status}`, 100));
            }),
          ),
      ),
    );
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('menu:cp_dissolve')
          .setPlaceholder('💔 和平解除一段指定关系（需二次确认）...')
          .addOptions(
            sliced.map((r) => {
              const otherId = r.userA === actor.id ? r.userB : r.userA;
              const labelType = r.relType === 'marriage' ? '💍 伴侣' : '🍻 死党';
              return new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(`解除 #${r.id} ${labelType} <@${otherId}>（亲密度 ${r.affinity}）`, 100))
                .setValue(String(r.id))
                .setDescription(truncateText(`对方 ID:${otherId} · 点击进入二次确认（不扣资产）`, 100));
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

export function buildCpDissolveConfirmView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  relationshipId: number,
): BuiltMenuMessage {
  const rel = ctx.services.socialPet.getRelationshipById(relationshipId);
  if (!rel || rel.guildId !== guildId || (rel.userA !== actor.id && rel.userB !== actor.id)) {
    return buildCpView(
      ctx,
      guildId,
      actor,
      { type: 'error', text: '找不到该关系或你不是当事方。' },
      Date.now(),
    );
  }

  const otherId = rel.userA === actor.id ? rel.userB : rel.userA;
  const labelType = rel.relType === 'marriage' ? '💍 伴侣' : '🍻 死党';
  const embed = new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setAuthor({ name: `${actor.displayName} · 确认解除关系`, iconURL: actor.avatarUrl })
    .setTitle('⚠️ 二次确认：和平解除 CP 关系')
    .setDescription(
      [
        `你即将解除以下关系：`,
        `• 关系编号：**#${rel.id}**（${labelType}）`,
        `• 对方成员：<@${otherId}>（ID: \`${otherId}\`）`,
        `• 当前亲密度：**${rel.affinity}**`,
        '',
        '⚠️ **此操作不可撤销**，解除后亲密度记录将被清空（不会扣除双方个人财产，已解锁称号保留）。',
      ].join('\n'),
    )
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(`menu:cp:dissolve_confirm:${rel.id}`, '💔 确认解除关系', ButtonStyle.Danger),
        makeButton('menu:nav:cp', '❌ 取消返回', ButtonStyle.Secondary),
      ),
    ],
  };
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
    const isMaxLevel = activePet.level >= PET_MAX_LEVEL;
    const ratio = isMaxLevel ? 1 : activePet.xp / Math.max(1, needXp);
    const trainRemain =
      activePet.lastTrainAt > 0
        ? Math.max(0, activePet.lastTrainAt + 3600 * 1000 - nowMs)
        : 0;
    const lastWorkAt = Math.max(profile.lastPetWorkAt, activePet.lastWorkAt);
    const workRemain =
      lastWorkAt > 0 ? Math.max(0, lastWorkAt + PET_WORK_COOLDOWN_MS - nowMs) : 0;
    const bossAssist = Math.min(PET_BOSS_BONUS_CAP, Math.floor(activePet.atk * 0.5));
    const workBonus = Math.min(PET_WORK_LEVEL_BONUS_CAP, Math.max(0, activePet.level - 1) * 15);

    lines.push(
      `⭐ **当前出战：${sp?.emoji ?? '🐾'} ${activePet.nickname}** ${RARITY_BADGE[activePet.rarity] ?? ''}`,
      `Lv.**${activePet.level}/${PET_MAX_LEVEL}** \`${renderProgressBar(ratio, 10)}\` (${isMaxLevel ? 'MAX' : `${activePet.xp}/${needXp} XP`}) ｜ 性格：**${activePet.trait}**`,
      `❤️ HP **${activePet.hp}** ｜ ⚔️ 攻击 **${activePet.atk}** ｜ 💨 速度 **${activePet.spd}** ｜ 💥 暴击 **${Math.round(activePet.critRate * 100)}%**`,
      `🏅 战绩：**${activePet.wins} 胜 ${activePet.losses} 负** ｜ Boss 助战 **+${bossAssist}**（上限 ${PET_BOSS_BONUS_CAP}）｜ 打工等级加成 **+${workBonus}**`,
      `🍖 今日喂食：${activePet.lastFeedDate === today ? '✅ 已喂' : `⏰ 未喂 (${cfg.games.petFeedPrice} ${cfg.economy.currencyName})`} ｜ 🏋️ 训练：${trainRemain > 0 ? formatDurationZh(trainRemain) : '✅ 就绪'} ｜ 💼 打工（共享CD）：${workRemain > 0 ? formatDurationZh(workRemain) : '✅ 就绪'}`,
    );
  } else {
    lines.push('你还没有任何电子宠物，点击下方「抽盲盒」迎娶你的第一只搞怪伙伴！');
  }

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 电子宠物屋`, iconURL: actor.avatarUrl })
    .setTitle('🐾 盲盒电子宠物与养成')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '🌟 抽中 SSR 稀有宠物将自动在当前频道发欧皇喜报！宠物打工按用户共享 2 小时冷却' })
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

export function buildPetReleaseConfirmView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  petId: number,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const pet = ctx.services.socialPet.getPetById(petId);
  if (!pet || pet.guildId !== guildId || pet.ownerId !== actor.id) {
    return buildPetsView(
      ctx,
      guildId,
      actor,
      { type: 'error', text: '找不到该宠物。' },
      Date.now(),
    );
  }

  const sp = PET_SPECIES_MAP.get(pet.speciesKey);
  const refund = calculatePetReleaseRefund(pet.rarity, cfg.games.petGachaPrice);
  const embed = new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setAuthor({ name: `${actor.displayName} · 确认放生宠物`, iconURL: actor.avatarUrl })
    .setTitle('⚠️ 二次确认：放生电子宠物')
    .setDescription(
      [
        `你即将永久放生以下宠物：`,
        `• 宠物：${sp?.emoji ?? '🐾'} **${pet.nickname}** ${RARITY_BADGE[pet.rarity] ?? ''}（Lv.${pet.level}）`,
        `• 属性：HP **${pet.hp}** ｜ ATK **${pet.atk}** ｜ SPD **${pet.spd}** ｜ 战绩 ${pet.wins}胜/${pet.losses}负`,
        `• 遣散费返还：${cfg.economy.currencyEmoji} **+${refund}** ${cfg.economy.currencyName}`,
        '',
        '⚠️ **放生后无法找回**，请确认是否继续！',
      ].join('\n'),
    )
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(`menu:pet:release_confirm:${pet.id}`, '🕊️ 确认永久放生', ButtonStyle.Danger),
        makeButton('menu:nav:pets', '❌ 取消返回', ButtonStyle.Secondary),
      ),
    ],
  };
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
    `🏟️ **斗兽场规则**：最多 12 回合自动比拼（发起时冻结赌注，撤回/过期/平局原路退还）；0 ${cfg.currencyName} 友谊赛不获得经验，有赌注 PVP 每日经验上限 **${PET_PVP_DAILY_XP_CAP} XP**。`,
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
    const isOpenArena = !battle.opponentId;
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
          `💰 赌注金额：${economyCfg.currencyEmoji} **${battle.bet}** ${economyCfg.currencyName}${battle.bet > 0 ? '（发起方赌注已冻结）' : '（友谊赛不给 XP）'}`,
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
          makeButton(
            `sp:petbattle:decline:${battle.id}`,
            isOpenArena ? '🏃 撤回擂台（仅擂主）' : '🏃 拒绝 / 撤回',
            ButtonStyle.Danger,
          ),
        ),
      ],
    };
  }

  if (battle.status === 'completed') {
    const isDraw = !battle.winnerId;
    const resultLine = isDraw
      ? `🤝 **本场平局！**${battle.bet > 0 ? ` 双方赌注 ${economyCfg.currencyEmoji} **${battle.bet}** ${economyCfg.currencyName} 已原路退还！` : '（友谊切磋局）'}`
      : `🏆 **胜者：<@${battle.winnerId}>**${battle.bet > 0 ? ` 赢走 ${economyCfg.currencyEmoji} **+${battle.bet}** ${economyCfg.currencyName}！` : '（友谊切磋局）'}`;
    const embed = new EmbedBuilder()
      .setColor(isDraw ? COLORS.WARNING : COLORS.SUCCESS)
      .setTitle(
        isDraw
          ? `🤝 宠物斗兽场 #${battle.id} 战成平手！`
          : `🏆 宠物斗兽场 #${battle.id} 决出胜负！`,
      )
      .setDescription(
        truncateText(
          [
            `<@${battle.challengerId}>（${cLabel}） VS <@${battle.opponentId}>（${oLabel}）`,
            resultLine,
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
    .setTitle(
      battle.status === 'expired'
        ? `⌛ 宠物斗兽场 #${battle.id} 已过期`
        : `🏃 宠物斗兽场 #${battle.id} 已取消`,
    )
    .setDescription(
      `<@${battle.challengerId}> 发起的宠物擂台（赌注 **${battle.bet}** ${economyCfg.currencyName}）已关闭${battle.bet > 0 ? '，冻结赌注已原路退还' : ''}。`,
    )
    .setFooter({ text: `斗兽场 #${battle.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}
