import {
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import type { GuildConfig } from '../config/defaults.js';
import type { RpgClassKey, RpgDuelRulesMode, RpgItem } from '../db/repositories/rpgRepo.js';
import {
  formatAffixList,
  formatAffixTag,
  formatLegendaryEffect,
} from '../services/rpgAffixes.js';
import {
  DAILY_ARENA_FIGHTS,
  DAILY_COOP_TICKETS,
  GUARD_ELIXIR_PRICE,
  MAX_RPG_DUEL_BET,
  MIN_COOP_PARTY_SIZE,
  PROMO_PILL_PRICE,
  RARITY_META,
  RPG_CLASSES,
  RPG_CLASS_MAP,
  RPG_TIERS,
  computeHealInjuryCost,
  computeItemEffectiveStats,
  getArenaTierLabel,
  getRpgRealmInfo,
  type RpgRealmInfo,
} from '../services/rpgService.js';
import { COLORS, createErrorEmbed, type AppContext } from '../ui/embeds.js';
import type { MenuFeedback } from '../ui/menuShared.js';
import {
  RPG_SLOT_META,
  buildPublicTrialCard,
  buildRpgClassSwitchView,
  buildRpgCoopRaidCard,
  buildRpgCoopView,
  buildRpgDuelBetModal,
  buildRpgGearView,
  buildRpgHomeView,
  buildRpgPublicDuelCard,
  buildRpgPvpView,
  buildRpgTrialView,
  formatBpPercent,
  formatEffectiveStats,
  formatRpgItemDisplay,
} from '../ui/rpgMenuBuilder.js';
import {
  getActor,
  parseIntInRange,
  parsePositiveInt,
  resolveGameChatChannelId,
  respondFromModal,
  sendPublicBroadcast,
  sendToChannel,
  type MenuSupportedInteraction,
} from './menuHelpers.js';

const VALID_CLASS_KEYS: ReadonlySet<string> = new Set<RpgClassKey>([
  'warrior',
  'mage',
  'ranger',
  'paladin',
]);

function isRpgClassKey(raw: string | undefined): raw is RpgClassKey {
  return typeof raw === 'string' && VALID_CLASS_KEYS.has(raw);
}

function isDuelRulesMode(raw: string | undefined): raw is RpgDuelRulesMode {
  return raw === 'full' || raw === 'equalized';
}

function parseLockAffixArg(raw: string | undefined): number | null {
  if (!raw || raw === 'none') return null;
  if (!/^\d+$/.test(raw)) return null;
  const num = Number(raw);
  return Number.isSafeInteger(num) && num >= 0 && num <= 2 ? num : null;
}

async function sendToGameChat(
  interaction: MenuSupportedInteraction,
  ctx: AppContext,
  cfg: GuildConfig,
  payload: MessageCreateOptions,
): Promise<{ sent: boolean; channelId: string | null; messageId: string | null }> {
  const targetChannelId = resolveGameChatChannelId(
    interaction.guild,
    cfg,
    ctx.repos.guildConfig,
  );
  if (!targetChannelId) {
    return { sent: false, channelId: null, messageId: null };
  }
  const safePayload: MessageCreateOptions = {
    ...payload,
    allowedMentions: payload.allowedMentions ?? { parse: ['users'] },
  };
  const msgId = await sendToChannel(
    interaction.client,
    targetChannelId,
    safePayload,
    interaction.guild,
  );
  if (msgId) {
    return { sent: true, channelId: targetChannelId, messageId: msgId };
  }
  // Unit-test fallback when mock client.channels lacks cache, strictly only if current channel IS #游戏聊天
  if (targetChannelId === interaction.channelId) {
    const res = await sendPublicBroadcast(interaction, safePayload);
    return { sent: res.sent, channelId: targetChannelId, messageId: res.messageId };
  }
  return { sent: false, channelId: targetChannelId, messageId: null };
}

function formatLootNotes(input: {
  legendaryAndEpicPreviewItems: readonly RpgItem[];
  autoSalvagedCount: number;
  autoSalvagedCoins: number;
  autoSalvagedDust?: number;
  pillsFound: number;
  elixirsFound: number;
  currencyEmoji: string;
}): string[] {
  const notes: string[] = [];
  if (input.pillsFound > 0 || input.elixirsFound > 0) {
    const parts: string[] = [];
    if (input.pillsFound > 0) parts.push(`🧪 晋升秘药×${input.pillsFound}`);
    if (input.elixirsFound > 0) parts.push(`🛡️ 护魂圣水×${input.elixirsFound}`);
    notes.push(`⚗️ 炼金收获：${parts.join('、')}`);
  }
  if (input.legendaryAndEpicPreviewItems.length > 0) {
    const preview = input.legendaryAndEpicPreviewItems
      .slice(0, 3)
      .map((item) => {
        const legTag = item.legendaryEffect
          ? ` ${formatLegendaryEffect(item.legendaryEffect, false)}`
          : '';
        return `${formatRpgItemDisplay(item)}${legTag}`;
      })
      .join('、');
    const extra =
      input.legendaryAndEpicPreviewItems.length > 3
        ? ` 等共 **${input.legendaryAndEpicPreviewItems.length}** 件`
        : '';
    notes.push(`🎁 获得装备：${preview}${extra}`);
  }
  if (input.autoSalvagedCount > 0) {
    const dustPart =
      input.autoSalvagedDust && input.autoSalvagedDust > 0
        ? ` / ✨ +${input.autoSalvagedDust} 魔尘`
        : '';
    notes.push(
      `♻️ 背包满自动分解 **${input.autoSalvagedCount}** 件多余装备（+${input.autoSalvagedCoins} ${input.currencyEmoji}${dustPart}）`,
    );
  }
  return notes;
}

function buildLegendaryDropPublicEmbed(input: {
  userId: string;
  sourceLabel: string;
  legendaryDrops: readonly RpgItem[];
  realm: RpgRealmInfo;
}): EmbedBuilder {
  const dropLines = input.legendaryDrops.slice(0, 3).map((item) => {
    const effStr = formatEffectiveStats(computeItemEffectiveStats(item));
    const affixStr = item.affixes.length > 0 ? ` ｜ ${formatAffixList(item.affixes)}` : '';
    const legStr = item.legendaryEffect
      ? `\n> 🟧 ${formatLegendaryEffect(item.legendaryEffect, true)}`
      : '';
    return `> ${formatRpgItemDisplay(item)}（${effStr}${affixStr}）${legStr}`;
  });
  return new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('🟧 传说神装降临 · 欧皇闪耀全服！')
    .setDescription(
      [
        `🎊 <@${input.userId}>（${input.realm.fullLabel}）在 **${input.sourceLabel}** 中斩获传说级橙装！`,
        '',
        '**🟧 传说掉落：**',
        ...dropLines,
      ].join('\n'),
    )
    .setTimestamp();
}

function buildBreakthroughCelebrationEmbed(input: {
  userId: string;
  fromRealm: RpgRealmInfo;
  toRealm: RpgRealmInfo;
  grossCoins: number;
  currencyEmoji: string;
  currencyName: string;
  isPublicTrial: boolean;
  supportersCount?: number;
}): EmbedBuilder {
  const descLines = [
    `🎊 恭喜 <@${input.userId}> 冲破重重雷劫，正式从 **${input.fromRealm.fullLabel}** 晋升为 **${input.toRealm.fullLabel}**！`,
    `${input.currencyEmoji} 晋升赏金：**+${input.grossCoins.toLocaleString('en-US')}** ${input.currencyName} ｜ 🔓 已解锁全新挂机秘境「**${input.toRealm.tierDef.zoneEmoji} ${input.toRealm.tierDef.zoneName}**」！`,
  ];
  if (input.isPublicTrial && input.supportersCount && input.supportersCount > 0) {
    descLines.push(`🍬 **${input.supportersCount}** 位助威战友共同分享了晋升喜糖！`);
  }
  return new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('⚡ 境界晋升喜报 · 强者诞生！')
    .setDescription(descLines.join('\n'))
    .setTimestamp();
}

async function replyModuleDisabled(interaction: MenuSupportedInteraction): Promise<void> {
  await interaction.reply({
    embeds: [
      createErrorEmbed(
        '🚫 模块未开启',
        '当前服务器已关闭 **奇幻RPG秘境** 模块，请联系管理员通过 `/菜单` → 管理后台或 `/设置 开关模块` 开启。',
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleRpgButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (!cfg.modules.rpg) {
    await replyModuleDisabled(interaction);
    return;
  }

  const nowMs = Date.now();
  const parts = interaction.customId.split(':');
  const section = parts[1];
  const arg = parts[2];
  const subArg = parts[3];

  // ── Public Trial Multi-Player Buttons (#游戏聊天) ──
  if (section === 'trial_help' || section === 'trial_jeer') {
    const trialId = parsePositiveInt(arg ?? '');
    if (!trialId) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 无效试炼', '找不到该破境试炼编号。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const mode = section === 'trial_help' ? 'help' : 'jeer';
    const res = ctx.services.rpg.interactPublicTrial(trialId, interaction.user.id, mode, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该公开试炼记录。',
        already_resolved: '该场破境试炼已经结算结束！',
        own_trial: '不能给自己的破境试炼助威或起哄哦！',
        already_joined: '你已经参与过这场试炼的表态了，每人限一次。',
        supporters_full: '助威席位已满（最多 5 人）！',
        saboteurs_full: '起哄席位已满（最多 3 人）！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('⛔ 无法参与试炼', errMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      if (res.reason === 'already_resolved') {
        const latest = ctx.services.rpg.getTrialById(trialId);
        if (latest && typeof interaction.message?.edit === 'function') {
          await interaction.message
            .edit(buildPublicTrialCard(latest, cfg.economy, undefined, nowMs))
            .catch(() => undefined);
        }
      }
      return;
    }

    await interaction.update(buildPublicTrialCard(res.trial, cfg.economy, undefined, nowMs));
    return;
  }

  if (section === 'trial_settle') {
    const trialId = parsePositiveInt(arg ?? '');
    if (!trialId) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 无效试炼', '找不到该破境试炼编号。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const res = ctx.services.rpg.settlePublicTrial(trialId, interaction.user.id, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该破境试炼记录。',
        already_resolved: '该场试炼已经完成结算！',
        not_owner: '只有发起渡劫的勇者本人可以提前引动天劫（其他人请等待 60 秒自动结算）。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('⛔ 无法引动天劫', errMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      if (res.reason === 'already_resolved') {
        const latest = ctx.services.rpg.getTrialById(trialId);
        if (latest && typeof interaction.message?.edit === 'function') {
          await interaction.message
            .edit(buildPublicTrialCard(latest, cfg.economy, undefined, nowMs))
            .catch(() => undefined);
        }
      }
      return;
    }

    await interaction.update(
      buildPublicTrialCard(res.trial, cfg.economy, res.supporterPayouts, nowMs),
    );
    return;
  }

  // ── Public Duel Buttons (#游戏聊天) ──
  if (section === 'duel_accept' || section === 'duel_cancel') {
    const duelId = parsePositiveInt(arg ?? '');
    if (!duelId) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 无效战书', '找不到该公屏约战编号。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (section === 'duel_cancel') {
      const res = ctx.services.rpg.cancelPublicDuelAndRefund(duelId, interaction.user.id, nowMs);
      if (!res.ok) {
        const errMap: Record<typeof res.reason, string> = {
          not_found: '找不到该约战记录。',
          already_resolved: '该场约战已经结束或已撤回！',
          not_challenger: '只有发起战书的勇者本人才能撤回战书。',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('⛔ 无法撤回战书', errMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        if (res.reason === 'already_resolved') {
          const latest = ctx.services.rpg.getPublicDuelById(duelId);
          if (latest && typeof interaction.message?.edit === 'function') {
            await interaction.message
              .edit(buildRpgPublicDuelCard(latest, cfg.economy))
              .catch(() => undefined);
          }
        }
        return;
      }
      await interaction.update(buildRpgPublicDuelCard(res.duel, cfg.economy));
      return;
    }

    const res = ctx.services.rpg.acceptPublicDuel(duelId, interaction.user.id, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该约战记录。',
        already_resolved: '该场约战已经完成对决或已取消！',
        expired: '该战书已超过 10 分钟有效期，系统已自动退回押注。',
        own_duel: '不能接下自己发起的战书哦！',
        wrong_opponent: `这是一封指定挑战书，仅限 <@${res.expectedOpponentId ?? ''}> 拔剑应战！`,
        no_class_selected: '你尚未创建西幻 RPG 勇者角色，请先输入 `/冒险` 选择初始职业！',
        challenger_unavailable: '发起人角色状态不可用，无法开战。',
        deadbeat_blocked: '你当前存在逾期未还贷款，结清前禁止参与带赌注约战！',
        insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！应战需要 **${(res.required ?? 0).toLocaleString('en-US')}** ${cfg.economy.currencyName}。`,
      };
      await interaction.reply({
        embeds: [createErrorEmbed('⛔ 无法应战', errMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      if (res.reason === 'already_resolved' || res.reason === 'expired') {
        const latest = ctx.services.rpg.getPublicDuelById(duelId);
        if (latest && typeof interaction.message?.edit === 'function') {
          await interaction.message
            .edit(buildRpgPublicDuelCard(latest, cfg.economy))
            .catch(() => undefined);
        }
      }
      return;
    }

    await interaction.update(buildRpgPublicDuelCard(res.duel, cfg.economy));
    return;
  }

  // ── Public Co-op Raid Buttons (#游戏聊天) ──
  if (section === 'coop_join' || section === 'coop_launch') {
    const raidId = parsePositiveInt(arg ?? '');
    if (!raidId) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 无效团本', '找不到该集结团本编号。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (section === 'coop_join') {
      const res = ctx.services.rpg.joinCoopRaidLobby(raidId, interaction.user.id, nowMs);
      if (!res.ok) {
        const errMap: Record<typeof res.reason, string> = {
          not_found: '找不到该集结团本记录。',
          already_started_or_closed: '该车队已经发车或结束集结啦！',
          already_joined: '你已经在车队里了，等待队长或倒计时发车即可！',
          party_full: '车队 4 人席位已满，等下一班车吧！',
          no_class_selected: '你尚未创建西幻 RPG 勇者角色，请先输入 `/冒险` 选择初始职业！',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('⛔ 无法上车助战', errMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        if (res.reason === 'already_started_or_closed') {
          const latest = ctx.services.rpg.getCoopRaidById(raidId);
          if (latest && typeof interaction.message?.edit === 'function') {
            await interaction.message
              .edit(buildRpgCoopRaidCard(latest, cfg.economy))
              .catch(() => undefined);
          }
        }
        return;
      }

      await interaction.update(buildRpgCoopRaidCard(res.raid, cfg.economy));
      return;
    }

    const res = ctx.services.rpg.launchCoopRaid(raidId, interaction.user.id, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该集结团本记录。',
        already_resolved: '该团本车队已经发车结算完毕！',
        not_leader: '只有发起集结的队长可以手动提前发车（未满人时 3 分钟倒计时结束会自动征召佣兵发车）。',
        not_enough_members: `手动提前发车至少需要 **${res.minMembers ?? MIN_COOP_PARTY_SIZE}** 名真人队员（若无人加入，等待 3 分钟结束将自动补齐佣兵发车）！`,
      };
      await interaction.reply({
        embeds: [createErrorEmbed('⛔ 无法立即发车', errMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      if (res.reason === 'already_resolved') {
        const latest = ctx.services.rpg.getCoopRaidById(raidId);
        if (latest && typeof interaction.message?.edit === 'function') {
          await interaction.message
            .edit(buildRpgCoopRaidCard(latest, cfg.economy))
            .catch(() => undefined);
        }
      }
      return;
    }

    await interaction.update(buildRpgCoopRaidCard(res.raid, cfg.economy));

    if (res.legendaryDrops.length > 0) {
      const leaderChar = ctx.services.rpg.getOrCreateCharacter(guildId, res.raid.leaderId, nowMs);
      const dropEmbed = buildLegendaryDropPublicEmbed({
        userId: res.raid.leaderId,
        sourceLabel: `集结团本「${res.raid.bossName}」`,
        legendaryDrops: res.legendaryDrops,
        realm: getRpgRealmInfo(leaderChar.level),
      });
      await sendToGameChat(interaction, ctx, cfg, {
        content: `🟧 团本红光：<@${res.raid.leaderId}> 率队讨伐 **${res.raid.bossName}** 爆出传说神装！`,
        embeds: [dropEmbed],
      });
    }
    return;
  }

  // ── Open Public Duel Bet Modal ──
  if (section === 'duel_open') {
    const mode: RpgDuelRulesMode = isDuelRulesMode(arg) ? arg : 'full';
    await interaction.showModal(buildRpgDuelBetModal(mode, 'open', cfg.economy.currencyName));
    return;
  }

  const actor = getActor(interaction, ctx, guildId);

  // ── Navigation ──
  if (section === 'nav') {
    if (arg === 'trial') {
      await interaction.update(buildRpgTrialView(ctx, guildId, actor, undefined, nowMs));
      return;
    }
    if (arg === 'gear') {
      await interaction.update(buildRpgGearView(ctx, guildId, actor, null, undefined, nowMs));
      return;
    }
    if (arg === 'pvp') {
      await interaction.update(buildRpgPvpView(ctx, guildId, actor, undefined, nowMs));
      return;
    }
    if (arg === 'coop') {
      await interaction.update(buildRpgCoopView(ctx, guildId, actor, undefined, nowMs));
      return;
    }
    if (arg === 'class') {
      await interaction.update(buildRpgClassSwitchView(ctx, guildId, actor, undefined, nowMs));
      return;
    }
    await interaction.update(buildRpgHomeView(ctx, guildId, actor, undefined, nowMs));
    return;
  }

  // ── Arena Daily Stipend ──
  if (section === 'arena_claim') {
    const res = ctx.services.rpg.claimDailyArenaReward(guildId, actor.id, nowMs);
    if (!res.ok) {
      const msg =
        res.reason === 'no_class_selected'
          ? '请先选择初始职业后再领取天梯俸禄！'
          : '今日的天梯段位俸禄已经领取过了，明天再来吧！';
      await interaction.update(
        buildRpgPvpView(ctx, guildId, actor, { type: 'info', text: msg }, nowMs),
      );
      return;
    }

    await interaction.update(
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        {
          type: 'success',
          text: `🎁 **天梯每日俸禄领取成功！**（${res.tierLabel} · ${res.rating} 分）\n获得 ${cfg.economy.currencyEmoji} **+${res.netCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName} ＋ ✨ **+${res.dustEarned}** 奥术魔尘！`,
        },
        nowMs,
      ),
    );
    return;
  }

  // ── Co-op Raid Lobby Start ──
  if (section === 'coop_start') {
    const targetChannelId = resolveGameChatChannelId(
      interaction.guild,
      cfg,
      ctx.repos.guildConfig,
    );
    if (!targetChannelId) {
      await interaction.update(
        buildRpgCoopView(
          ctx,
          guildId,
          actor,
          {
            type: 'error',
            text: '⚠️ 未找到「#游戏聊天」频道，无法发起公屏集结团本，请联系管理员配置世界事件频道。',
          },
          nowMs,
        ),
      );
      return;
    }

    const started = ctx.services.rpg.startCoopRaidLobby(guildId, targetChannelId, actor.id, nowMs);
    if (!started.ok) {
      const errMap: Record<typeof started.reason, string> = {
        no_class_selected: '请先选择初始职业后再发起集结团本！',
        active_raid_exists: '你已有一支正在招募中的集结车队，请先前往 `#游戏聊天` 发车或等待结算！',
        no_coop_tickets: `今日队长发车券已用完（每日限 ${started.dailyLimit ?? DAILY_COOP_TICKETS} 次），你仍可在 \`#游戏聊天\` 无限次数免费上车助战群友！`,
      };
      await interaction.update(
        buildRpgCoopView(ctx, guildId, actor, { type: 'error', text: errMap[started.reason] }, nowMs),
      );
      return;
    }

    const card = buildRpgCoopRaidCard(started.raid, cfg.economy);
    const pub = await sendToGameChat(interaction, ctx, cfg, {
      content: `🐉 远征集结：<@${actor.id}> 发起了第 **${started.raid.tier}** 阶团本「**${started.raid.bossName}**」！点击下方按钮零消耗上车助战分魔尘！`,
      embeds: card.embeds,
      components: card.components,
    });

    if (!pub.sent || !pub.messageId) {
      ctx.services.rpg.cancelCoopRaidAndRefund(started.raid.id, nowMs);
      await interaction.update(
        buildRpgCoopView(
          ctx,
          guildId,
          actor,
          {
            type: 'error',
            text: `❌ 无法向 <#${targetChannelId}> 发送团本集结卡（已自动取消并退还今日发车券）。`,
          },
          nowMs,
        ),
      );
      return;
    }

    ctx.services.rpg.bindCoopRaidMessage(started.raid.id, pub.messageId, targetChannelId);
    await interaction.update(
      buildRpgCoopView(
        ctx,
        guildId,
        actor,
        {
          type: 'success',
          text: `🐉 集结招募卡已发送至 <#${targetChannelId}>！满 2 人即可提前发车，3 分钟后自动征召佣兵补位开打（今日余券 **${started.ticketsRemaining}/${DAILY_COOP_TICKETS}**）。`,
        },
        nowMs,
      ),
    );
    return;
  }

  // ── Pick / Switch Class ──
  if (section === 'pick_class') {
    if (!isRpgClassKey(arg)) {
      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: '无效的职业编号。' }, nowMs),
      );
      return;
    }
    const res = ctx.services.rpg.chooseOrSwitchClass(guildId, actor.id, arg, nowMs);
    if (!res.ok) {
      const rpgCfg = ctx.services.rpg.getConfig(guildId);
      const errMap: Record<typeof res.reason, string> = {
        same_class: '你当前已经是这个职业了，无需重复转职。',
        pending_trial: '当前有公开破境试炼进行中，需等待结算后再转职！',
        insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！转职需要 **${res.cost ?? rpgCfg.classSwitchCost}** ${cfg.economy.currencyName}。`,
      };
      await interaction.update(
        buildRpgClassSwitchView(ctx, guildId, actor, { type: 'error', text: errMap[res.reason] }, nowMs),
      );
      return;
    }

    const cls = RPG_CLASS_MAP.get(arg)!;
    const text = res.isFirstSelection
      ? `🎉 你已正式成为 **${cls.emoji} ${cls.name}**！快去领取挂机经验、挑战深渊或参与团本吧！`
      : `🔄 转职成功！你已成为 **${cls.emoji} ${cls.name}**（消耗 ${cfg.economy.currencyEmoji} **${res.cost}** ${cfg.economy.currencyName}，余额 **${res.balance}**）。`;

    await interaction.update(
      buildRpgHomeView(ctx, guildId, actor, { type: 'success', text }, nowMs),
    );
    return;
  }

  // ── Core Gameplay Actions ──
  if (section === 'act') {
    if (arg === 'claim_idle') {
      const res = ctx.services.rpg.claimIdleHarvest(guildId, actor.id, nowMs);
      if (!res.ok) {
        const msg =
          res.reason === 'no_class_selected'
            ? '请先选择初始职业再领取挂机收益！'
            : `挂机时间未满 1 分钟，还需等待 **${res.waitSeconds ?? 1}** 秒。`;
        await interaction.update(
          buildRpgHomeView(ctx, guildId, actor, { type: 'info', text: msg }, nowMs),
        );
        return;
      }

      const realm = getRpgRealmInfo(res.character.level);
      const dustTag = res.dustEarned > 0 ? ` ｜ ✨ **+${res.dustEarned}** 魔尘` : '';
      const summaryLines = [
        `🌾 **挂机收菜成功！**（战力加成 **${res.powerMultiplier.toFixed(2)}x**）`,
        `✨ 获得 **+${res.xpEarned.toLocaleString('en-US')} XP**${
          res.levelsGained > 0 ? `（🎉 突破至 **${realm.fullLabel}**！）` : ''
        } ｜ ${cfg.economy.currencyEmoji} **+${res.netCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName}${
          res.garnishedCoins > 0 ? `（含抵债 ${res.garnishedCoins}）` : ''
        }${dustTag}`,
      ];
      if (res.hitGate) {
        summaryLines.push('🔥 **九重瓶颈经验已满！** 请前往「⚡ 立即破境试炼」突破至下一阶！');
      }
      if (res.adventures.length > 0) {
        summaryLines.push(...res.adventures.slice(0, 2));
      }
      summaryLines.push(
        ...formatLootNotes({
          legendaryAndEpicPreviewItems: res.bankedItems,
          autoSalvagedCount: res.autoSalvagedCount,
          autoSalvagedCoins: res.autoSalvagedCoins,
          autoSalvagedDust: res.autoSalvagedDust,
          pillsFound: res.pillsFound,
          elixirsFound: res.elixirsFound,
          currencyEmoji: cfg.economy.currencyEmoji,
        }),
      );

      await interaction.update(
        buildRpgHomeView(
          ctx,
          guildId,
          actor,
          { type: 'success', text: summaryLines.join('\n') },
          nowMs,
        ),
      );

      if (res.legendaryDrops.length > 0) {
        const dropEmbed = buildLegendaryDropPublicEmbed({
          userId: actor.id,
          sourceLabel: `${realm.tierDef.zoneName} 挂机奇遇`,
          legendaryDrops: res.legendaryDrops,
          realm,
        });
        await sendToGameChat(interaction, ctx, cfg, {
          content: `🟧 欧皇现世：<@${actor.id}> 在挂机探索中拾取传说装备！`,
          embeds: [dropEmbed],
        });
      }
      return;
    }

    if (arg === 'raid_one' || arg === 'raid_all') {
      const mode = arg === 'raid_all' ? 'all' : 'single';
      const res = ctx.services.rpg.raidBoss(guildId, actor.id, mode, nowMs);
      if (!res.ok) {
        const msg =
          res.reason === 'no_class_selected'
            ? '请先选择初始职业后再挑战秘境 Boss！'
            : '⚡ 体力不足！可每日凌晨自动回满，或点击下方「🧪 买体力药」补充体力。';
        await interaction.update(
          buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: msg }, nowMs),
        );
        return;
      }

      const realm = getRpgRealmInfo(res.character.level);
      const summaryLines = [
        `${res.tierDef.bossEmoji} **${res.runsExecuted > 1 ? `扫荡 ${res.runsExecuted} 次` : '速刷'}「${res.tierDef.bossName}」胜利！**（第 ${res.roundsPlayed} 回合斩杀 · 评级 **${res.rating}**）`,
        `✨ **+${res.xpEarned.toLocaleString('en-US')} XP**${
          res.levelsGained > 0 ? `（🎉 升至 **${realm.fullLabel}**！）` : ''
        } ｜ ${cfg.economy.currencyEmoji} **+${res.netCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName}${
          res.garnishedCoins > 0 ? `（含抵债 ${res.garnishedCoins}）` : ''
        } ｜ ✨ **+${res.dustEarned}** 奥术魔尘`,
      ];
      if (res.highlights.length > 0) {
        summaryLines.push(...res.highlights.slice(0, 3));
      }
      if (res.hitGate) {
        summaryLines.push('🔥 **九重瓶颈经验已满！** 请点击「⚡ 立即破境试炼」进阶！');
      }
      summaryLines.push(
        ...formatLootNotes({
          legendaryAndEpicPreviewItems: res.bankedItems,
          autoSalvagedCount: res.autoSalvagedCount,
          autoSalvagedCoins: res.autoSalvagedCoins,
          autoSalvagedDust: res.autoSalvagedDust,
          pillsFound: res.pillsFound,
          elixirsFound: res.elixirsFound,
          currencyEmoji: cfg.economy.currencyEmoji,
        }),
      );

      await interaction.update(
        buildRpgHomeView(
          ctx,
          guildId,
          actor,
          { type: 'success', text: summaryLines.join('\n') },
          nowMs,
        ),
      );

      if (res.legendaryDrops.length > 0) {
        const dropEmbed = buildLegendaryDropPublicEmbed({
          userId: actor.id,
          sourceLabel: `速刷 ${res.tierDef.bossName}`,
          legendaryDrops: res.legendaryDrops,
          realm,
        });
        await sendToGameChat(interaction, ctx, cfg, {
          content: `🟧 神装降临：<@${actor.id}> 击杀 **${res.tierDef.bossName}** 爆出传说装备！`,
          embeds: [dropEmbed],
        });
      }
      return;
    }

    if (arg === 'abyss') {
      const res = ctx.services.rpg.challengeAbyssBoss(guildId, actor.id, nowMs);
      if (!res.ok) {
        const msg =
          res.reason === 'no_class_selected'
            ? '请先选择初始职业后再挑战深渊领主！'
            : '⚡ 体力不足！已通关的本阶深渊需要 1 点体力（未首通的新阶深渊免体力挑战）。';
        await interaction.update(
          buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: msg }, nowMs),
        );
        return;
      }

      if (!res.won) {
        const failLines = [
          `💀 **深渊挑战失利…** 鏖战 **${res.roundsPlayed}** 回合未能击败「**${res.bossName}**」（剩余 HP **${res.bossRemainingHp}/${res.bossMaxHp}** · **本次未扣除体力**）！`,
          ...res.highlights.slice(0, 4),
          '💡 建议前往「🎒 铁匠与装备」强化装备或重铸嗜血/破甲/狂暴词条后再战！',
        ];
        await interaction.update(
          buildRpgHomeView(
            ctx,
            guildId,
            actor,
            { type: 'error', text: failLines.join('\n') },
            nowMs,
          ),
        );
        return;
      }

      const realm = getRpgRealmInfo(res.character.level);
      const clearBadge = res.isFirstClear
        ? '🏆 **本阶深渊首通达成！（0体力消耗）**'
        : '💀 **深渊领主讨伐胜利！**';
      const winLines = [
        `${clearBadge} 第 **${res.roundsPlayed}** 回合斩落「**${res.bossName}**」（评级 **${res.rating}**）`,
        `✨ **+${res.xpEarned.toLocaleString('en-US')} XP**${
          res.levelsGained > 0 ? `（🎉 升至 **${realm.fullLabel}**！）` : ''
        } ｜ ${cfg.economy.currencyEmoji} **+${res.netCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName} ｜ ✨ **+${res.dustEarned}** 奥术魔尘`,
        ...res.highlights.slice(0, 4),
        ...formatLootNotes({
          legendaryAndEpicPreviewItems: res.bankedItems,
          autoSalvagedCount: res.autoSalvagedCount,
          autoSalvagedCoins: res.autoSalvagedCoins,
          autoSalvagedDust: res.autoSalvagedDust,
          pillsFound: 0,
          elixirsFound: 0,
          currencyEmoji: cfg.economy.currencyEmoji,
        }),
      ];

      await interaction.update(
        buildRpgHomeView(
          ctx,
          guildId,
          actor,
          { type: 'success', text: winLines.join('\n') },
          nowMs,
        ),
      );

      if (res.legendaryDrops.length > 0) {
        const dropEmbed = buildLegendaryDropPublicEmbed({
          userId: actor.id,
          sourceLabel: `第 ${res.tier} 阶深渊领主「${res.bossName}」`,
          legendaryDrops: res.legendaryDrops,
          realm,
        });
        await sendToGameChat(interaction, ctx, cfg, {
          content: `🟧 深渊神装：<@${actor.id}> 征服深渊领主 **${res.bossName}** 斩获传说橙装！`,
          embeds: [dropEmbed],
        });
      }
      return;
    }

    if (arg === 'buy_stamina') {
      const res = ctx.services.rpg.buyStaminaPotion(guildId, actor.id, nowMs);
      if (res.ok) {
        await interaction.update(
          buildRpgHomeView(
            ctx,
            guildId,
            actor,
            {
              type: 'success',
              text: `🧪 购买体力药水成功！体力 **+1**（当前 **${res.character.stamina}**），消耗 ${cfg.economy.currencyEmoji} **${res.cost}**，今日还可购 **${res.buysRemaining}** 次。`,
            },
            nowMs,
          ),
        );
        return;
      }
      const rpgCfg = ctx.services.rpg.getConfig(guildId);
      const errText =
        res.reason === 'daily_limit_reached'
          ? `今日体力药水购买次数已达上限（${res.dailyLimit ?? rpgCfg.staminaPotionDailyLimit} 次），明日再买吧！`
          : `口袋 ${cfg.economy.currencyName} 不足！体力药水需要 **${res.cost ?? rpgCfg.staminaPotionPrice}** ${cfg.economy.currencyName}。`;
      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: errText }, nowMs),
      );
      return;
    }

    if (arg === 'heal_injury') {
      const res = ctx.services.rpg.healInjury(guildId, actor.id, nowMs);
      if (res.ok) {
        await interaction.update(
          buildRpgHomeView(
            ctx,
            guildId,
            actor,
            {
              type: 'success',
              text: `💚 **重伤已痊愈！** 消耗 ${cfg.economy.currencyEmoji} **${res.cost.toLocaleString('en-US')}** ${cfg.economy.currencyName}，秘境挂机收益已恢复 1.0x！`,
            },
            nowMs,
          ),
        );
        return;
      }
      const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
      const errText =
        res.reason === 'not_injured'
          ? '你当前状态健康，没有破境反噬重伤。'
          : `口袋 ${cfg.economy.currencyName} 不足！治愈重伤需要 **${res.cost ?? computeHealInjuryCost(character.level)}** ${cfg.economy.currencyName}。`;
      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: errText }, nowMs),
      );
      return;
    }

    if (arg === 'share_profile') {
      const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
      if (!character.classSelected) {
        await interaction.update(
          buildRpgHomeView(
            ctx,
            guildId,
            actor,
            { type: 'error', text: '请先选择初始职业后再晒出战绩！' },
            nowMs,
          ),
        );
        return;
      }
      const stats = ctx.services.rpg.computeCombatStats(guildId, actor.id, nowMs);
      const realm = getRpgRealmInfo(character.level);
      const cls = RPG_CLASS_MAP.get(character.classKey);
      const gearLines =
        stats.equippedItems.length > 0
          ? stats.equippedItems.map((it) => {
              const affixNote = it.affixes.length > 0 ? `（${formatAffixList(it.affixes)}）` : '';
              const legNote = it.legendaryEffect
                ? ` ${formatLegendaryEffect(it.legendaryEffect, false)}`
                : '';
              return `• ${RPG_SLOT_META[it.slot].emoji} ${formatRpgItemDisplay(it)}${affixNote}${legNote}`;
            })
          : ['• 暂无穿戴装备'];

      const cardEmbed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setAuthor({ name: `${actor.displayName} · 勇者档案名片`, iconURL: actor.avatarUrl })
        .setTitle(
          `${cls?.emoji ?? '⚔️'} ${cls?.name ?? '冒险者'} · ${realm.fullLabel}（Lv.${character.level}）`,
        )
        .setDescription(
          [
            `⚔️ 战力：**❤️ ${stats.maxHp}** ｜ **⚔️ ${stats.atk}** ｜ **🛡️ ${stats.def}** ｜ **💥 暴击 ${formatBpPercent(stats.critBp)}**`,
            `🏆 天梯分：**${character.arenaRating.toLocaleString('en-US')}**（${getArenaTierLabel(character.arenaRating)}） ｜ 💀 深渊：**第 ${character.abyssClearedTier}/${RPG_TIERS.length} 阶** ｜ ✨ 魔尘：**${character.arcaneDust.toLocaleString('en-US')}**`,
            `🌟 成功破境：**${character.totalBreakthroughs}** 次 ｜ 💀 击杀 Boss：**${character.totalBossKills}** 次`,
            '🎒 **神装词条构筑：**',
            ...gearLines,
          ].join('\n'),
        )
        .setTimestamp();

      const pub = await sendToGameChat(interaction, ctx, cfg, {
        content: `📣 <@${actor.id}> 晒出了西幻冒险者档案！`,
        embeds: [cardEmbed],
      });
      await interaction.update(
        buildRpgHomeView(
          ctx,
          guildId,
          actor,
          pub.sent
            ? {
                type: 'success',
                text: `📣 已将你的勇者档案广播至 <#${pub.channelId}>！`,
              }
            : {
                type: 'error',
                text: '⚠️ 未找到「#游戏聊天」频道或无发送权限，请联系管理员配置世界事件频道。',
              },
          nowMs,
        ),
      );
      return;
    }
  }

  // ── Alchemy Shop ──
  if (section === 'alchemy') {
    const kind = arg === 'buy_elixir' ? 'elixir' : 'pill';
    const res = ctx.services.rpg.buyAlchemyItem(guildId, actor.id, kind, nowMs);
    if (res.ok) {
      const label = kind === 'pill' ? '🧪 晋升秘药' : '🛡️ 护魂圣水';
      const stock = kind === 'pill' ? res.character.promoPills : res.character.guardElixirs;
      await interaction.update(
        buildRpgTrialView(
          ctx,
          guildId,
          actor,
          {
            type: 'success',
            text: `✅ 购入 ${label}×1 成功（库存 **${stock}**）！消耗 ${cfg.economy.currencyEmoji} **${res.cost.toLocaleString('en-US')}** ${cfg.economy.currencyName}，今日还可购 **${res.buysRemaining}** 次。`,
          },
          nowMs,
        ),
      );
      return;
    }
    const defaultPrice = kind === 'pill' ? PROMO_PILL_PRICE : GUARD_ELIXIR_PRICE;
    const errText =
      res.reason === 'daily_limit_reached'
        ? `该秘药今日购买次数已达上限（${res.dailyLimit ?? 0} 次）。`
        : `口袋 ${cfg.economy.currencyName} 不足！购买需要 **${(res.cost ?? defaultPrice).toLocaleString('en-US')}** ${cfg.economy.currencyName}。`;
    await interaction.update(
      buildRpgTrialView(ctx, guildId, actor, { type: 'error', text: errText }, nowMs),
    );
    return;
  }

  // ── Breakthrough Trial Configuration & Execution ──
  if (section === 'trial') {
    if (arg === 'cycle_pills' || arg === 'toggle_guard') {
      const action = arg === 'cycle_pills' ? 'cycle_pills' : 'toggle_guard';
      const res = ctx.services.rpg.configureTrialLoadout(guildId, actor.id, action, nowMs);
      if (!res.ok) {
        await interaction.update(
          buildRpgTrialView(
            ctx,
            guildId,
            actor,
            { type: 'error', text: '你背包里还没有 🛡️ 护魂圣水，请先在上方炼金工坊购买！' },
            nowMs,
          ),
        );
        return;
      }
      const feedbackText =
        action === 'cycle_pills'
          ? `💊 已调整上阵 🧪 晋升秘药为 **${res.character.trialPillsStaged}** 颗（成功率 +${res.character.trialPillsStaged * 12}%）。`
          : `🛡️ 已**${res.character.trialUseGuard ? '开启' : '关闭'}** 护魂圣水防护。`;
      await interaction.update(
        buildRpgTrialView(ctx, guildId, actor, { type: 'info', text: feedbackText }, nowMs),
      );
      return;
    }

    if (arg === 'solo') {
      const res = ctx.services.rpg.attemptSoloBreakthrough(guildId, actor.id, nowMs);
      if (!res.ok) {
        const errMap: Record<typeof res.reason, string> = {
          no_class_selected: '请先选择初始职业！',
          at_max_tier: '你已登临十阶神座巅峰，无需继续突破。',
          not_at_gate: '当前阶位九重经验尚未满额，请先挂机或速刷 Boss 攒够突破经验！',
          pending_trial_exists: '你有一场进行中的公开试炼，请先完成结算！',
        };
        await interaction.update(
          buildRpgTrialView(ctx, guildId, actor, { type: 'error', text: errMap[res.reason] }, nowMs),
        );
        return;
      }

      if (res.succeeded) {
        const text = [
          `⚡ **破境成功！** 你正式从 **${res.fromRealm.fullLabel}** 晋升为 **${res.toRealm.fullLabel}**（成功率 ${res.finalRatePct}%）！`,
          `${cfg.economy.currencyEmoji} 赏金 **+${res.netCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName} ｜ 📜 信用分 **+${res.creditDelta}** ｜ 🔓 已解锁「${res.toRealm.tierDef.zoneName}」`,
        ].join('\n');
        await interaction.update(
          buildRpgHomeView(ctx, guildId, actor, { type: 'success', text }, nowMs),
        );

        const celeb = buildBreakthroughCelebrationEmbed({
          userId: actor.id,
          fromRealm: res.fromRealm,
          toRealm: res.toRealm,
          grossCoins: res.grossCoins,
          currencyEmoji: cfg.economy.currencyEmoji,
          currencyName: cfg.economy.currencyName,
          isPublicTrial: false,
        });
        await sendToGameChat(interaction, ctx, cfg, {
          content: `⚡ 喜报：<@${actor.id}> 单人冲关成功，踏入 **${res.toRealm.fullLabel}**！`,
          embeds: [celeb],
        });
        return;
      }

      const failText = [
        `💥 **破境失败…** 雷劫失手（本次成功率 ${res.finalRatePct}%）。`,
        `📉 经验损耗 **-${res.xpLost.toLocaleString('en-US')} XP**${
          res.usedGuard
            ? '（🛡️ 护魂圣水生效：减免大量经验损失并免疫重伤！）'
            : ' ｜ 🤕 进入 **1小时重伤状态**（挂机收益 0.5x，可治愈）'
        }`,
        `🔥 已触发连败保底：当前累计保底 **+${res.character.breakthroughPity * 10}%**！`,
      ].join('\n');
      await interaction.update(
        buildRpgTrialView(ctx, guildId, actor, { type: 'error', text: failText }, nowMs),
      );
      return;
    }

    if (arg === 'public') {
      const targetChannelId = resolveGameChatChannelId(
        interaction.guild,
        cfg,
        ctx.repos.guildConfig,
      );
      if (!targetChannelId) {
        await interaction.update(
          buildRpgTrialView(
            ctx,
            guildId,
            actor,
            {
              type: 'error',
              text: '⚠️ 未找到「#游戏聊天」频道，无法发起公开渡劫试炼（你仍可使用「⚡ 单人立即破境」）。',
            },
            nowMs,
          ),
        );
        return;
      }

      const started = ctx.services.rpg.startPublicBreakthroughTrial(
        guildId,
        targetChannelId,
        actor.id,
        nowMs,
      );
      if (!started.ok) {
        const errMap: Record<typeof started.reason, string> = {
          no_class_selected: '请先选择初始职业！',
          at_max_tier: '你已登临十阶神座巅峰，无需继续突破。',
          not_at_gate: '当前阶位九重经验尚未满额，请先攒够突破经验！',
          pending_trial_exists: '你已有一场公开试炼正在进行中，请前往试炼卡片结算。',
        };
        await interaction.update(
          buildRpgTrialView(
            ctx,
            guildId,
            actor,
            { type: 'error', text: errMap[started.reason] },
            nowMs,
          ),
        );
        return;
      }

      const card = buildPublicTrialCard(started.trial, cfg.economy, undefined, nowMs);
      const pub = await sendToGameChat(interaction, ctx, cfg, {
        content: `🌩️ 天劫降临：<@${actor.id}> 在 <#${targetChannelId}> 发起了全服公开破境试炼！快来助威或起哄！`,
        embeds: card.embeds,
        components: card.components,
      });

      if (!pub.sent || !pub.messageId) {
        ctx.services.rpg.cancelPublicTrialAndRefund(started.trial.id, nowMs);
        await interaction.update(
          buildRpgTrialView(
            ctx,
            guildId,
            actor,
            {
              type: 'error',
              text: `❌ 无法向 <#${targetChannelId}> 发送试炼卡片（已自动取消试炼并全额退还秘药/圣水）。`,
            },
            nowMs,
          ),
        );
        return;
      }

      ctx.services.rpg.bindTrialMessage(started.trial.id, pub.messageId, targetChannelId);
      await interaction.update(
        buildRpgTrialView(
          ctx,
          guildId,
          actor,
          {
            type: 'success',
            text: `📣 公开试炼卡片已发送至 <#${targetChannelId}>！等待 60 秒全服围观，或直接去试炼卡片提前引动天劫！`,
          },
          nowMs,
        ),
      );
      return;
    }
  }

  // ── Batch gear shortcuts: equip best & bulk salvage ──
  if (section === 'gear_equip_best') {
    const res = ctx.services.rpg.equipBestGear(guildId, actor.id, nowMs);
    if (!res.ok) {
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          null,
          { type: 'error', text: '📭 背包里还没有装备，先去领挂机或刷 Boss 吧！' },
          nowMs,
        ),
      );
      return;
    }

    const feedback: MenuFeedback =
      res.changed.length > 0
        ? {
            type: 'success',
            text: `⚡ 一键换装完成（已按职业权重+词条评分优选）！已更换 **${res.changed.length}** 个部位：${res.changed
              .map((c) => `${RPG_SLOT_META[c.slot].emoji} ${formatRpgItemDisplay(c.item)}`)
              .join('、')}。`,
          }
        : {
            type: 'info',
            text: '✨ 你当前穿戴的已经是背包里契合当前职业评分最高的一套装备了！',
          };

    await interaction.update(
      buildRpgGearView(ctx, guildId, actor, res.changed[0]?.item.id ?? null, feedback, nowMs),
    );
    return;
  }

  if (section === 'gear_bulk_salvage') {
    const res = ctx.services.rpg.bulkSalvageItems(guildId, actor.id, 'uncommon', nowMs);
    if (!res.ok) {
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          null,
          { type: 'info', text: '🧹 背包里没有可拆解的未装备、未锁定普通/精良装备。' },
          nowMs,
        ),
      );
      return;
    }

    const breakdown: string[] = [];
    if (res.byRarity.common) breakdown.push(`${RARITY_META.common.label}×${res.byRarity.common}`);
    if (res.byRarity.uncommon) {
      breakdown.push(`${RARITY_META.uncommon.label}×${res.byRarity.uncommon}`);
    }
    const detail = breakdown.length > 0 ? `（${breakdown.join('、')}）` : '';

    await interaction.update(
      buildRpgGearView(
        ctx,
        guildId,
        actor,
        null,
        {
          type: 'success',
          text: `♻️ 一键拆解 **${res.salvagedCount}** 件白绿装${detail}，获得 ${cfg.economy.currencyEmoji} **+${res.totalCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName} ＋ ✨ **+${res.totalDust}** 奥术魔尘（当前魔尘 **${res.arcaneDust}**）！`,
        },
        nowMs,
      ),
    );
    return;
  }

  // ── Gear Forge: Cycle Lock Affix & Reforge ──
  if (section === 'gear_cycle_lock') {
    const itemId = parsePositiveInt(arg ?? '');
    const nextLockIdx = parseLockAffixArg(subArg);
    const label = nextLockIdx === null ? '不锁定任何词条' : `锁定第 ${nextLockIdx + 1} 条词条`;
    await interaction.update(
      buildRpgGearView(
        ctx,
        guildId,
        actor,
        itemId,
        { type: 'info', text: `🔒 已切换重铸策略为：**${label}**` },
        nowMs,
        nextLockIdx,
      ),
    );
    return;
  }

  if (section === 'gear_reforge') {
    const itemId = parsePositiveInt(arg ?? '');
    if (!itemId) {
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          null,
          { type: 'error', text: '无效的装备编号。' },
          nowMs,
        ),
      );
      return;
    }
    const lockIdx = parseLockAffixArg(subArg);
    const res = ctx.services.rpg.reforgeItemAffixes(guildId, actor.id, itemId, lockIdx, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该装备，可能已被拆解。',
        cannot_reforge_common: '普通品质装备没有随机词条槽位，无法重铸。',
        invalid_lock_index: '锁定的词条序号无效，已为你刷新面板。',
        insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！本次重铸需要 **${(res.costCoins ?? 0).toLocaleString('en-US')}** ${cfg.economy.currencyName}。`,
        insufficient_dust: `✨ 奥术魔尘不足！本次重铸需要 **${res.costDust ?? 0}** 魔尘（当前 **${res.currentDust ?? 0}**），可通过拆解装备、深渊、天梯或团本获取。`,
      };
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          itemId,
          { type: 'error', text: errMap[res.reason] },
          nowMs,
          lockIdx,
        ),
      );
      return;
    }

    const lockNote = res.lockedAffix ? `（已保留 ${formatAffixTag(res.lockedAffix)}）` : '';
    const preservedIdx = res.lockedAffix ? 0 : null;
    await interaction.update(
      buildRpgGearView(
        ctx,
        guildId,
        actor,
        res.item.id,
        {
          type: 'success',
          text: `✨ **重铸成功！** ${formatRpgItemDisplay(res.item)} 新词条：**${formatAffixList(res.item.affixes)}**${lockNote}\n消耗 ${cfg.economy.currencyEmoji} **${res.costCoins.toLocaleString('en-US')}** ＋ ✨ **${res.costDust}** 魔尘（剩余魔尘 **${res.arcaneDust}**）。`,
        },
        nowMs,
        preservedIdx,
      ),
    );
    return;
  }

  // ── Individual gear operations: equip / unequip / enhance / lock / salvage ──
  if (
    section === 'gear_equip' ||
    section === 'gear_unequip' ||
    section === 'gear_enhance' ||
    section === 'gear_lock' ||
    section === 'gear_salvage'
  ) {
    const itemId = parsePositiveInt(arg ?? '');
    if (!itemId) {
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          null,
          { type: 'error', text: '无效的装备编号。' },
          nowMs,
        ),
      );
      return;
    }

    if (section === 'gear_lock') {
      const res = ctx.services.rpg.toggleItemLock(guildId, actor.id, itemId);
      if (!res.ok) {
        await interaction.update(
          buildRpgGearView(
            ctx,
            guildId,
            actor,
            null,
            { type: 'error', text: '找不到该装备，可能已被拆解。' },
            nowMs,
          ),
        );
        return;
      }
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          res.item.id,
          {
            type: 'info',
            text: res.locked
              ? `🔒 已锁定 ${formatRpgItemDisplay(res.item)}（锁定期间无法单件拆解或被一键拆解波及）。`
              : `🔓 已解锁 ${formatRpgItemDisplay(res.item)}。`,
          },
          nowMs,
        ),
      );
      return;
    }

    if (section === 'gear_equip') {
      const res = ctx.services.rpg.equipItem(guildId, actor.id, itemId, nowMs);
      if (res.ok) {
        const swapNote = res.unequippedItem
          ? `（已自动换下 **${res.unequippedItem.name}**）`
          : '';
        await interaction.update(
          buildRpgGearView(
            ctx,
            guildId,
            actor,
            res.item.id,
            {
              type: 'success',
              text: `✅ 已装备 ${formatRpgItemDisplay(res.item)}${swapNote}！`,
            },
            nowMs,
          ),
        );
        return;
      }
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该装备，可能已被拆解。',
        already_equipped: '该装备已经穿戴在身上了。',
      };
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          itemId,
          { type: 'error', text: errMap[res.reason] },
          nowMs,
        ),
      );
      return;
    }

    if (section === 'gear_unequip') {
      const res = ctx.services.rpg.unequipItem(guildId, actor.id, itemId, nowMs);
      if (res.ok) {
        await interaction.update(
          buildRpgGearView(
            ctx,
            guildId,
            actor,
            res.item.id,
            { type: 'success', text: `⬇️ 已卸下 ${formatRpgItemDisplay(res.item)}，放回背包。` },
            nowMs,
          ),
        );
        return;
      }
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该装备。',
        not_equipped: '该装备当前并未穿戴。',
      };
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          itemId,
          { type: 'error', text: errMap[res.reason] },
          nowMs,
        ),
      );
      return;
    }

    if (section === 'gear_enhance') {
      const res = ctx.services.rpg.enhanceItem(guildId, actor.id, itemId, nowMs);
      if (res.ok) {
        const feedback: MenuFeedback = res.success
          ? {
              type: 'success',
              text: `🔨 强化成功！${formatRpgItemDisplay(res.item)} 全属性大幅提升！（花费 ${cfg.economy.currencyEmoji} **${res.cost}** ${cfg.economy.currencyName}，余额 **${res.balance}**）`,
            }
          : {
              type: 'error',
              text: `💨 强化失败… ${formatRpgItemDisplay(res.item)} 等级保持不变（装备完好无损；花费 ${cfg.economy.currencyEmoji} **${res.cost}** ${cfg.economy.currencyName}，成功率 ${Math.round(res.successRate * 100)}%，余额 **${res.balance}**）。`,
            };
        await interaction.update(
          buildRpgGearView(ctx, guildId, actor, res.item.id, feedback, nowMs),
        );
        return;
      }
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该装备。',
        max_enhance_level: '该装备已经强化至满级（+10），无法继续强化！',
        insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！强化需要 **${res.cost ?? 0}** ${cfg.economy.currencyName}。`,
      };
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          itemId,
          { type: 'error', text: errMap[res.reason] },
          nowMs,
        ),
      );
      return;
    }

    const res = ctx.services.rpg.salvageItem(guildId, actor.id, itemId, nowMs);
    if (res.ok) {
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          null,
          {
            type: 'success',
            text: `💰 已拆解 ${formatRpgItemDisplay(res.salvagedItem)}，获得 ${cfg.economy.currencyEmoji} **+${res.coinsEarned}** ${cfg.economy.currencyName} ＋ ✨ **+${res.dustEarned}** 奥术魔尘（当前余额 **${res.balance}**，魔尘 **${res.arcaneDust}**）。`,
          },
          nowMs,
        ),
      );
      return;
    }
    const errMap: Record<typeof res.reason, string> = {
      not_found: '找不到该装备，可能已被拆解。',
      item_equipped: '该装备正在穿戴中，请先点击「卸下」后再拆解！',
      item_locked: '🔒 该装备已锁定保护，请先点击「🔓 解锁装备」后再拆解！',
    };
    await interaction.update(
      buildRpgGearView(
        ctx,
        guildId,
        actor,
        itemId,
        { type: 'error', text: errMap[res.reason] },
        nowMs,
      ),
    );
    return;
  }

  await interaction.update(
    buildRpgHomeView(
      ctx,
      guildId,
      actor,
      { type: 'error', text: '未知的冒险操作，已为你刷新冒险大厅。' },
      nowMs,
    ),
  );
}

