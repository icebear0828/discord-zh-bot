import { ButtonStyle, EmbedBuilder } from 'discord.js';
import type { EconomyConfig } from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import type { RpgRaid } from '../../db/repositories/rpgRepo.js';
import {
  DAILY_COOP_TICKETS,
  MAX_COOP_PARTY_SIZE,
  MIN_COOP_PARTY_SIZE,
  RPG_CLASSES,
  RPG_CLASS_MAP,
  RPG_TIERS,
  RPG_TIER_MAP,
  getRpgRealmInfo,
} from '../../services/rpgService.js';
import { COLORS, renderProgressBar } from '../embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuFeedback,
} from '../menuShared.js';
import { RPG_RARITY_BADGE } from './rpgFormatters.js';
import { buildClassOnboardingView } from './rpgHomeAndClassViews.js';

export function buildRpgCoopView(
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

  const realm = getRpgRealmInfo(character.level);
  const ticketsLeft = Math.max(0, DAILY_COOP_TICKETS - character.coopTicketsToday);
  const activeRaid = ctx.services.rpg.getRecruitingRaidForLeader(guildId, actor.id);

  const lines: string[] = [
    `🏅 当前境界：**${realm.fullLabel}**（Lv.${character.level}） ｜ ✨ 奥术魔尘：**${character.arcaneDust.toLocaleString('en-US')}**`,
    `🐉 本阶集结首领：**${realm.tierDef.bossEmoji} ${realm.tierDef.bossName}**（第 ${realm.tier} 阶团本）`,
    `🎫 今日队长发车券：**${ticketsLeft}/${DAILY_COOP_TICKETS}** 张 ｜ 🤝 上车助战他人：**每日不限次数（完全免费）**`,
  ];

  if (activeRaid) {
    const expSec = Math.floor(activeRaid.expiresAt / 1000);
    lines.push(
      '',
      `🔥 **你的团本车队 #${activeRaid.id} 正在集结中**：前往 <#${activeRaid.channelId}> 查看（当前 **${activeRaid.members.length}/${MAX_COOP_PARTY_SIZE}** 人，<t:${expSec}:R> 自动补齐佣兵发车）！`,
    );
  }

  lines.push(
    '',
    '📜 **2~4 人集结团本规则（#游戏聊天）**',
    `• **队长发车（日限 ${DAILY_COOP_TICKETS} 次）**：向 \`#游戏聊天\` 发送 3 分钟集结卡，满 **${MIN_COOP_PARTY_SIZE}** 人队长可提前立即发车，满 **${MAX_COOP_PARTY_SIZE}** 人激活高额满编羁绊增伤！`,
    '• **前排承伤 & 职业配合**：战士/圣骑士自动顶前排吸引火力，法师/游侠后排全力倾泻怒气大招；输出最高者荣膺 **🏅 MVP** 额外奖励魔尘！',
    '• **无限助战白嫖**：群友点击招募卡「⚔️ 上车助战」不扣任何体力或门票，通关共享协战星币与奥术魔尘；队长额外斩获本阶蓝/紫/橙词条装备！',
    '• **3分钟防鬼服兜底**：倒计时结束若真人不足 2 人，系统自动征召本服高战勇者「雇佣兵镜像」补齐席位照常开打，绝不流局！',
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.SUCCESS, feedback))
    .setAuthor({ name: `${actor.displayName} · 远征集结大厅`, iconURL: actor.avatarUrl })
    .setTitle('🐉 西幻 2~4 人集结团本大厅')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '集结招募卡仅投递至 #游戏聊天；发送失败将自动退还发车券' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(
          'rpg:coop_start',
          `🐉 发起集结团本 (余${ticketsLeft}/${DAILY_COOP_TICKETS})`,
          ButtonStyle.Success,
          ticketsLeft <= 0 || Boolean(activeRaid),
        ),
        makeButton('rpg:nav:coop', '🔄 刷新团本状态', ButtonStyle.Secondary),
      ),
      buttonRow(
        makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
        makeButton('rpg:nav:gear', '🎒 铁匠与装备', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildRpgCoopRaidCard(
  raid: RpgRaid,
  economy: EconomyConfig,
): BuiltButtonMessage {
  const tierDef = RPG_TIER_MAP.get(raid.tier) ?? RPG_TIERS[0]!;
  const hpRatio = raid.bossRemainingHp / Math.max(1, raid.bossMaxHp);

  const statusHeading =
    raid.status === 'recruiting'
      ? `📣 车队集结中 (${raid.members.length}/${MAX_COOP_PARTY_SIZE}) · 快来上车助战！`
      : raid.status === 'completed'
        ? '🎉 讨伐大捷 · 首领陨落！'
        : raid.status === 'failed'
          ? '💥 鏖战惜败 · 发放抚恤'
          : '⚪ 集结已取消';

  const color =
    raid.status === 'completed'
      ? COLORS.SUCCESS
      : raid.status === 'failed'
        ? COLORS.ERROR
        : raid.status === 'recruiting'
          ? COLORS.GOLD
          : COLORS.PRIMARY;

  const lines: string[] = [
    `${tierDef.bossEmoji} **第 ${raid.tier} 阶团本首领：${raid.bossName}**`,
    `❤️ 首领生命：\`${renderProgressBar(hpRatio, 12)}\` **${raid.bossRemainingHp.toLocaleString('en-US')} / ${raid.bossMaxHp.toLocaleString('en-US')} HP**`,
  ];

  if (raid.status === 'recruiting') {
    const expSec = Math.floor(raid.expiresAt / 1000);
    const memberTags = raid.members
      .map((uid) => (uid === raid.leaderId ? `👑 <@${uid}> *(队长)*` : `⚔️ <@${uid}>`))
      .join('、');
    lines.push(
      `👥 当前编队（**${raid.members.length}/${MAX_COOP_PARTY_SIZE}**）：${memberTags}`,
      `⏱️ 自动发车：<t:${expSec}:R>（满 ${MIN_COOP_PARTY_SIZE} 人队长可立即发车；超时不足 2 人自动征召佣兵补位！）`,
      `🎁 助战福利：点击下方「⚔️ 上车助战」零消耗白嫖 ${economy.currencyName} 与 ✨ 奥术魔尘！`,
    );
  } else {
    if (raid.resultSummary) {
      lines.push('', `📜 **战局结果**：${raid.resultSummary}`);
    }

    if (raid.payouts.length > 0) {
      lines.push('', '👥 **远征小队战绩 & 掉落分配**：');
      for (const p of raid.payouts) {
        const cls = RPG_CLASS_MAP.get(p.classKey) ?? RPG_CLASSES[0]!;
        const actorTag = p.isMercenary ? `🤖 **${p.name}** *(佣兵镜像)*` : `<@${p.userId}>`;
        const badges = [
          p.isLeader ? '👑队长' : '',
          p.isMvp ? '🏅MVP' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const badgeStr = badges ? ` [${badges}]` : '';
        const dropTags =
          p.itemsDropped.length > 0
            ? ` ｜ 🎁 ${p.itemsDropped.map((d) => `${RPG_RARITY_BADGE[d.rarity].emoji}${d.name}`).join('、')}`
            : '';
        const rewardStr = p.isMercenary
          ? '协战镜像（无收益）'
          : `${economy.currencyEmoji}+${p.netCoins.toLocaleString('en-US')} · ✨+${p.dustEarned}尘${dropTags}`;
        lines.push(
          `• ${cls.emoji} ${actorTag}${badgeStr} — 输出 **${p.damageDealt.toLocaleString('en-US')}** / 承伤 **${p.damageTaken.toLocaleString('en-US')}** ｜ ${rewardStr}`,
        );
      }
    }

    if (raid.highlights.length > 0) {
      lines.push('', '🎬 **高光战斗纪实**：', ...raid.highlights.slice(0, 7).map((h) => `> ${h}`));
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🐉 远征集结团本 #${raid.id} — ${statusHeading}`)
    .setDescription(truncateText(lines.join('\n'), 4096))
    .setFooter({ text: '西幻 RPG 集结团本仅在 #游戏聊天 进行 · 助战每日不限次数' })
    .setTimestamp(raid.resolvedAt || raid.createdAt);

  if (raid.status !== 'recruiting') {
    return { embeds: [embed], components: [] };
  }

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(
          `rpg:coop_join:${raid.id}`,
          `⚔️ 上车助战 (${raid.members.length}/${MAX_COOP_PARTY_SIZE})`,
          ButtonStyle.Success,
          raid.members.length >= MAX_COOP_PARTY_SIZE,
        ),
        makeButton(
          `rpg:coop_launch:${raid.id}`,
          '🚀 立即发车 (队长)',
          ButtonStyle.Primary,
          raid.members.length < MIN_COOP_PARTY_SIZE,
        ),
      ),
    ],
  };
}
