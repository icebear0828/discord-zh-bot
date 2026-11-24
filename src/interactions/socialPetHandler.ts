import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { createErrorEmbed, createSuccessEmbed, type AppContext } from '../ui/embeds.js';
import { buildPetBattleCard, buildProposalCard } from '../ui/socialPetMenuBuilder.js';
import { sendPublicBroadcast } from './menuHelpers.js';

export async function handleSocialPetButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  const parts = interaction.customId.split(':');
  const category = parts[1];
  const action = parts[2];
  const targetId = Number(parts[3]);
  if (!Number.isInteger(targetId) || targetId <= 0) return;

  if (category === 'prop') {
    if (!cfg.modules.petsAndCp) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭关系与宠物模块。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'accept') {
      const res = ctx.services.socialPet.acceptProposal(targetId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildProposalCard(res.proposal, cfg.economy));
        await sendPublicBroadcast(interaction, {
          content:
            res.relationship.relType === 'marriage'
              ? `💐 恭喜 <@${res.proposal.proposerId}> 与 <@${res.proposal.targetId}> 喜结良缘，全群撒花祝贺！`
              : `🍻 恭喜 <@${res.proposal.proposerId}> 与 <@${res.proposal.targetId}> 正式结拜为铁血死党！`,
          embeds: [
            createSuccessEmbed(
              res.relationship.relType === 'marriage' ? '💍 全群喜讯：新婚快乐！' : '🍻 全群喜讯：义结金兰！',
              `<@${res.proposal.proposerId}> 与 <@${res.proposal.targetId}> 正式绑定关系（当前亲密度 **${res.relationship.affinity}**）！`,
            ),
          ],
        });
        return;
      }

      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这个仪式邀请记录。',
        not_target: '只有被邀请人本人才能点答应哦！',
        already_resolved: '这个邀请已经处理过啦！',
        expired: '这个仪式邀请已经超时过期（费用已自动退还）。',
        conflict_refunded: '双方之一已先绑定了其他关系冲突，仪式费用已自动退还发起人。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法答应', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });

      const latest = ctx.services.socialPet.getProposal(targetId);
      if (latest && latest.status !== 'pending') {
        await interaction.message.edit(buildProposalCard(latest, cfg.economy)).catch(() => undefined);
      }
      return;
    }

    if (action === 'decline') {
      const res = ctx.services.socialPet.declineProposal(targetId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildProposalCard(res.proposal, cfg.economy));
        return;
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这个仪式邀请。',
        not_participant: '只有邀请双方才能拒绝或撤回！',
        already_resolved: '这个邀请已经结束啦！',
        expired: '这个邀请已经超时过期（费用已退还）。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法拒绝', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = ctx.services.socialPet.getProposal(targetId);
      if (latest && latest.status !== 'pending') {
        await interaction.message.edit(buildProposalCard(latest, cfg.economy)).catch(() => undefined);
      }
      return;
    }
  }

  if (category === 'petbattle') {
    if (!cfg.modules.petsAndCp || !cfg.modules.economy) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭关系与宠物或经济系统。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'accept') {
      const res = ctx.services.socialPet.acceptPetBattle(targetId, interaction.user.id);
      if (res.ok) {
        await interaction.update(
          buildPetBattleCard(res.battle, res.challengerPet, res.opponentPet, cfg.economy),
        );
        return;
      }

      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这场宠物斗兽场对决。',
        already_resolved: '这场对决已经分出胜负或关闭啦！',
        expired: '这场宠物挑战已经超时过期。',
        not_opponent: '这是定向挑战，只有指定的对手才能应战！',
        cannot_accept_self: '不能和自己的宠物自己打自己！',
        no_active_pet: '你还没有宠物，先在 `/菜单` → 关系宠物里抽一只盲盒宠物吧！',
        challenger_no_pet: '挑战方的出战宠物已不在宠物屋，无法开战。',
        challenger_insufficient_funds: '发起人当前口袋现金不足支付赌注。',
        opponent_insufficient_funds: '你的口袋现金不足以支付本场赌注（银行存款不参与决斗）。',
        deadbeat_blocked: '参与方存在逾期未还贷款（失信老赖限制），还清逾期欠款前禁止进行带赌注斗兽场！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法出战', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });

      const latest = ctx.services.socialPet.getPetBattle(targetId);
      if (latest && latest.status !== 'pending') {
        const cPet = ctx.services.socialPet.getPetById(latest.challengerPetId);
        const oPet = latest.opponentPetId
          ? ctx.services.socialPet.getPetById(latest.opponentPetId)
          : null;
        await interaction.message
          .edit(buildPetBattleCard(latest, cPet, oPet, cfg.economy))
          .catch(() => undefined);
      }
      return;
    }

    if (action === 'decline') {
      const res = ctx.services.socialPet.declinePetBattle(targetId, interaction.user.id);
      if (res.ok) {
        const cPet = ctx.services.socialPet.getPetById(res.battle.challengerPetId);
        await interaction.update(buildPetBattleCard(res.battle, cPet, null, cfg.economy));
        return;
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这场宠物对决。',
        not_participant: '只有挑战方或指定对手才能取消/拒绝本场挑战！',
        already_resolved: '这场对决已经结束啦！',
        expired: '这场对决已经超时过期。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法取消', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
