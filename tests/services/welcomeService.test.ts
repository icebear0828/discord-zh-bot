import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../../src/services/welcomeService.js';

describe('welcomeService', () => {
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
});
