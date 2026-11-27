import { describe, expect, it, vi } from 'vitest';
import type { AppContext as CoreAppContext, CommandDefinition as CoreCommandDefinition } from '../../src/core/context.js';
import {
  COLORS,
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  formatDurationZh,
  renderProgressBar,
  type AppContext as EmbedsAppContext,
  type CommandDefinition as EmbedsCommandDefinition,
} from '../../src/ui/embeds.js';
import {
  chainMenuHandlers,
  dispatchByAction,
  splitCustomId,
  type ActionRouteTable,
} from '../../src/interactions/menu/subRouter.js';

type AssertAssignable<To, _From extends To> = true;
const _assertCoreToEmbeds: AssertAssignable<EmbedsAppContext, CoreAppContext> = true;
const _assertEmbedsToCore: AssertAssignable<CoreAppContext, EmbedsAppContext> = true;
const _assertCmdCoreToEmbeds: AssertAssignable<EmbedsCommandDefinition, CoreCommandDefinition> = true;
const _assertCmdEmbedsToCore: AssertAssignable<CoreCommandDefinition, EmbedsCommandDefinition> = true;

describe('core foundation: context & subRouter', () => {
  it('keeps AppContext and CommandDefinition identical between core/context and ui/embeds', () => {
    expect(_assertCoreToEmbeds).toBe(true);
    expect(_assertEmbedsToCore).toBe(true);
    expect(_assertCmdCoreToEmbeds).toBe(true);
    expect(_assertCmdEmbedsToCore).toBe(true);
    expect(COLORS.PRIMARY).toBe(0x5865f2);
    expect(renderProgressBar(0.5, 4)).toBe('██░░');
    expect(formatDurationZh(65_000)).toBe('1分钟5秒');
    expect(createInfoEmbed('t').data.title).toBe('t');
    expect(createSuccessEmbed('s').data.title).toBe('s');
    expect(createErrorEmbed('e').data.title).toBe('e');
  });

  it('parses Discord customId into prefix, section, action, and raw parts', () => {
    expect(splitCustomId('menu:nav:admin_ai:channels')).toEqual({
      prefix: 'menu',
      section: 'nav',
      action: 'admin_ai',
      parts: ['menu', 'nav', 'admin_ai', 'channels'],
    });
    expect(splitCustomId('img:open_workbench')).toEqual({
      prefix: 'img',
      section: 'open_workbench',
      action: undefined,
      parts: ['img', 'open_workbench'],
    });
  });

  it('dispatches exact routes and treats void handlers as handled', async () => {
    const visited: string[] = [];
    const table: ActionRouteTable<{ value: string }> = {
      exact: {
        home: (ctx) => {
          visited.push(`exact:${ctx.value}`);
        },
        decline: () => false,
      },
      prefixes: [
        {
          prefix: 'admin_',
          handle: async (ctx) => {
            visited.push(`prefix:${ctx.value}`);
            return true;
          },
        },
      ],
    };

    expect(await dispatchByAction('home', { value: 'ok' }, table)).toBe(true);
    expect(await dispatchByAction('decline', { value: 'no' }, table)).toBe(false);
    expect(await dispatchByAction('admin_econ', { value: 'cfg' }, table)).toBe(true);
    expect(await dispatchByAction('unknown', { value: 'x' }, table)).toBe(false);
    expect(await dispatchByAction(undefined, { value: 'x' }, table)).toBe(false);
    expect(await dispatchByAction('toString', { value: 'proto' }, table)).toBe(false);
    expect(visited).toEqual(['exact:ok', 'prefix:cfg']);
  });

  it('chains sub-handlers in order and stops at first match', async () => {
    const h1 = vi.fn(async (_id: string) => false);
    const h2 = vi.fn(async (_id: string) => true);
    const h3 = vi.fn(async (_id: string) => true);

    const handled = await chainMenuHandlers([h1, h2, h3], 'menu:solo:daily');
    expect(handled).toBe(true);
    expect(h1).toHaveBeenCalledWith('menu:solo:daily');
    expect(h2).toHaveBeenCalledWith('menu:solo:daily');
    expect(h3).not.toHaveBeenCalled();

    const noneHandled = await chainMenuHandlers([h1], 'menu:other');
    expect(noneHandled).toBe(false);
  });
});
