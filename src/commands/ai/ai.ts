import {
  AttachmentBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AiMemoryRecord, AiMemoryScopeType } from '../../db/repositories/aiMemoryRepo.js';
import { slugifyPackId } from '../../services/aiPackStore.js';
import {
  formatAiRelationBadge,
  MAX_AI_USER_ALIAS_LEN,
  MAX_AI_USER_NOTE_LEN,
  type AiUserRelation,
} from '../../services/aiProfiles.js';
import {
  isValidAiRegexScope,
  MAX_AI_REGEX_LABEL_LEN,
  MAX_AI_REGEX_PATTERN_LEN,
  MAX_AI_REGEX_REPLACEMENT_LEN,
  type AiRegexRuleScope,
} from '../../services/aiRegex.js';
import { truncateText } from '../../ui/menuShared.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  checkMemberIsBotAdmin,
  requireGuildMember,
  requireModuleEnabled,
} from '../guards.js';

const SCOPE_CHOICES: ReadonlyArray<{ name: string; value: AiMemoryScopeType }> = [
  { name: '我的个人记忆 (user)', value: 'user' },
  { name: '当前频道记忆 (channel)', value: 'channel' },
  { name: '全服共同记忆 (guild)', value: 'guild' },
];

const REGEX_SCOPE_CHOICES: ReadonlyArray<{ name: string; value: AiRegexRuleScope }> = [
  { name: '双向生效（输入与输出）', value: 'both' },
  { name: '仅输入（传给 AI 前）', value: 'input' },
  { name: '仅输出（AI 回复前）', value: 'output' },
];

const REGEX_TEST_STAGE_CHOICES: ReadonlyArray<{ name: string; value: 'input' | 'output' }> = [
  { name: '输出阶段（反八股 + 双向代称）', value: 'output' },
  { name: '输入阶段（输入归一化 + 双向代称）', value: 'input' },
];

const USER_RELATION_CHOICES: ReadonlyArray<{ name: string; value: AiUserRelation }> = [
  { name: '👑 核心偏爱（护短偏心）', value: 'vip' },
  { name: '🤝 熟人（正常熟悉）', value: 'friend' },
  { name: '🎯 重点怼（优先开喷）', value: 'rival' },
];

const PACK_BIND_SCOPE_CHOICES: ReadonlyArray<{ name: string; value: 'guild' | 'channel' }> = [
  { name: '🌐 全服默认生效 (guild)', value: 'guild' },
  { name: '🧪 仅当前频道独立覆盖测试 (channel)', value: 'channel' },
];

const PACK_IMPORT_ACTIVATE_CHOICES: ReadonlyArray<{
  name: string;
  value: 'none' | 'channel' | 'guild';
}> = [
  { name: '📥 仅入库保存（不改变当前挂载）', value: 'none' },
  { name: '🧪 立即挂载到当前频道测试', value: 'channel' },
  { name: '🌐 立即设为全服默认', value: 'guild' },
];

function formatScopeLabel(scope: AiMemoryScopeType): string {
  if (scope === 'channel') return '当前频道';
  if (scope === 'guild') return '全服共同';
  return '个人';
}

function resolveScopeId(
  scope: AiMemoryScopeType,
  guildId: string,
  channelId: string,
  userId: string,
): string {
  if (scope === 'guild') return guildId;
  if (scope === 'channel') return channelId;
  return userId;
}

export function formatMemoryListDescription(
  items: readonly AiMemoryRecord[],
  maxLen = 4096,
): string {
  if (items.length === 0) {
    return '当前作用域下暂无记忆条目。';
  }

  const lines: string[] = [];
  let usedLen = 0;
  let omitted = 0;

  for (let i = 0; i < items.length; i++) {
    const m = items[i]!;
    const line = `• \`#${m.id}\` **[${m.category}]** ${m.content}`;
    const remainingAfterThis = items.length - (i + 1);
    const footerReserve =
      remainingAfterThis > 0
        ? `\n… 另有 ${remainingAfterThis} 条记忆因长度限制已省略（共 ${items.length} 条）`.length
        : 0;
    const sep = lines.length > 0 ? 1 : 0;

    if (usedLen + sep + line.length + footerReserve > maxLen) {
      omitted = items.length - i;
      break;
    }

    lines.push(line);
    usedLen += sep + line.length;
  }

  if (omitted > 0) {
    const footer = `… 另有 ${omitted} 条记忆因长度限制已省略（共 ${items.length} 条）`;
    if (lines.length === 0) {
      return truncateText(footer, maxLen);
    }
    return truncateText(`${lines.join('\n')}\n${footer}`, maxLen);
  }

  return truncateText(lines.join('\n'), maxLen);
}

