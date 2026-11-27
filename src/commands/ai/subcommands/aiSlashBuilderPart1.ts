import type {
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { AiMemoryScopeType } from '../../../db/repositories/aiMemoryRepo.js';
import {
  MAX_AI_USER_ALIAS_LEN,
  MAX_AI_USER_NOTE_LEN,
  type AiUserRelation,
} from '../../../services/aiProfiles.js';
import {
  MAX_AI_REGEX_LABEL_LEN,
  MAX_AI_REGEX_PATTERN_LEN,
  MAX_AI_REGEX_REPLACEMENT_LEN,
  type AiRegexRuleScope,
} from '../../../services/aiRegex.js';
import { applyZh } from '../../../ui/localization.js';

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

export function attachAiSlashPart1(
  builder: SlashCommandBuilder,
): SlashCommandSubcommandsOnlyBuilder {
  return builder
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
    );
}
