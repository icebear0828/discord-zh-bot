import { Events, type Client, type GuildMember, type PartialGuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { registerGuildMemberAddEvent } from '../../src/events/guildMemberAdd.js';
import { registerGuildMemberRemoveEvent } from '../../src/events/guildMemberRemove.js';
import { registerInviteEvents } from '../../src/events/inviteEvents.js';
import { InviteService } from '../../src/services/inviteService.js';
import { renderTemplate } from '../../src/services/welcomeService.js';
import type { AppContext } from '../../src/ui/embeds.js';

function createMinimalCtx(): { ctx: AppContext; close: () => void } {
  const db = createDatabase(':memory:');
  const guildConfig = new GuildConfigRepo(db);
  const inviteRepo = new InviteRepo(db);
  const invite = new InviteService(inviteRepo);
  const ctx = {
    db,
    repos: { guildConfig, invite: inviteRepo },
    services: { invite },
  } as unknown as AppContext;
  return { ctx, close: () => db.close() };
}

describe('welcomeService & welcome/invite events', () => {
  it('replaces known template tokens in a single pass without expanding user content', () => {
    const out = renderTemplate(
      '欢迎 {user}（{username}）加入 {server}！人数：{memberCount}，邀请人：{inviter}',
      {
        user: '<@123>',
        username: '{server}', // adversarial token in username must NOT expand
        server: '测试小窝',
        memberCount: 42,
        inviter: '<@999>',
      },
    );
    expect(out).toBe('欢迎 <@123>（{server}）加入 测试小窝！人数：42，邀请人：<@999>');
  });

  it('skips auto-roles when modules.welcome is disabled, and uses channels.fetch + truncation when enabled', async () => {
    const { ctx, close } = createMinimalCtx();
    const handlers = new Map<string, (...args: unknown[]) => Promise<void> | void>();
    const fakeClient = {
      on: (event: string, fn: (...args: unknown[]) => Promise<void> | void) => {
        handlers.set(event, fn);
      },
    } as unknown as Client;

    registerGuildMemberAddEvent(fakeClient, ctx);
    registerGuildMemberRemoveEvent(fakeClient, ctx);

    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, welcome: false, invites: false });
    ctx.repos.guildConfig.updateWelcome('g1', {
      ...cfg.welcome,
      autoRoleIds: ['role-1'],
      welcomeEnabled: true,
      welcomeChannelId: 'ch-welcome',
      welcomeTitle: '欢迎'.repeat(200),
      welcomeTemplate: 'A'.repeat(5000),
      leaveEnabled: true,
      leaveChannelId: 'ch-leave',
      leaveTemplate: 'B'.repeat(5000),
    });

    const rolesAdd = vi.fn(async () => undefined);
    const sendWelcome = vi.fn(async () => ({ id: 'm1' }));
    const sendLeave = vi.fn(async () => ({ id: 'm2' }));
    const fetchChannel = vi.fn(async (id: string) => {
      if (id === 'ch-welcome') return { id, isSendable: () => true, send: sendWelcome };
      if (id === 'ch-leave') return { id, isSendable: () => true, send: sendLeave };
      return null;
    });

    const member = {
      id: 'u1',
      user: { bot: false, username: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
      roles: { add: rolesAdd },
      guild: {
        id: 'g1',
        name: 'TestGuild',
        memberCount: 10,
        channels: { cache: new Map(), fetch: fetchChannel },
        invites: { fetch: vi.fn(async () => new Map()) },
      },
    } as unknown as GuildMember;

    // 1. Module welcome disabled -> skip auto-roles and welcome message
    await handlers.get(Events.GuildMemberAdd)?.(member);
    expect(rolesAdd).not.toHaveBeenCalled();
    expect(sendWelcome).not.toHaveBeenCalled();

    // 2. Module welcome enabled -> grant auto-roles, fetch uncached channel, truncate title/body
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, welcome: true, invites: false });
    await handlers.get(Events.GuildMemberAdd)?.(member);
    expect(rolesAdd).toHaveBeenCalledWith(['role-1'], '入群自动发放身份组');
    expect(fetchChannel).toHaveBeenCalledWith('ch-welcome');
    expect(sendWelcome).toHaveBeenCalledTimes(1);
    const welcomeCall = sendWelcome.mock.calls[0] as unknown as [
      { embeds: Array<{ toJSON(): { title?: string; description?: string } }> },
    ];
    const welcomeJson = welcomeCall[0].embeds[0]!.toJSON();
    expect((welcomeJson.title ?? '').length).toBeLessThanOrEqual(256);
    expect((welcomeJson.description ?? '').length).toBeLessThanOrEqual(4096);

    // 3. Leave event fetches uncached channel and truncates overlong description
    await handlers.get(Events.GuildMemberRemove)?.(member as unknown as PartialGuildMember);
    expect(fetchChannel).toHaveBeenCalledWith('ch-leave');
    expect(sendLeave).toHaveBeenCalledTimes(1);
    const leaveCall = sendLeave.mock.calls[0] as unknown as [
      { embeds: Array<{ toJSON(): { description?: string } }> },
    ];
    expect((leaveCall[0].embeds[0]!.toJSON().description ?? '').length).toBeLessThanOrEqual(4096);

    close();
  });

  it('refreshes invite cache automatically on Events.GuildCreate', async () => {
    const { ctx, close } = createMinimalCtx();
    const handlers = new Map<string, (...args: unknown[]) => Promise<void> | void>();
    const fakeClient = {
      on: (event: string, fn: (...args: unknown[]) => Promise<void> | void) => {
        handlers.set(event, fn);
      },
    } as unknown as Client;

    registerInviteEvents(fakeClient, ctx);
    expect(handlers.has(Events.GuildCreate)).toBe(true);

    const inviteMap = new Map([
      ['CODE1', { code: 'CODE1', uses: 3, inviterId: 'u1', maxUses: 10 }],
    ]);
    await handlers.get(Events.GuildCreate)?.({
      id: 'g-new',
      invites: { fetch: vi.fn(async () => inviteMap) },
    });

    const detected = ctx.services.invite.detectAndRecordJoin('g-new', 'u-join', [
      { code: 'CODE1', uses: 4, inviterId: 'u1', maxUses: 10 },
    ]);
    expect(detected).toEqual({ inviterId: 'u1', inviteCode: 'CODE1' });

    close();
  });
});
