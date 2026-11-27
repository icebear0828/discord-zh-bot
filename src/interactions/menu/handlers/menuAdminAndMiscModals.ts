import { MAX_COIN_AMOUNT } from '../../../config/economyConstants.js';
import { createSuccessEmbed } from '../../../ui/embeds.js';
import { buildRedPacketMessage } from '../../../ui/menuBuilder.js';
import {
  ADMIN_DENIED_FEEDBACK,
  SUPER_ADMIN_DENIED_FEEDBACK,
  isGuildSuperAdmin,
  parseIntInRange,
  parseNumberInRange,
  parsePositiveInt,
  sendPublicBroadcast,
} from '../../menuHelpers.js';
import { dispatchByAction, type ActionRouteTable } from '../subRouter.js';
import {
  deferModalForWrite,
  editModalPage,
  readOptionalModalField,
  replyModalPage,
  type MenuModalContext,
} from './menuSharedModalsAndParsers.js';

function isSuperAdmin(input: MenuModalContext): boolean {
  return Boolean(
    input.actor.isSuperAdmin || isGuildSuperAdmin(input.interaction, input.ctx, input.guildId),
  );
}

function getField(input: MenuModalContext, customId: string): string {
  return input.interaction.fields.getTextInputValue(customId);
}

async function handleAdminDailyModal(input: MenuModalContext): Promise<void> {
  const { ctx, guildId } = input;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const currencyName = getField(input, 'currencyName').trim();
  const currencyEmoji = getField(input, 'currencyEmoji').trim();
  const dailyBase = parseIntInRange(getField(input, 'dailyBase'), 0, 100_000);
  const dailyStreakBonus = parseIntInRange(getField(input, 'dailyStreakBonus'), 0, 50_000);
  const dailyMaxStreakBonus = parseIntInRange(getField(input, 'dailyMaxStreakBonus'), 0, 500_000);

  if (
    currencyName.length < 1 || currencyName.length > 16 ||
    currencyEmoji.length < 1 || currencyEmoji.length > 16 ||
    dailyBase === null || dailyStreakBonus === null || dailyMaxStreakBonus === null
  ) {
    await replyModalPage(input, { page: 'admin_econ' }, {
      type: 'error',
      text: '输入格式无效，请检查货币名称长度及各项整数范围。',
    });
    return;
  }

  ctx.repos.guildConfig.updateEconomy(guildId, {
    ...cfg.economy,
    currencyName,
    currencyEmoji,
    dailyBase,
    dailyStreakBonus,
    dailyMaxStreakBonus,
  });
  await replyModalPage(input, { page: 'admin_econ' }, {
    type: 'success',
    text: `已更新货币与签到参数：**${currencyName}**（${currencyEmoji}），基础 **${dailyBase}**。`,
  });
}

async function handleAdminWorkModal(input: MenuModalContext): Promise<void> {
  const { ctx, guildId } = input;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const workMin = parseIntInRange(getField(input, 'workMin'), 1, 100_000);
  const workMax = parseIntInRange(getField(input, 'workMax'), 1, 100_000);
  const workCooldownSec = parseIntInRange(getField(input, 'workCooldownSec'), 0, 86_400);

  if (workMin === null || workMax === null || workCooldownSec === null || workMin > workMax) {
    await replyModalPage(input, { page: 'admin_econ' }, {
      type: 'error',
      text: '打工参数无效：最低收益不能高于最高收益，冷却需在 0~86400 秒。',
    });
    return;
  }

  ctx.repos.guildConfig.updateEconomy(guildId, { ...cfg.economy, workMin, workMax, workCooldownSec });
  await replyModalPage(input, { page: 'admin_econ' }, {
    type: 'success',
    text: `已更新打工参数：收益 **${workMin} ~ ${workMax}**，冷却 **${workCooldownSec}** 秒。`,
  });
}