export async function handleRpgStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (!cfg.modules.rpg) {
    await replyModuleDisabled(interaction);
    return;
  }

  const actor = getActor(interaction, ctx, guildId);
  const nowMs = Date.now();
  const section = interaction.customId.split(':')[1];

  if (section === 'gear_select') {
    const selectedId = parsePositiveInt(interaction.values[0] ?? '');
    await interaction.update(buildRpgGearView(ctx, guildId, actor, selectedId, undefined, nowMs));
    return;
  }

  if (section === 'arena_fight') {
    const targetId = interaction.values[0] ?? '';
    const res = ctx.services.rpg.challengeArenaOpponent(guildId, actor.id, targetId, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        self_target: '不能在天梯中挑战自己的镜像哦！',
        no_class_selected: '请先选择初始职业后再参加天梯竞技！',
        daily_limit_reached: `今日免费天梯挑战已满 **${res.dailyLimit ?? DAILY_ARENA_FIGHTS}** 次，明天再来或试试 \`#游戏聊天\` 公屏约战吧！`,
        target_not_found: '未找到该勇者镜像，已为你刷新竞技场列表。',
      };
      await interaction.update(
        buildRpgPvpView(ctx, guildId, actor, { type: 'error', text: errMap[res.reason] }, nowMs),
      );
      return;
    }

    const deltaStr = res.ratingDelta >= 0 ? `+${res.ratingDelta}` : `${res.ratingDelta}`;
    const targetCls = RPG_CLASS_MAP.get(res.targetCharacter.classKey) ?? RPG_CLASSES[0]!;
    const headline = res.won
      ? `🏆 **天梯挑战胜利！** 第 **${res.report.roundsPlayed}** 回合击败 ${targetCls.emoji} <@${res.targetCharacter.userId}> 镜像（评级 **${res.report.rating}**）`
      : `⚔️ **天梯挑战惜败…** 鏖战 **${res.report.roundsPlayed}** 回合不敌 ${targetCls.emoji} <@${res.targetCharacter.userId}> 镜像`;
    const rewardLine = `📈 天梯积分：**${res.ratingBefore} → ${res.ratingAfter}**（**${deltaStr}**） ｜ ${cfg.economy.currencyEmoji} **+${res.netCoins.toLocaleString('en-US')}** ＋ ✨ **+${res.dustEarned}** 魔尘（今日余 **${res.fightsRemaining}/${DAILY_ARENA_FIGHTS}** 次）`;

    const summaryLines = [headline, rewardLine, ...res.highlights.slice(0, 5)];
    await interaction.update(
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        { type: res.won ? 'success' : 'info', text: summaryLines.join('\n') },
        nowMs,
      ),
    );
    return;
  }

  await interaction.update(
    buildRpgHomeView(
      ctx,
      guildId,
      actor,
      { type: 'error', text: '未知的冒险选择操作，已返回冒险大厅。' },
      nowMs,
    ),
  );
}

