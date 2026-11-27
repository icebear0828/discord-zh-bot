/**
 * Handler callback for a declarative interaction sub-route.
 * Returning `false` signals that the action was not claimed and lets fallbacks proceed.
 */
export type SubRouteHandler<TInput> = (input: TInput) => Promise<boolean | void> | boolean | void;

/**
 * Prefix-matched fallback route rule evaluated in declaration order.
 */
export interface PrefixRule<TInput> {
  readonly prefix: string;
  readonly handle: SubRouteHandler<TInput>;
}

/**
 * Declarative routing table mapping action keys or prefixes to sub-handlers.
 */
export interface ActionRouteTable<TInput> {
  readonly exact?: Readonly<Record<string, SubRouteHandler<TInput>>>;
  readonly prefixes?: readonly PrefixRule<TInput>[];
}

/**
 * Parsed segments of a colon-delimited Discord component customId.
 */
export interface ParsedCustomId {
  prefix: string;
  section: string | undefined;
  action: string | undefined;
  parts: string[];
}

/**
 * Split a colon-delimited Discord customId into typed segments without mutating callers.
 */
export function splitCustomId(customId: string): ParsedCustomId {
  const parts = customId.split(':');
  return {
    prefix: parts[0] ?? '',
    section: parts[1],
    action: parts[2],
    parts,
  };
}

/**
 * Dispatch an action key against exact handlers and ordered prefix rules.
 * Handlers returning `void` or `true` count as handled; explicit `false` means unhandled.
 */
export async function dispatchByAction<TInput>(
  action: string | undefined,
  input: TInput,
  table: ActionRouteTable<TInput>,
): Promise<boolean> {
  if (!action) {
    return false;
  }

  if (table.exact && Object.prototype.hasOwnProperty.call(table.exact, action)) {
    const exactHandler = table.exact[action];
    if (exactHandler) {
      const result = await exactHandler(input);
      return result !== false;
    }
  }

  if (table.prefixes) {
    for (const rule of table.prefixes) {
      if (action.startsWith(rule.prefix)) {
        const result = await rule.handle(input);
        if (result !== false) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Execute boolean-returning sub-router functions sequentially until one claims the interaction.
 */
export async function chainMenuHandlers<TArgs extends readonly unknown[]>(
  handlers: readonly ((...args: TArgs) => Promise<boolean>)[],
  ...args: TArgs
): Promise<boolean> {
  for (const handler of handlers) {
    if (await handler(...args)) {
      return true;
    }
  }
  return false;
}
