import { REST, Routes } from 'discord.js';
import { loadEnv } from '../config/env.js';

interface BotUserResponse {
  id: string;
  username: string;
}

async function runE2E(): Promise<void> {
  const env = loadEnv();
  const rest = new REST().setToken(env.discordToken);

  for (let i = 1; i <= 3; i++) {
    const start = Date.now();
    const user = (await rest.get(Routes.user('@me'))) as BotUserResponse;
    const cmds = (await rest.get(Routes.applicationCommands(env.discordClientId))) as unknown[];
    const elapsed = Date.now() - start;

    console.log(
      `[E2E #${i}/3] OK (${elapsed}ms) | Bot: ${user.username} (${user.id}) | 全局指令数: ${cmds.length}`,
    );
  }
  console.log('[E2E] 连续 3 次真实 Discord REST API 调用全部成功！');
}

void runE2E().catch((err) => {
  console.error('[E2E] 真实 Discord API 检查失败:', err);
  process.exit(1);
});