export async function handleRpgUserSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (!cfg.modules.rpg) {
    await replyModuleDisabled(interaction);
    return;
  }

  const [, section, rawMode] = interaction.customId.split(':');
  if (section !== 'duel_target') {
    const actor = getActor(interaction, ctx, guildId);
    await interaction.update(buildRpgPvpView(ctx, guildId, actor));
    return;
  }

  const targetId = interaction.values[0];
  const targetUser = targetId ? interaction.users.get(targetId) : undefined;
  if (!targetId || targetId === interaction.user.id) {
    await interaction.reply({
      embeds: [createErrorEmbed('⚠️ 无效约战对象', '不能向自己发起公屏约战哦！')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (targetUser?.bot) {
    await interaction.reply({
      embeds: [createErrorEmbed('⚠️ 无效约战对象', '不能向机器人发起约战，请选择真人勇者！')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mode: RpgDuelRulesMode = isDuelRulesMode(rawMode) ? rawMode : 'full';
  await interaction.showModal(buildRpgDuelBetModal(mode, targetId, cfg.economy.currencyName));
}

export async function handleRpgModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (!cfg.modules.rpg) {
    await replyModuleDisabled(interaction);
    return;
  }

  const nowMs = Date.now();
  const actor = getActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  // rpg:modal:duel:<mode>:<targetIdOrOpen>
  const modalKind = parts[2];
  const rawMode = parts[3];
  const targetToken = parts[4] ?? 'open';

  if (modalKind !== 'duel') {
    await respondFromModal(interaction, buildRpgHomeView(ctx, guildId, actor, undefined, nowMs));
    return;
  }

  const rulesMode: RpgDuelRulesMode = isDuelRulesMode(rawMode) ? rawMode : 'full';
  const rawBet = interaction.fields.getTextInputValue('bet_amount');
  const betAmount = parseIntInRange(rawBet, 0, MAX_RPG_DUEL_BET);
  if (betAmount === null) {
    await respondFromModal(
      interaction,
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        {
          type: 'error',
          text: `请输入有效的整数赌注（**0 ~ ${MAX_RPG_DUEL_BET.toLocaleString('en-US')}** ${cfg.economy.currencyName}，填 0 为荣誉切磋）。`,
        },
        nowMs,
      ),
    );
    return;
  }

  const targetChannelId = resolveGameChatChannelId(
    interaction.guild,
    cfg,
    ctx.repos.guildConfig,
  );
  if (!targetChannelId) {
    await respondFromModal(
      interaction,
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        {
          type: 'error',
          text: '⚠️ 未找到「#游戏聊天」频道，无法投递公屏战书（本次未扣除任何星币）。',
        },
        nowMs,
      ),
    );
    return;
  }

  const opponentId = targetToken === 'open' ? null : targetToken;
  const created = ctx.services.rpg.createPublicDuel({
    guildId,
    channelId: targetChannelId,
    challengerId: actor.id,
    opponentId,
    rulesMode,
    betAmount,
    nowMs,
  });

  if (!created.ok) {
    const errMap: Record<typeof created.reason, string> = {
      self_target: '不能向自己发起公屏约战！',
      invalid_bet_amount: `赌注金额须在 **0 ~ ${MAX_RPG_DUEL_BET.toLocaleString('en-US')}** 之间。`,
      no_class_selected: '请先选择初始职业后再发起约战！',
      pending_duel_exists: '你已有一封尚未结算的公屏战书，请先前往 `#游戏聊天` 完成或撤回！',
      deadbeat_blocked: '⚠️ 你当前存在逾期未还贷款，结清逾期欠款前禁止发起带赌注约战（你仍可填 0 发起无赌注荣誉切磋）！',
      insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！托管赌注需要 **${(created.required ?? betAmount).toLocaleString('en-US')}** ${cfg.economy.currencyName}。`,
    };
    await respondFromModal(
      interaction,
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        { type: 'error', text: errMap[created.reason] },
        nowMs,
      ),
    );
    return;
  }

  const card = buildRpgPublicDuelCard(created.duel, cfg.economy);
  const modeShort = rulesMode === 'equalized' ? '⚖️ 同阶拉平约战' : '🔥 满配神装约战';
  const mentionTarget = opponentId ? `向 <@${opponentId}> ` : '面向全服 ';
  const pub = await sendToGameChat(interaction, ctx, cfg, {
    content: `⚔️ 勇者战书：<@${actor.id}> ${mentionTarget}发起了 **${modeShort}**！`,
    embeds: card.embeds,
    components: card.components,
  });

  if (!pub.sent || !pub.messageId) {
    ctx.services.rpg.cancelPublicDuelAndRefund(created.duel.id, null, nowMs);
    await respondFromModal(
      interaction,
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        {
          type: 'error',
          text: `❌ 无法向 <#${targetChannelId}> 发送公屏战书（已自动撤回并全额退还托管押注）。`,
        },
        nowMs,
      ),
    );
    return;
  }

  ctx.services.rpg.bindPublicDuelMessage(created.duel.id, pub.messageId, targetChannelId);
  await respondFromModal(
    interaction,
    buildRpgPvpView(
      ctx,
      guildId,
      actor,
      {
        type: 'success',
        text: `📣 **${modeShort}**战书已发送至 <#${targetChannelId}>！10 分钟内无人应战将自动全额退还押注。`,
      },
      nowMs,
    ),
  );
}