async function handleAdminRobModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId } = input;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const pct = parseNumberInRange(getField(input, 'robSuccessPct'), 5, 95);
  const rawBankPct = readOptionalModalField(interaction, 'robBankSuccessPct');
  const bankPct =
    rawBankPct.length > 0
      ? parseNumberInRange(rawBankPct, 1, 80)
      : Number((cfg.economy.robBankSuccessRate * 100).toFixed(2));
  const robCooldownSec = parseIntInRange(getField(input, 'robCooldownSec'), 0, 86_400);
  const robTargetShieldSec = parseIntInRange(getField(input, 'robTargetShieldSec'), 0, 86_400);

  if (pct === null || bankPct === null || robCooldownSec === null || robTargetShieldSec === null) {
    await replyModalPage(input, { page: 'admin_econ' }, {
      type: 'error',
      text: '抢钱参数无效：口袋成功率需 5~95%，金库成功率需 1~80%，冷却/护盾需为 0~86400 秒。',
    });
    return;
  }

  ctx.repos.guildConfig.updateEconomy(guildId, {
    ...cfg.economy,
    robSuccessRate: Number((pct / 100).toFixed(4)),
    robBankSuccessRate: Number((bankPct / 100).toFixed(4)),
    robCooldownSec,
    robTargetShieldSec,
  });
  await replyModalPage(input, { page: 'admin_econ' }, {
    type: 'success',
    text: `已更新抢钱参数：口袋成功率 **${pct}%**，银行金库成功率 **${bankPct}%**，冷却 **${robCooldownSec}s**，护盾 **${robTargetShieldSec}s**。`,
  });
}

async function handleAdminBankModal(input: MenuModalContext): Promise<void> {
  const { ctx, guildId } = input;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const pct = parseNumberInRange(getField(input, 'bankInterestPct'), 0.1, 50);
  const bankInterestMax = parseIntInRange(getField(input, 'bankInterestMax'), 1, 1_000_000_000);
  const bankInterestMinDeposit = parseIntInRange(getField(input, 'bankInterestMinDeposit'), 1, 1_000_000_000);

  if (pct === null || bankInterestMax === null || bankInterestMinDeposit === null) {
    await replyModalPage(input, { page: 'admin_econ' }, {
      type: 'error',
      text: '银行参数无效：日利率需为 0.1~50%，上限/起息额需为 1 ~ 1,000,000,000。',
    });
    return;
  }

  ctx.repos.guildConfig.updateEconomy(guildId, {
    ...cfg.economy,
    bankInterestRate: Number((pct / 100).toFixed(4)),
    bankInterestMax,
    bankInterestMinDeposit,
  });
  await replyModalPage(input, { page: 'admin_econ' }, {
    type: 'success',
    text: `已更新银行参数：日利率 **${pct}%**，每日上限 **${bankInterestMax}**，起息门槛 **${bankInterestMinDeposit}**。`,
  });
}

async function handleAdminXpModal(input: MenuModalContext): Promise<void> {
  const { ctx, guildId } = input;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const baseMinXp = parseIntInRange(getField(input, 'baseMinXp'), 1, 1000);
  const baseMaxXp = parseIntInRange(getField(input, 'baseMaxXp'), 1, 1000);
  const cooldownSec = parseIntInRange(getField(input, 'cooldownSec'), 0, 3600);
  const hourlyXpCap = parseIntInRange(getField(input, 'hourlyXpCap'), 0, 1_000_000);

  if (
    baseMinXp === null || baseMaxXp === null || cooldownSec === null || hourlyXpCap === null ||
    baseMinXp > baseMaxXp
  ) {
    await replyModalPage(input, { page: 'admin_lvl' }, {
      type: 'error',
      text: '经验参数无效：最小 XP 不能大于最大 XP，冷却需为 0~3600 秒。',
    });
    return;
  }

  ctx.repos.guildConfig.updateLeveling(guildId, {
    ...cfg.leveling,
    baseMinXp,
    baseMaxXp,
    cooldownSec,
    hourlyXpCap,
  });
  await replyModalPage(input, { page: 'admin_lvl' }, {
    type: 'success',
    text: `已更新发言经验：**${baseMinXp} ~ ${baseMaxXp}** XP，冷却 **${cooldownSec}s**，时限上限 **${hourlyXpCap}**。`,
  });
}

