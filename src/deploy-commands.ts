import { REST, Routes } from 'discord.js';
import { loadEnv } from './config/env.js';
import { commands } from './commands/registry.js';

async function deploy(): Promise<void> {
  const env = loadEnv();
  const rest = new REST().setToken(env.discordToken);
  const body = commands.map((cmd) => cmd.data.toJSON());

  if (env.discordGuildId) {
    console.log(
      `[deploy] 正在向测试服务器 (${env.discordGuildId}) 同步 ${body.length} 个斜杠指令...`,
    );
    await rest.put(Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId), {
      body,
    });
    console.log('[deploy] 服务器斜杠指令同步完成（秒级生效）。');
    return;
  }

  console.log(`[deploy] 正在全局注册 ${body.length} 个斜杠指令...`);
  await rest.put(Routes.applicationCommands(env.discordClientId), { body });
  console.log('[deploy] 全局斜杠指令注册完成（全服生效最多需数分钟）。');
}

void deploy().catch((err) => {
  console.error('[deploy] 同步指令失败:', err);
  process.exit(1);
});
