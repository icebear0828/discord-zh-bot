import type { SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import { applyZh } from '../../../ui/localization.js';

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

export function attachAiSlashPart2(
  builder: SlashCommandSubcommandsOnlyBuilder,
): SlashCommandSubcommandsOnlyBuilder {
  return builder
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
    );
}