export const aiCommand: CommandDefinition = {
  name: 'ai',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('ai')
      .setDescription('AI 对话上下文重置与长期记忆管理')
      .addSubcommand((sub) =>
        applyZh(
          sub.setName('reset').setDescription('清空当前频道的短期对话上下文（长期记忆仍保留）'),
          '重置',
          '清空当前频道的短期对话上下文（长期记忆仍保留）',
        ),
      )
      .addSubcommandGroup((group) =>
        applyZh(
          group
            .setName('memory')
            .setDescription('查看或管理 AI 长期记忆')
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('list')
                  .setDescription('查看已保存的长期记忆列表')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('记忆作用域（默认查看你的个人记忆）')
                        .addChoices(...SCOPE_CHOICES),
                      '作用域',
                      '选择查看个人、当前频道或全服记忆',
                    ),
                  ),
                '查看',
                '查看已保存的长期记忆列表',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('add')
                  .setDescription('手动添加一条长期记忆')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('content')
                        .setDescription('要记住的内容（1~200字）')
                        .setMinLength(1)
                        .setMaxLength(200)
                        .setRequired(true),
                      '内容',
                      '要长期记住的内容（1~200字）',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('category')
                        .setDescription('记忆分类（默认 manual）')
                        .setMaxLength(24),
                      '分类',
                      '可选分类标签，如 preference / identity',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('作用域（频道/全服仅管理员可写入）')
                        .addChoices(...SCOPE_CHOICES),
                      '作用域',
                      '默认写入你的个人记忆；频道/全服需管理员权限',
                    ),
                  ),
                '添加',
                '手动添加一条长期记忆',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('delete')
                  .setDescription('按记忆 ID 删除一条长期记忆')
                  .addIntegerOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('记忆条目 ID（可通过 /ai 记忆 查看 获取）')
                        .setMinValue(1)
                        .setRequired(true),
                      '编号',
                      '要删除的记忆 ID',
                    ),
                  ),
                '删除',
                '按记忆 ID 删除一条长期记忆',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('clear')
                  .setDescription('清空指定作用域下的所有长期记忆')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('作用域（频道/全服仅管理员可清空）')
                        .addChoices(...SCOPE_CHOICES),
                      '作用域',
                      '默认清空你的个人记忆；频道/全服需管理员权限',
                    ),
                  ),
                '清空',
                '清空指定作用域下的所有长期记忆',
              ),
            ),
          '记忆',
          '查看或管理 AI 长期记忆',
        ),
      )
      .addSubcommandGroup((group) =>
        applyZh(
          group
            .setName('regex')
            .setDescription('管理员配置 AI 代称与反八股正则规则')
            .addSubcommand((sub) =>
              applyZh(
                sub.setName('list').setDescription('查看当前正则替换规则列表'),
                '查看',
                '查看当前正则替换规则列表',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('add')
                  .setDescription('新增一条 AI 正则替换规则')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('label')
                        .setDescription(`规则名称（1~${MAX_AI_REGEX_LABEL_LEN}字）`)
                        .setMinLength(1)
                        .setMaxLength(MAX_AI_REGEX_LABEL_LEN)
                        .setRequired(true),
                      '名称',
                      `规则名称（1~${MAX_AI_REGEX_LABEL_LEN}字）`,
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('pattern')
                        .setDescription(`正则表达式（1~${MAX_AI_REGEX_PATTERN_LEN}字符）`)
                        .setMinLength(1)
                        .setMaxLength(MAX_AI_REGEX_PATTERN_LEN)
                        .setRequired(true),
                      '正则',
                      `正则表达式（1~${MAX_AI_REGEX_PATTERN_LEN}字符）`,
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('replacement')
                        .setDescription('替换文本（不填表示删除匹配内容）')
                        .setMaxLength(MAX_AI_REGEX_REPLACEMENT_LEN),
                      '替换为',
                      '替换文本（不填表示删除）',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('生效范围（默认 both 双向）')
                        .addChoices(...REGEX_SCOPE_CHOICES),
                      '范围',
                      '生效范围（默认 both 双向）',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('flags')
                        .setDescription('正则标志（默认 gi，仅支持 g/i/m/u）')
                        .setMaxLength(8),
                      '标志',
                      '正则标志（默认 gi，支持 g/i/m/u）',
                    ),
                  ),
                '添加',
                '新增一条 AI 正则替换规则',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('toggle')
                  .setDescription('启用或停用指定编号的正则规则')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('规则编号（如 r1 或 alias_heidiowang）')
                        .setMinLength(1)
                        .setMaxLength(32)
                        .setRequired(true),
                      '编号',
                      '要切换状态的规则编号',
                    ),
                  ),
                '开关',
                '启用或停用指定编号的正则规则',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('delete')
                  .setDescription('删除指定编号的正则规则')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('规则编号（可通过 /ai 正则 查看 获取）')
                        .setMinLength(1)
                        .setMaxLength(32)
                        .setRequired(true),
                      '编号',
                      '要删除的规则编号',
                    ),
                  ),
                '删除',
                '删除指定编号的正则规则',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('test')
                  .setDescription('测试当前启用的正则规则对一段文本的替换效果')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('text')
                        .setDescription('待测试的文本内容（1~1000字）')
                        .setMinLength(1)
                        .setMaxLength(1000)
                        .setRequired(true),
                      '测试文本',
                      '待测试的文本内容（1~1000字）',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('模拟阶段（默认 output 输出阶段）')
                        .addChoices(...REGEX_TEST_STAGE_CHOICES),
                      '环节',
                      '模拟阶段（input 或 output）',
                    ),
                  ),
                '测试',
                '测试当前启用的正则规则对一段文本的替换效果',
              ),
            ),
          '正则',
          '管理员配置 AI 代称与反八股正则规则',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('usage')
            .setDescription('管理员查看 AI Token 用量与费用估算')
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('hours')
                  .setDescription('统计时间范围（小时，默认 24，范围 1~720）')
                  .setMinValue(1)
                  .setMaxValue(720),
                '小时',
                '统计最近多少小时的用量（默认 24）',
              ),
            ),
          '用量',
          '管理员查看 AI Token 用量与费用估算',
        ),
      )
      .addSubcommandGroup((group) =>
        applyZh(
          group
            .setName('profile')
            .setDescription('管理员管理 AI 精确人物关系档案（按账号绑定，绝不认错人）')
            .addSubcommand((sub) =>
              applyZh(
                sub.setName('list').setDescription('查看已配置的人物关系档案列表'),
                '查看',
                '查看已配置的人物关系档案列表',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('set')
                  .setDescription('新增或更新一名群友的 AI 人物关系档案')
                  .addUserOption((opt) =>
                    applyZh(
                      opt.setName('user').setDescription('选择目标群友').setRequired(true),
                      '群友',
                      '选择要绑定档案的 Discord 群友',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('relation')
                        .setDescription('关系档位')
                        .addChoices(...USER_RELATION_CHOICES)
                        .setRequired(true),
                      '关系',
                      '选择核心偏爱、熟人或重点怼',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('alias')
                        .setDescription(`AI 认识的称呼（1~${MAX_AI_USER_ALIAS_LEN}字）`)
                        .setMinLength(1)
                        .setMaxLength(MAX_AI_USER_ALIAS_LEN)
                        .setRequired(true),
                      '称呼',
                      `AI 怎么称呼 TA（1~${MAX_AI_USER_ALIAS_LEN}字）`,
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('note')
                        .setDescription(`一句话态度或背景备注（可选，最多${MAX_AI_USER_NOTE_LEN}字）`)
                        .setMaxLength(MAX_AI_USER_NOTE_LEN),
                      '备注',
                      `一句话态度或背景备注（最多${MAX_AI_USER_NOTE_LEN}字）`,
                    ),
                  ),
                '设置',
                '新增或更新一名群友的 AI 人物关系档案',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('delete')
                  .setDescription('删除一名群友的 AI 人物关系档案')
                  .addUserOption((opt) =>
                    applyZh(
                      opt.setName('user').setDescription('选择要移除档案的群友').setRequired(true),
                      '群友',
                      '选择要移除档案的 Discord 群友',
                    ),
                  ),
                '删除',
                '删除一名群友的 AI 人物关系档案',
              ),
            ),
          '档案',
          '管理员管理 AI 精确人物关系档案',
        ),
      )
      .addSubcommandGroup((group) =>
        applyZh(
          group
            .setName('preset')
            .setDescription('管理员管理 AI 破限预设包（导入导出、版本切换与回滚）')
            .addSubcommand((sub) =>
              applyZh(
                sub.setName('list').setDescription('查看可用破限预设列表及挂载状态'),
                '查看',
                '查看可用破限预设列表及挂载状态',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('use')
                  .setDescription('切换全服或当前频道挂载的破限预设')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('破限预设编号（可通过 /ai 预设 查看 获取）')
                        .setMinLength(1)
                        .setMaxLength(64)
                        .setRequired(true),
                      '编号',
                      '要挂载的破限预设 ID',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('生效范围（默认 guild 全服生效）')
                        .addChoices(...PACK_BIND_SCOPE_CHOICES),
                      '范围',
                      '选择全服默认或仅当前频道覆盖测试',
                    ),
                  ),
                '切换',
                '切换全服或当前频道挂载的破限预设',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('import')
                  .setDescription('上传 JSON 附件导入破限预设（支持自研格式与酒馆预设自动转换）')
                  .addAttachmentOption((opt) =>
                    applyZh(
                      opt
                        .setName('file')
                        .setDescription('上传 .json 破限预设文件')
                        .setRequired(true),
                      '文件',
                      '上传 .json 格式的预设文件（支持酒馆 ST 预设）',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('可选指定预设 ID（不填自动从文件推导）')
                        .setMaxLength(64),
                      '编号',
                      '可选指定保存的预设 ID',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('activate')
                        .setDescription('导入后是否立即挂载生效（默认仅入库）')
                        .addChoices(...PACK_IMPORT_ACTIVATE_CHOICES),
                      '立即生效',
                      '导入后仅入库、挂载当前频道或设为全服默认',
                    ),
                  ),
                '导入',
                '上传 JSON 附件导入破限预设（支持酒馆预设自动转换）',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('export')
                  .setDescription('导出指定或当前生效的破限预设为 JSON 文件')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('预设 ID（留空则导出本频道当前生效预设）')
                        .setMaxLength(64),
                      '编号',
                      '要导出的预设 ID（留空导出当前生效预设）',
                    ),
                  ),
                '导出',
                '导出指定或当前生效的破限预设为 JSON 文件',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('rollback')
                  .setDescription('将指定破限预设一键回滚到上一历史快照版本')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('要回滚的预设 ID')
                        .setMinLength(1)
                        .setMaxLength(64)
                        .setRequired(true),
                      '编号',
                      '要回滚的预设 ID',
                    ),
                  ),
                '回滚',
                '将指定破限预设一键回滚到上一历史快照版本',
              ),
            ),
          '预设',
          '管理员管理 AI 破限预设包',
        ),
      )
      .addSubcommandGroup((group) =>
        applyZh(
          group
            .setName('card')
            .setDescription('管理员管理 AI 角色人设卡与蓝绿灯世界书')
            .addSubcommand((sub) =>
              applyZh(
                sub.setName('list').setDescription('查看可用角色卡列表及挂载状态'),
                '查看',
                '查看可用角色卡列表及挂载状态',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('use')
                  .setDescription('切换全服或当前频道挂载的角色卡')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('角色卡编号（可通过 /ai 角色卡 查看 获取）')
                        .setMinLength(1)
                        .setMaxLength(64)
                        .setRequired(true),
                      '编号',
                      '要挂载的角色卡 ID',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('生效范围（默认 guild 全服生效）')
                        .addChoices(...PACK_BIND_SCOPE_CHOICES),
                      '范围',
                      '选择全服默认或仅当前频道覆盖测试',
                    ),
                  ),
                '切换',
                '切换全服或当前频道挂载的角色卡',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('import')
                  .setDescription('上传 JSON 附件导入角色卡（支持自研格式与酒馆 V2/V3 角色卡）')
                  .addAttachmentOption((opt) =>
                    applyZh(
                      opt
                        .setName('file')
                        .setDescription('上传 .json 角色卡文件')
                        .setRequired(true),
                      '文件',
                      '上传 .json 格式的角色卡（支持酒馆 V2/V3 含世界书）',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('可选指定角色卡 ID（不填自动从文件推导）')
                        .setMaxLength(64),
                      '编号',
                      '可选指定保存的角色卡 ID',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('activate')
                        .setDescription('导入后是否立即挂载生效（默认仅入库）')
                        .addChoices(...PACK_IMPORT_ACTIVATE_CHOICES),
                      '立即生效',
                      '导入后仅入库、挂载当前频道或设为全服默认',
                    ),
                  ),
                '导入',
                '上传 JSON 附件导入角色卡（支持酒馆角色卡自动转换）',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('export')
                  .setDescription('导出指定或当前生效的角色卡为 JSON 文件')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('角色卡 ID（留空则导出本频道当前生效角色卡）')
                        .setMaxLength(64),
                      '编号',
                      '要导出的角色卡 ID（留空导出当前生效角色卡）',
                    ),
                  ),
                '导出',
                '导出指定或当前生效的角色卡为 JSON 文件',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('rollback')
                  .setDescription('将指定角色卡一键回滚到上一历史快照版本')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('要回滚的角色卡 ID')
                        .setMinLength(1)
                        .setMaxLength(64)
                        .setRequired(true),
                      '编号',
                      '要回滚的角色卡 ID',
                    ),
                  ),
                '回滚',
                '将指定角色卡一键回滚到上一历史快照版本',
              ),
            ),
          '角色卡',
          '管理员管理 AI 角色人设卡与世界书',
        ),
      )
      .addSubcommandGroup((group) =>
        applyZh(
          group
            .setName('debug')
            .setDescription('破限组专属：频道沙盒覆盖、Dry-Run 报文预览与原始 CoT 检视')
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('override')
                  .setDescription('为当前频道设置或清空独立测试覆盖（不影响大群聊天）')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('preset')
                        .setDescription('仅在本频道挂载的破限预设 ID')
                        .setMaxLength(64),
                      '预设',
                      '仅在本频道测试的破限预设 ID',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('card')
                        .setDescription('仅在本频道挂载的角色卡 ID')
                        .setMaxLength(64),
                      '角色卡',
                      '仅在本频道测试的角色卡 ID',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('model')
                        .setDescription('仅在本频道使用的模型名称')
                        .setMaxLength(100),
                      '模型',
                      '仅在本频道测试的模型名称',
                    ),
                  )
                  .addBooleanOption((opt) =>
                    applyZh(
                      opt
                        .setName('clear')
                        .setDescription('设为 true 清除本频道所有独立覆盖恢复跟随全服'),
                      '清除覆盖',
                      '清除当前频道的测试覆盖并恢复全服默认',
                    ),
                  ),
                '频道挂载',
                '为当前频道设置或清空独立测试覆盖',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('dryrun')
                  .setDescription('模拟编译一句发言并私密导出发给网关的完整 messages JSON')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('text')
                        .setDescription('模拟用户发送的测试文本（1~1000字）')
                        .setMinLength(1)
                        .setMaxLength(1000)
                        .setRequired(true),
                      '测试发言',
                      '模拟用户发送的测试消息文本',
                    ),
                  ),
                '预览报文',
                '模拟编译发言并导出发往网关的完整 messages JSON',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('last')
                  .setDescription('私密查看本频道最近一次回复的原始未清洗内容与 CoT 思维链'),
                '上次报文',
                '查看本频道最近一次回复的原始未清洗输出与 CoT 思维链',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('reload')
                  .setDescription('重新扫描磁盘 data/ai-packs 目录加载最新预设与角色卡'),
                '重载磁盘',
                '重新扫描磁盘私有目录加载最新预设与角色卡',
              ),
            ),
          '调试',
          '破限组专属频道覆盖与原始报文检视',
        ),
      ),
    'ai',
    'AI 对话上下文重置与长期记忆管理',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const memberCtx = await requireGuildMember(interaction);
    if (!memberCtx) return;

    const enabled = await requireModuleEnabled(interaction, ctx, 'ai', 'AI 对话');
    if (!enabled) return;

    const { guildId, member } = memberCtx;
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    const isAdmin = checkMemberIsBotAdmin(member, cfg);

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!group && sub === 'reset') {
      ctx.services.ai.resetChannelContext(guildId, interaction.channelId);
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '🧹 对话上下文已重置',
            '本频道之前的短期聊天记录已从 AI 视野截断，接下来将开启全新对话（长期记忆仍会保留）。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!group && sub === 'usage') {
      if (!isAdmin) {
        await interaction.reply({
          embeds: [
            createErrorEmbed(
              '🔒 权限不足',
              '只有服务器管理员或 Bot 管理员才能查看 AI Token 用量与计费统计。',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const hours = interaction.options.getInteger('hours') ?? 24;
      const summary = ctx.services.ai.getUsageSummary(guildId, hours);
      const costStr =
        summary.estimatedCostUsd <= 0
          ? '$0.0000'
          : summary.estimatedCostUsd < 0.01
            ? `$${summary.estimatedCostUsd.toFixed(6)}`
            : `$${summary.estimatedCostUsd.toFixed(4)}`;

      const modelLines =
        summary.byModel.length > 0
          ? summary.byModel
              .slice(0, 5)
              .map(
                (m) =>
                  `• \`${m.model}\`：${m.calls} 次 ｜ ${m.totalTokens.toLocaleString('en-US')} tok（${m.promptTokens}/${m.completionTokens}）`,
              )
          : ['• 暂无调用记录'];

      const userLines =
        summary.topUsers.length > 0
          ? summary.topUsers.map(
              (u) => `• <@${u.userId}>：${u.calls} 次 ｜ ${u.totalTokens.toLocaleString('en-US')} tok`,
            )
          : ['• 暂无成员消费记录'];

      await interaction.reply({
        embeds: [
          createInfoEmbed(
            `📊 AI 近 ${hours} 小时用量统计`,
            truncateText(
              [
                `• **调用次数**：**${summary.totalCalls}** 次（成功 ${summary.okCalls} / 失败 ${summary.errorCalls} / 本地估算 ${summary.estimatedCalls}）`,
                `• **Token 消耗**：**${summary.totalTokens.toLocaleString('en-US')}**（输入 ${summary.promptTokens.toLocaleString('en-US')} + 输出 ${summary.completionTokens.toLocaleString('en-US')}）`,
                `• **平均延迟**：**${summary.avgLatencyMs}ms** ｜ **估算花费**：**${costStr}**`,
                `• **当前单价**：输入 $${cfg.ai.inputPricePer1MUsd}/1M ｜ 输出 $${cfg.ai.outputPricePer1MUsd}/1M`,
                '',
                '**按模型分布**',
                ...modelLines,
                '',
                '**消耗 Top 5**',
                ...userLines,
              ].join('\n'),
              4096,
            ),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (group === 'memory') {
      const scopeRaw = interaction.options.getString('scope');
      const scope: AiMemoryScopeType =
        scopeRaw === 'channel' || scopeRaw === 'guild' ? scopeRaw : 'user';
      const scopeId = resolveScopeId(scope, guildId, interaction.channelId, member.id);

      if (sub === 'list') {
        const items = ctx.services.ai.listMemories(guildId, scope, scopeId, 30);
        const description = formatMemoryListDescription(items, 4096);

        await interaction.reply({
          embeds: [
            createInfoEmbed(
              `🧠 AI 长期记忆（${formatScopeLabel(scope)} · 共 ${items.length} 条）`,
              description,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'add') {
        if ((scope === 'channel' || scope === 'guild') && !isAdmin) {
          await interaction.reply({
            embeds: [
              createErrorEmbed(
                '🔒 权限不足',
                '只有服务器管理员或 Bot 管理员才能添加频道/全服级长期记忆。',
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const content = interaction.options.getString('content', true).trim();
        const category = interaction.options.getString('category')?.trim() || 'manual';
        const record = ctx.services.ai.addMemory({
          guildId,
          scopeType: scope,
          scopeId,
          category,
          content,
          createdBy: member.id,
        });

        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '✅ 已写入长期记忆',
              `已存入 **${formatScopeLabel(scope)}记忆** \`#${record.id}\`：**[${record.category}]** ${record.content}`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'delete') {
        const id = interaction.options.getInteger('id', true);
        const target = ctx.services.ai.getMemoryById(guildId, id);
        if (!target) {
          await interaction.reply({
            embeds: [createErrorEmbed('❓ 未找到记忆', `找不到编号为 \`#${id}\` 的记忆条目。`)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const canDelete =
          isAdmin || (target.scopeType === 'user' && target.scopeId === member.id);
        if (!canDelete) {
          await interaction.reply({
            embeds: [
              createErrorEmbed(
                '🔒 权限不足',
                '你只能删除自己的个人记忆；频道或全服记忆需要管理员删除。',
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        ctx.services.ai.deleteMemory(guildId, id);
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '🗑️ 已删除记忆',
              `已移除 \`#${id}\`：**[${target.category}]** ${target.content}`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'clear') {
        if ((scope === 'channel' || scope === 'guild') && !isAdmin) {
          await interaction.reply({
            embeds: [
              createErrorEmbed(
                '🔒 权限不足',
                '只有服务器管理员或 Bot 管理员才能清空频道/全服级长期记忆。',
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const deleted = ctx.services.ai.clearMemories(guildId, scope, scopeId);
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '🧹 记忆已清空',
              `已清空 **${formatScopeLabel(scope)}记忆**，共移除 **${deleted}** 条记录。`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (group === 'regex') {
      if (!isAdmin) {
        await interaction.reply({
          embeds: [
            createErrorEmbed(
              '🔒 权限不足',
              '只有服务器管理员或 Bot 管理员才能管理 AI 正则替换规则。',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'list') {
        const rules = ctx.repos.guildConfig.getOrCreate(guildId).ai.regexRules;
        const antiCliche = ctx.repos.guildConfig.getOrCreate(guildId).ai.antiClichePromptEnabled;
        const lines =
          rules.length > 0
            ? rules.map((r) => {
                const icon = r.enabled ? '✅' : '⏸️';
                const rep = r.replacement ? `\`${truncateText(r.replacement, 30)}\`` : '*(删除)*';
                return `${icon} \`${r.id}\` **[${r.scope}] ${r.label}**\n  \`/${truncateText(r.pattern, 60)}/${r.flags}\` → ${rep}`;
              })
            : ['当前没有正则替换规则。'];

        await interaction.reply({
          embeds: [
            createInfoEmbed(
              `🔧 AI 正则规则列表（共 ${rules.length} 条）`,
              truncateText(
                [`🧹 反八股系统提示词：${antiCliche ? '✅ 开启' : '⛔ 关闭'}`, '', ...lines].join('\n'),
                4096,
              ),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'add') {
        const label = interaction.options.getString('label', true);
        const pattern = interaction.options.getString('pattern', true);
        const replacement = interaction.options.getString('replacement') ?? '';
        const scopeRaw = interaction.options.getString('scope') ?? 'both';
        const flags = interaction.options.getString('flags') ?? 'gi';
        const scope: AiRegexRuleScope = isValidAiRegexScope(scopeRaw) ? scopeRaw : 'both';

        const res = ctx.services.ai.addRegexRule(guildId, {
          label,
          pattern,
          replacement,
          scope,
          flags,
        });
        if (!res.ok) {
          await interaction.reply({
            embeds: [createErrorEmbed('❌ 添加正则规则失败', res.error)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '✅ 已添加正则规则',
              `编号 \`${res.rule.id}\` **${res.rule.label}**（${res.rule.scope}）\n\`/${res.rule.pattern}/${res.rule.flags}\` → ${res.rule.replacement ? `\`${res.rule.replacement}\`` : '*(删除)*'}`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'toggle') {
        const id = interaction.options.getString('id', true).trim();
        const res = ctx.services.ai.toggleRegexRule(guildId, id);
        if (!res.ok) {
          await interaction.reply({
            embeds: [createErrorEmbed('❓ 操作失败', res.error)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '🔘 已更新规则状态',
              `规则 \`${res.rule.id}\`（${res.rule.label}）已切换为：**${res.rule.enabled ? '启用' : '停用'}**。`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'delete') {
        const id = interaction.options.getString('id', true).trim();
        const res = ctx.services.ai.deleteRegexRule(guildId, id);
        if (!res.ok) {
          await interaction.reply({
            embeds: [createErrorEmbed('❓ 删除失败', res.error)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '🗑️ 已删除正则规则',
              `已移除规则 \`${res.rule.id}\`（${res.rule.label}）。`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'test') {
        const text = interaction.options.getString('text', true);
        const stageRaw = interaction.options.getString('scope');
        const stage: 'input' | 'output' = stageRaw === 'input' ? 'input' : 'output';
        const preview = ctx.services.ai.previewRegexRules(guildId, text, stage);
        await interaction.reply({
          embeds: [
            createInfoEmbed(
              `🧪 正则测试预览（${stage === 'input' ? '输入阶段' : '输出阶段'}）`,
              truncateText(
                [
                  `**原文**：\n${preview.before}`,
                  '',
                  `**结果**（${preview.changed ? '✅ 已命中替换' : '未命中任何规则'}）：\n${preview.after}`,
                ].join('\n'),
                4096,
              ),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (group === 'profile') {
      if (!isAdmin) {
        await interaction.reply({
          embeds: [
            createErrorEmbed(
              '🔒 权限不足',
              '只有服务器管理员或 Bot 管理员才能管理 AI 人物关系档案。',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'list') {
        const profiles = ctx.services.ai.listUserProfiles(guildId);
        const lines =
          profiles.length > 0
            ? profiles.map((p) => {
                const badge = formatAiRelationBadge(p.relation);
                const noteText = p.note ? ` — ${p.note}` : '';
                return `• ${badge} <@${p.userId}> · **${p.alias}**${noteText}`;
              })
            : ['当前尚未配置任何人物档案，可使用 `/ai 档案 设置` 或 `/菜单 → 管理后台 → AI 管理` 添加。'];

        await interaction.reply({
          embeds: [
            createInfoEmbed(
              `👤 AI 人物关系档案（共 ${profiles.length} 人）`,
              truncateText(lines.join('\n'), 4096),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'set') {
        const target = interaction.options.getUser('user', true);
        const relation = interaction.options.getString('relation', true);
        const alias = interaction.options.getString('alias', true);
        const note = interaction.options.getString('note') ?? '';

        const res = ctx.services.ai.upsertUserProfile(guildId, {
          userId: target.id,
          alias,
          relation,
          note,
        });
        if (!res.ok) {
          await interaction.reply({
            embeds: [createErrorEmbed('❌ 保存人物档案失败', res.error)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const badge = formatAiRelationBadge(res.profile.relation);
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              res.updated ? '✅ 已更新人物档案' : '✅ 已新增人物档案',
              `${badge} <@${res.profile.userId}> · 称呼：**${res.profile.alias}**${res.profile.note ? `\n备注：${res.profile.note}` : ''}`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'delete') {
        const target = interaction.options.getUser('user', true);
        const res = ctx.services.ai.deleteUserProfile(guildId, target.id);
        if (!res.ok) {
          await interaction.reply({
            embeds: [createErrorEmbed('❓ 删除失败', res.error)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '🗑️ 已移除人物档案',
              `已删除 <@${res.profile.userId}>（**${res.profile.alias}**）的人物关系档案。`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (group === 'preset' || group === 'card' || group === 'debug') {
      if (!isAdmin) {
        await interaction.reply({
          embeds: [
            createErrorEmbed(
              '🔒 权限不足',
              '只有服务器管理员或 Bot 管理员才能管理破限预设、角色卡与调试报文。',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (group === 'preset') {
        const binding = ctx.services.ai.resolveEffectiveBinding(guildId, interaction.channelId);

        if (sub === 'list') {
          const presets = ctx.services.ai.listPresets();
          const lines = presets.map((p) => {
            const isGuild = (cfg.ai.activePresetId || 'default-chat') === p.id;
            const isChan = binding.channelOverride?.presetId === p.id;
            const tags = [
              isGuild ? '🌐全服默认' : '',
              isChan ? '🧪本频道覆盖' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const tagBadge = tags ? ` — **${tags}**` : '';
            const histCount = ctx.services.ai.listPackHistory('preset', p.id).length;
            return `• \`${p.id}\` **${p.name}** \`v${p.version}\`（Prompt块 ${p.prompts.length} · 历史快照 ${histCount}）${tagBadge}`;
          });

          await interaction.reply({
            embeds: [
              createInfoEmbed(
                `🔓 AI 破限预设库（共 ${presets.length} 套）`,
                truncateText(
                  [
                    `当前频道生效预设：\`${binding.preset.id}\`（**${binding.preset.name}** \`v${binding.preset.version}\`）`,
                    '',
                    ...lines,
                  ].join('\n'),
                  4096,
                ),
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'use') {
          const id = interaction.options.getString('id', true).trim();
          const scope = interaction.options.getString('scope') === 'channel' ? 'channel' : 'guild';
          if (scope === 'channel') {
            const res = ctx.services.ai.setChannelOverride(guildId, interaction.channelId, {
              presetId: id,
            });
            if (!res.ok) {
              await interaction.reply({
                embeds: [createErrorEmbed('❌ 切换预设失败', res.error)],
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            await interaction.reply({
              embeds: [
                createSuccessEmbed(
                  '🧪 已挂载当前频道测试预设',
                  `频道 <#${interaction.channelId}> 已独立挂载破限预设 \`${id}\`（不影响其他频道）。`,
                ),
              ],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const res = ctx.services.ai.setGuildActivePreset(guildId, id);
          if (!res.ok) {
            await interaction.reply({
              embeds: [createErrorEmbed('❌ 切换预设失败', res.error)],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await interaction.reply({
            embeds: [
              createSuccessEmbed(
                '🌐 已更新全服默认破限预设',
                `全服默认破限预设已切换为 \`${res.preset.id}\`（**${res.preset.name}** \`v${res.preset.version}\`）。`,
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'import') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const att = interaction.options.getAttachment('file', true);
          const customId = interaction.options.getString('id')?.trim();
          const activate = interaction.options.getString('activate') ?? 'none';

          const dl = await ctx.services.ai.downloadTextAttachment(att.url);
          if (!dl.ok) {
            await interaction.editReply({
              embeds: [createErrorEmbed('❌ 下载预设附件失败', dl.error)],
            });
            return;
          }

          const baseName = (att.name ?? 'preset').replace(/\.json$/i, '');
          const fallbackId = customId || slugifyPackId(baseName, 'preset');
          const imported = ctx.services.ai.importPresetJson(
            dl.text,
            customId ? { fallbackId: customId } : { fallbackId, fallbackName: baseName },
          );
          if (!imported.ok) {
            await interaction.editReply({
              embeds: [createErrorEmbed('❌ 导入破限预设失败', imported.error)],
            });
            return;
          }

          let finalPack = imported.pack;
          if (customId && finalPack.id !== slugifyPackId(customId, 'preset')) {
            const store = ctx.services.ai.getPackStore();
            const forcedId = slugifyPackId(customId, 'preset');
            if (store) {
              const savedAgain = store.savePreset({ ...finalPack, id: forcedId });
              if (savedAgain.ok) {
                finalPack = savedAgain.pack;
              }
            }
          }

          let bindNote = '仅入库保存（未改动当前挂载）';
          if (activate === 'channel') {
            ctx.services.ai.setChannelOverride(guildId, interaction.channelId, {
              presetId: finalPack.id,
            });
            bindNote = `已挂载至当前频道 <#${interaction.channelId}> 独立测试`;
          } else if (activate === 'guild') {
            ctx.services.ai.setGuildActivePreset(guildId, finalPack.id);
            bindNote = '已设为全服默认破限预设';
          }

          const srcLabel =
            imported.sourceFormat === 'sillytavern_preset'
              ? '酒馆 SillyTavern 预设（自动转换）'
              : '自研标准 Preset JSON';

          await interaction.editReply({
            embeds: [
              createSuccessEmbed(
                '✅ 已导入破限预设',
                [
                  `• **编号**：\`${finalPack.id}\` ｜ **名称**：**${finalPack.name}** \`v${finalPack.version}\``,
                  `• **来源格式**：${srcLabel}`,
                  `• **编排块数**：**${finalPack.prompts.length}** 块 ｜ **Prefill**：${finalPack.assistantPrefill.enabled ? '✅ 开启' : '关闭'}`,
                  `• **历史快照**：${imported.archivedPrevious ? '已自动备份覆盖前旧版本（可一键回滚）' : '全新入库'}`,
                  `• **挂载状态**：${bindNote}`,
                ].join('\n'),
              ),
            ],
          });
          return;
        }

        if (sub === 'export') {
          const id = interaction.options.getString('id')?.trim();
          const pack = ctx.services.ai.exportPreset(guildId, id, interaction.channelId);
          if (!pack) {
            await interaction.reply({
              embeds: [createErrorEmbed('❓ 未找到预设', `找不到编号为 \`${id}\` 的破限预设。`)],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const jsonBuf = Buffer.from(`${JSON.stringify(pack, null, 2)}\n`, 'utf8');
          const file = new AttachmentBuilder(jsonBuf, {
            name: `${pack.id}-v${pack.version}.preset.json`,
          });
          await interaction.reply({
            embeds: [
              createSuccessEmbed(
                `📤 已导出破限预设：${pack.name}`,
                `编号 \`${pack.id}\`（\`v${pack.version}\`），请下载下方 JSON 附件保存或提交 Git。`,
              ),
            ],
            files: [file],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'rollback') {
          const id = interaction.options.getString('id', true).trim();
          const res = ctx.services.ai.rollbackPreset(id);
          if (!res.ok) {
            await interaction.reply({
              embeds: [createErrorEmbed('❌ 回滚预设失败', res.error)],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await interaction.reply({
            embeds: [
              createSuccessEmbed(
                '⏪ 已回滚破限预设',
                `预设 \`${res.restored.id}\` 已恢复至上一版本：**${res.restored.name}** \`v${res.restored.version}\`。`,
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      if (group === 'card') {
        const binding = ctx.services.ai.resolveEffectiveBinding(guildId, interaction.channelId);

        if (sub === 'list') {
          const cards = ctx.services.ai.listCards();
          const lines = cards.map((c) => {
            const isGuild = cfg.ai.activeCardId === c.id;
            const isChan = binding.channelOverride?.cardId === c.id;
            const tags = [isGuild ? '🌐全服默认' : '', isChan ? '🧪本频道覆盖' : '']
              .filter(Boolean)
              .join(' ');
            const tagBadge = tags ? ` — **${tags}**` : '';
            const histCount = ctx.services.ai.listPackHistory('card', c.id).length;
            return `• \`${c.id}\` **${c.personaName}**（${c.name} \`v${c.version}\` · 词条 ${c.lorebookEntries.length} · 快照 ${histCount}）${tagBadge}`;
          });

          await interaction.reply({
            embeds: [
              createInfoEmbed(
                `🎭 AI 角色人设卡库（共 ${cards.length} 张）`,
                truncateText(
                  [
                    `当前频道生效角色：**${binding.card.personaName}**（卡 \`${binding.card.id}\` \`v${binding.card.version}\`）`,
                    '',
                    ...lines,
                  ].join('\n'),
                  4096,
                ),
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'use') {
          const id = interaction.options.getString('id', true).trim();
          const scope = interaction.options.getString('scope') === 'channel' ? 'channel' : 'guild';
          if (scope === 'channel') {
            const res = ctx.services.ai.setChannelOverride(guildId, interaction.channelId, {
              cardId: id,
            });
            if (!res.ok) {
              await interaction.reply({
                embeds: [createErrorEmbed('❌ 切换角色卡失败', res.error)],
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            await interaction.reply({
              embeds: [
                createSuccessEmbed(
                  '🧪 已挂载当前频道测试角色卡',
                  `频道 <#${interaction.channelId}> 已独立挂载角色卡 \`${id}\`（不影响其他频道）。`,
                ),
              ],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const res = ctx.services.ai.setGuildActiveCard(guildId, id);
          if (!res.ok) {
            await interaction.reply({
              embeds: [createErrorEmbed('❌ 切换角色卡失败', res.error)],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await interaction.reply({
            embeds: [
              createSuccessEmbed(
                '🌐 已更新全服默认角色卡',
                `全服默认角色卡已切换为 \`${res.card.id}\`（角色名：**${res.card.personaName}** \`v${res.card.version}\`）。`,
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'import') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const att = interaction.options.getAttachment('file', true);
          const customId = interaction.options.getString('id')?.trim();
          const activate = interaction.options.getString('activate') ?? 'none';

          const dl = await ctx.services.ai.downloadTextAttachment(att.url);
          if (!dl.ok) {
            await interaction.editReply({
              embeds: [createErrorEmbed('❌ 下载角色卡附件失败', dl.error)],
            });
            return;
          }

          const baseName = (att.name ?? 'card').replace(/\.json$/i, '');
          const fallbackId = customId || slugifyPackId(baseName, 'card');
          const imported = ctx.services.ai.importCardJson(
            dl.text,
            customId ? { fallbackId: customId } : { fallbackId, fallbackName: baseName },
          );
          if (!imported.ok) {
            await interaction.editReply({
              embeds: [createErrorEmbed('❌ 导入角色卡失败', imported.error)],
            });
            return;
          }

          let finalCard = imported.pack;
          if (customId && finalCard.id !== slugifyPackId(customId, 'card')) {
            const store = ctx.services.ai.getPackStore();
            const forcedId = slugifyPackId(customId, 'card');
            if (store) {
              const savedAgain = store.saveCard({ ...finalCard, id: forcedId });
              if (savedAgain.ok) {
                finalCard = savedAgain.pack;
              }
            }
          }

          let bindNote = '仅入库保存（未改动当前挂载）';
          if (activate === 'channel') {
            ctx.services.ai.setChannelOverride(guildId, interaction.channelId, {
              cardId: finalCard.id,
            });
            bindNote = `已挂载至当前频道 <#${interaction.channelId}> 独立测试`;
          } else if (activate === 'guild') {
            ctx.services.ai.setGuildActiveCard(guildId, finalCard.id);
            bindNote = '已设为全服默认角色卡';
          }

          const srcLabel =
            imported.sourceFormat === 'sillytavern_card'
              ? '酒馆 SillyTavern 角色卡（自动转换）'
              : '自研标准 Card JSON';

          await interaction.editReply({
            embeds: [
              createSuccessEmbed(
                '✅ 已导入角色人设卡',
                [
                  `• **编号**：\`${finalCard.id}\` ｜ **角色名**：**${finalCard.personaName}** \`v${finalCard.version}\``,
                  `• **来源格式**：${srcLabel}`,
                  `• **世界书词条**：**${finalCard.lorebookEntries.length}** 条 ｜ **局部正则**：**${finalCard.regexRules.length}** 条`,
                  `• **历史快照**：${imported.archivedPrevious ? '已自动备份覆盖前旧版本（可一键回滚）' : '全新入库'}`,
                  `• **挂载状态**：${bindNote}`,
                ].join('\n'),
              ),
            ],
          });
          return;
        }

        if (sub === 'export') {
          const id = interaction.options.getString('id')?.trim();
          const pack = ctx.services.ai.exportCard(guildId, id, interaction.channelId);
          if (!pack) {
            await interaction.reply({
              embeds: [createErrorEmbed('❓ 未找到角色卡', `找不到编号为 \`${id}\` 的角色卡。`)],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const jsonBuf = Buffer.from(`${JSON.stringify(pack, null, 2)}\n`, 'utf8');
          const file = new AttachmentBuilder(jsonBuf, {
            name: `${pack.id}-v${pack.version}.card.json`,
          });
          await interaction.reply({
            embeds: [
              createSuccessEmbed(
                `📤 已导出角色卡：${pack.personaName}`,
                `编号 \`${pack.id}\`（\`v${pack.version}\`），请下载下方 JSON 附件保存或提交 Git。`,
              ),
            ],
            files: [file],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'rollback') {
          const id = interaction.options.getString('id', true).trim();
          const res = ctx.services.ai.rollbackCard(id);
          if (!res.ok) {
            await interaction.reply({
              embeds: [createErrorEmbed('❌ 回滚角色卡失败', res.error)],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await interaction.reply({
            embeds: [
              createSuccessEmbed(
                '⏪ 已回滚角色卡',
                `角色卡 \`${res.restored.id}\` 已恢复至上一版本：**${res.restored.personaName}** \`v${res.restored.version}\`。`,
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      if (sub === 'override') {
        const shouldClear = interaction.options.getBoolean('clear') === true;
        if (shouldClear) {
          const cleared = ctx.services.ai.clearChannelOverride(guildId, interaction.channelId);
          await interaction.reply({
            embeds: [
              createSuccessEmbed(
                '🧹 已清除频道独立覆盖',
                cleared
                  ? `频道 <#${interaction.channelId}> 的测试覆盖已移除，已恢复跟随全服默认配置。`
                  : `频道 <#${interaction.channelId}> 当前没有独立覆盖配置。`,
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const presetId = interaction.options.getString('preset')?.trim() || undefined;
        const cardId = interaction.options.getString('card')?.trim() || undefined;
        const modelOverride = interaction.options.getString('model')?.trim() || undefined;

        if (!presetId && !cardId && !modelOverride) {
          const current = ctx.services.ai.resolveEffectiveBinding(guildId, interaction.channelId);
          await interaction.reply({
            embeds: [
              createInfoEmbed(
                '🧪 当前频道 AI 挂载状态',
                [
                  `• **独立覆盖状态**：${current.isChannelOverridden ? '✅ 已开启频道沙盒覆盖' : '跟随全服默认'}`,
                  `• **生效破限预设**：\`${current.preset.id}\`（${current.preset.name} \`v${current.preset.version}\`）`,
                  `• **生效角色卡**：\`${current.card.id}\`（**${current.card.personaName}** \`v${current.card.version}\`）`,
                  `• **生效模型**：\`${current.effectiveModel || '未配置'}\``,
                ].join('\n'),
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const res = ctx.services.ai.setChannelOverride(guildId, interaction.channelId, {
          ...(presetId ? { presetId } : {}),
          ...(cardId ? { cardId } : {}),
          ...(modelOverride ? { modelOverride } : {}),
        });
        if (!res.ok) {
          await interaction.reply({
            embeds: [createErrorEmbed('❌ 设置频道覆盖失败', res.error)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const updated = ctx.services.ai.resolveEffectiveBinding(guildId, interaction.channelId);
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '🧪 已更新当前频道测试覆盖',
              [
                `频道 <#${interaction.channelId}> 当前独立生效组合：`,
                `• **破限预设**：\`${updated.preset.id}\` \`v${updated.preset.version}\``,
                `• **角色卡**：\`${updated.card.id}\`（**${updated.card.personaName}** \`v${updated.card.version}\`）`,
                `• **模型**：\`${updated.effectiveModel || '未配置'}\``,
              ].join('\n'),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'dryrun') {
        const text = interaction.options.getString('text', true);
        const preview = ctx.services.ai.previewCompiledPrompt(guildId, {
          channelId: interaction.channelId,
          userId: member.id,
          userName: member.displayName,
          userHandle: interaction.user.username,
          userContent: text,
        });

        const payloadJson = `${JSON.stringify(preview, null, 2)}\n`;
        const file = new AttachmentBuilder(Buffer.from(payloadJson, 'utf8'), {
          name: `dryrun-${preview.presetId}-${preview.cardId}.json`,
        });

        const loreText =
          preview.triggeredLorebookIds.length > 0
            ? preview.triggeredLorebookIds.map((id) => `\`${id}\``).join('、')
            : '无（仅常驻设定）';

        await interaction.reply({
          embeds: [
            createInfoEmbed(
              '🔍 Dry-Run 破限编译报文预览',
              truncateText(
                [
                  `• **挂载预设**：\`${preview.presetId}\`（${preview.presetName} \`v${preview.presetVersion}\`）`,
                  `• **挂载角色卡**：\`${preview.cardId}\`（**${preview.personaName}** \`v${preview.cardVersion}\`）`,
                  `• **目标模型**：\`${preview.model}\` ｜ 温度 **${preview.sampling.temperature}** ｜ MaxTokens **${preview.sampling.maxTokens}**`,
                  `• **消息块序列**：${preview.messages.map((m) => `\`${m.role}\``).join(' → ')}（共 ${preview.messages.length} 块）`,
                  `• **命中世界书词条**：${loreText}`,
                  '',
                  '完整 `messages[]` 与采样参数已打包为下方私密 JSON 附件供逐字核查。',
                ].join('\n'),
                4096,
              ),
            ),
          ],
          files: [file],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'last') {
        const trace = ctx.services.ai.getLastChannelDebugTrace(guildId, interaction.channelId);
        if (!trace) {
          await interaction.reply({
            embeds: [
              createInfoEmbed(
                '📭 暂无调试报文记录',
                '本频道自上次启动以来尚未产生 AI 回复记录。先触发一次对话后再查看。',
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const file = new AttachmentBuilder(
          Buffer.from(`${JSON.stringify(trace, null, 2)}\n`, 'utf8'),
          { name: `last-trace-${interaction.channelId}.json` },
        );

        const cotPreview = trace.extractedCot
          ? `\`\`\`\n${truncateText(trace.extractedCot, 1200)}\n\`\`\``
          : '*(本次输出未包含 CoT 思维链标签)*';

        await interaction.reply({
          embeds: [
            createInfoEmbed(
              '🔬 本频道最近一次原始报文与 CoT 检视',
              truncateText(
                [
                  `• **预设 / 角色卡**：\`${trace.presetId}@v${trace.presetVersion}\` + \`${trace.cardId}@v${trace.cardVersion}\`（**${trace.personaName}**）`,
                  `• **实际模型**：\`${trace.model}\` ｜ **命中词条**：${trace.triggeredLorebookIds.length > 0 ? trace.triggeredLorebookIds.map((x) => `\`${x}\``).join('、') : '无'}`,
                  '',
                  '**🧠 剥离出的 CoT 思维链**',
                  cotPreview,
                  '',
                  '**📝 网关原始输出片段**',
                  `\`\`\`\n${truncateText(trace.rawResponse, 800)}\n\`\`\``,
                ].join('\n'),
                4096,
              ),
            ),
          ],
          files: [file],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'reload') {
        const stats = ctx.services.ai.reloadPacks();
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '🔄 已重新扫描磁盘预设库',
              `已从 \`data/ai-packs/\` 刷新加载：**${stats.presets}** 套破限预设、**${stats.cards}** 张角色人设卡。`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