async function handleAdminHeatModal(input: MenuModalContext): Promise<void> {
  const { ctx, guildId } = input;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const heatWindowSec = parseIntInRange(getField(input, 'heatWindowSec'), 10, 3600);
  const rawHeatMax = parseNumberInRange(getField(input, 'heatMaxMultiplier'), 1, 5);
  const voiceXpPerMin = parseIntInRange(getField(input, 'voiceXpPerMin'), 0, 1000);
  const levelUpCoinReward = parseIntInRange(getField(input, 'levelUpCoinReward'), 0, 100_000);

  if (
    heatWindowSec === null || rawHeatMax === null ||
    voiceXpPerMin === null || levelUpCoinReward === null
  ) {
    await replyModalPage(input, { page: 'admin_lvl' }, {
      type: 'error',
      text: '热度/奖励参数无效，请检查倍率(1.0~5.0)和数值范围。',
    });
    return;
  }

  const heatMaxMultiplier = Number(rawHeatMax.toFixed(2));
  ctx.repos.guildConfig.updateLeveling(guildId, {
    ...cfg.leveling,
    heatWindowSec,
    heatMaxMultiplier,
    voiceXpPerMin,
    levelUpCoinReward,
  });
  await replyModalPage(input, { page: 'admin_lvl' }, {
    type: 'success',
    text: `已更新热度参数：窗口 **${heatWindowSec}s**，上限 **${heatMaxMultiplier}x**，语音 **${voiceXpPerMin}/分**，升级奖 **+${levelUpCoinReward}**。`,
  });
}

async function handleAdminGrantModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor, parts } = input;
  const targetId = parts[3];
  if (!targetId) return;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const amount = parseIntInRange(getField(input, 'amount'), -MAX_COIN_AMOUNT, MAX_COIN_AMOUNT);
  if (amount === null || amount === 0) {
    await replyModalPage(input, { page: 'admin_ops' }, {
      type: 'error',
      text: '请输入 -1,000,000,000 ~ 1,000,000,000 之间的非零整数。',
    });
    return;
  }

  if (amount > 0) await deferModalForWrite(interaction);
  const updated = ctx.repos.profile.addCoins(guildId, targetId, amount);
  if (amount > 0) {
    await sendPublicBroadcast(interaction, {
      content: `🎁 <@${targetId}> 收到管理员发放的${cfg.economy.currencyName}福利！`,
      embeds: [
        createSuccessEmbed(
          `🎁 管理员发放${cfg.economy.currencyName}`,
          `管理员 <@${actor.id}> 向 <@${targetId}> 发放了 ${cfg.economy.currencyEmoji} **+${amount}** ${cfg.economy.currencyName}！\n当前口袋现金：**${updated.coins}** ${cfg.economy.currencyName}`,
        ),
      ],
    });
    await editModalPage(input, { page: 'admin_ops' }, {
      type: 'success',
      text: `已向 <@${targetId}> 发放 **+${amount}** ${cfg.economy.currencyName}（当前现金 **${updated.coins}**）。`,
    });
    return;
  }

  await replyModalPage(input, { page: 'admin_ops' }, {
    type: 'success',
    text: `已从 <@${targetId}> 扣除 **${Math.abs(amount)}** ${cfg.economy.currencyName}（剩余现金 **${updated.coins}**）。`,
  });
}

async function handleAdminSetStatModal(input: MenuModalContext): Promise<void> {
  const { ctx, guildId, parts } = input;
  const targetId = parts[3];
  if (!targetId) return;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const value = parseIntInRange(getField(input, 'statValue'), 0, MAX_COIN_AMOUNT);
  if (value === null) {
    await replyModalPage(input, { page: 'admin_ops' }, { type: 'error', text: '请输入 0 ~ 1,000,000,000 之间的整数。' });
    return;
  }
  const updated = ctx.repos.profile.setStatValue(guildId, targetId, value);
  await replyModalPage(input, { page: 'admin_ops' }, {
    type: 'success',
    text: `✅ 已将 <@${targetId}> 的 **${cfg.leveling.statName}** 设为 **${updated.statValue}** ${cfg.leveling.statUnit}！`,
  });
}

async function handleAdminGrantAllModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor } = input;
  if (!isSuperAdmin(input)) {
    await replyModalPage(input, { page: 'admin_ops' }, SUPER_ADMIN_DENIED_FEEDBACK);
    return;
  }
  const amount = parseIntInRange(getField(input, 'amount'), 1, MAX_COIN_AMOUNT);
  if (amount === null) {
    await replyModalPage(input, { page: 'admin_ops' }, { type: 'error', text: '请输入 1 ~ 1,000,000,000 之间的正整数。' });
    return;
  }
  if (!interaction.guild) return;
  await deferModalForWrite(interaction);

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const members = await interaction.guild.members.fetch();
  const humanIds = [...members.values()].filter((m) => !m.user.bot).map((m) => m.id);
  ctx.db.transaction(() => {
    for (const uid of humanIds) ctx.repos.profile.addCoins(guildId, uid, amount);
  })();

  await sendPublicBroadcast(interaction, {
    embeds: [
      createSuccessEmbed(
        '🎉 全服福利发放！',
        `管理员 <@${actor.id}> 向全服 **${humanIds.length}** 位真实群友每人发放了 ${cfg.economy.currencyEmoji} **+${amount}** ${cfg.economy.currencyName}！`,
      ),
    ],
  });
  await editModalPage(input, { page: 'admin_ops' }, {
    type: 'success',
    text: `🎉 已向全服 **${humanIds.length}** 位群友每人发放 **+${amount}** ${cfg.economy.currencyName}！`,
  });
}

async function handleAdminRandomRedPacketModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor } = input;
  if (!isSuperAdmin(input)) {
    await replyModalPage(input, { page: 'admin_ops' }, SUPER_ADMIN_DENIED_FEEDBACK);
    return;
  }
  const totalAmount = parseIntInRange(getField(input, 'totalAmount'), 1, MAX_COIN_AMOUNT);
  const totalCount = parseIntInRange(getField(input, 'totalCount'), 1, 100);
  const greeting = readOptionalModalField(interaction, 'greeting') || '管理员天降随机大红包，见者有份！';

  if (totalAmount === null || totalCount === null || totalAmount < totalCount) {
    await replyModalPage(input, { page: 'admin_ops' }, {
      type: 'error',
      text: '随机红包参数无效：总金额需在 1 ~ 1,000,000,000 之间，份数 1 ~ 100，且总金额不能小于份数。',
    });
    return;
  }

  await deferModalForWrite(interaction);
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  let candidateIds: string[] = [];
  if (interaction.guild?.members?.fetch) {
    const fetched = await interaction.guild.members.fetch().catch(() => null);
    if (fetched) candidateIds = [...fetched.values()].filter((m) => !m.user?.bot).map((m) => m.id);
  }
  if (candidateIds.length === 0) {
    const rows = ctx.db
      .prepare('SELECT user_id FROM member_profiles WHERE guild_id = ? LIMIT 200')
      .all(guildId) as Array<{ user_id: string }>;
    candidateIds = rows.map((r) => r.user_id);
  }

  const res = ctx.services.multiplayer.distributeRandomRedPacket({
    guildId,
    candidateUserIds: candidateIds,
    totalAmount,
    count: totalCount,
  });
  if (!res.ok) {
    const errText =
      res.reason === 'no_candidates' ? '当前没有可派发红包的真实群友。' : '红包金额或份数参数超出有效范围。';
    await editModalPage(input, { page: 'admin_ops' }, { type: 'error', text: errText });
    return;
  }

  const shareLines = res.shares.slice(0, 30).map((s, idx) => {
    const crown = res.bestLuckUserId === s.userId ? '👑 ' : `${idx + 1}. `;
    return `${crown}<@${s.userId}> 随机分得 ${cfg.economy.currencyEmoji} **+${s.amount}** ${cfg.economy.currencyName}（余额 **${s.newBalance}**）`;
  });
  if (res.shares.length > 30) shareLines.push(`*…等共 ${res.shares.length} 位幸运群友*`);

  await sendPublicBroadcast(interaction, {
    content: `🧧 管理员 <@${actor.id}> 随机派发了 **${res.totalAmount}** ${cfg.economy.currencyName} 拼手气大红包（共 **${res.winnerCount}** 份）！`,
    embeds: [
      createSuccessEmbed(
        `🧧 ${greeting}`,
        [
          `派发管理员：<@${actor.id}>`,
          `红包总额：${cfg.economy.currencyEmoji} **${res.totalAmount}** ${cfg.economy.currencyName} ｜ 随机抽取：**${res.winnerCount}** 位群友`,
          `👑 **手气最佳**：<@${res.bestLuckUserId}>（独揽 **+${res.bestLuckAmount}** ${cfg.economy.currencyName}）`,
          '',
          '**🎲 随机派发明细：**',
          ...shareLines,
        ].join('\n'),
      ),
    ],
  });
  await editModalPage(input, { page: 'admin_ops' }, {
    type: 'success',
    text: `🎲 已随机抽取 **${res.winnerCount}** 位群友派发共计 **${res.totalAmount}** ${cfg.economy.currencyName}！手气最佳：<@${res.bestLuckUserId}>（+${res.bestLuckAmount}）。`,
  });
}

async function handleAdminSysRedPacketModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor } = input;
  if (!interaction.channel?.isSendable()) {
    await replyModalPage(input, { page: 'admin_ops' }, {
      type: 'error',
      text: '当前频道不支持发送公开红包卡片，请在普通文字频道操作。',
    });
    return;
  }

  const totalAmount = parsePositiveInt(getField(input, 'totalAmount'));
  const totalCount = parsePositiveInt(getField(input, 'totalCount'));
  const greeting = readOptionalModalField(interaction, 'greeting');
  if (!totalAmount || !totalCount) {
    await replyModalPage(input, { page: 'admin_ops' }, {
      type: 'error',
      text: '红包总金额与份数必须为正整数（份数 2 ~ 100，金额最高 10 亿）。',
    });
    return;
  }

  await deferModalForWrite(interaction);
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const res = ctx.services.multiplayer.createRedPacket({
    guildId,
    channelId: interaction.channel.id,
    senderId: actor.id,
    totalAmount,
    totalCount,
    greeting: greeting || '🎁 管理员福利拼手气大红包！',
    systemFunded: true,
  });
  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      invalid_count: '红包份数必须在 2 ~ 100 份之间。',
      invalid_amount: '红包总金额必须在 1 ~ 1,000,000,000 之间。',
      amount_too_small_for_count: `红包总金额不能小于红包份数（每份至少 1 ${cfg.economy.currencyName}）。`,
      insufficient_funds: '余额不足。',
    };
    await editModalPage(input, { page: 'admin_ops' }, { type: 'error', text: msgMap[res.reason] });
    return;
  }

  const sent = await sendPublicBroadcast(interaction, {
    content: `🧧 管理员 <@${actor.id}> 派发了 **${res.packet.totalAmount}** ${cfg.economy.currencyName} 的系统福利大红包（共 ${res.packet.totalCount} 份），快来抢！`,
    ...buildRedPacketMessage(res.packet, [], null, cfg.economy),
  });
  if (!sent.sent || !sent.messageId) {
    ctx.repos.redPacket.markExpired(res.packet.id);
    await editModalPage(input, { page: 'admin_ops' }, {
      type: 'error',
      text: '发送系统红包卡片失败，请检查机器人发言权限。',
    });
    return;
  }

  ctx.services.multiplayer.bindRedPacketMessage(res.packet.id, sent.messageId);
  await editModalPage(input, { page: 'admin_ops' }, {
    type: 'success',
    text: `🧧 系统福利抢红包已发出！总额 ${cfg.economy.currencyEmoji} **${res.packet.totalAmount}** ${cfg.economy.currencyName}（${res.packet.totalCount} 份，系统出资不扣个人余额）。`,
  });
}

const ADMIN_MODAL_ROUTES: ActionRouteTable<MenuModalContext> = {
  exact: {
    admin_daily: handleAdminDailyModal,
    admin_work: handleAdminWorkModal,
    admin_rob: handleAdminRobModal,
    admin_bank: handleAdminBankModal,
    admin_xp: handleAdminXpModal,
    admin_heat: handleAdminHeatModal,
    admin_grant: handleAdminGrantModal,
    admin_set_stat: handleAdminSetStatModal,
    admin_grant_all: handleAdminGrantAllModal,
    admin_random_redpacket: handleAdminRandomRedPacketModal,
    admin_sys_redpacket: handleAdminSysRedPacketModal,
  },
};

export async function tryHandleAdminAndMiscModal(input: MenuModalContext): Promise<boolean> {
  if (!input.modalType?.startsWith('admin_')) {
    return false;
  }
  if (!input.actor.isAdmin) {
    await replyModalPage(input, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
    return true;
  }
  return dispatchByAction(input.modalType, input, ADMIN_MODAL_ROUTES);
}
