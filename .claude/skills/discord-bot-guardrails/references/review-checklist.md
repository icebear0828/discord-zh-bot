# Discord Bot Self-Review & PR Checklist

Audit every new or modified file against these severity-ranked checks before completing a task.

- **P0 (Blocker):** Must be fixed before delivery. Any P0 failure blocks completion.
- **P1 (Warning):** Should be fixed; if intentionally deferred, document the rationale explicitly.
- **P2 (Polish):** Quality and maintainability improvements.

## P0: Blockers (Must Pass 100%)

| ID | Rule | Pass Criteria | Fix Reference |
|---|---|---|---|
| P0-1 | Zero TypeScript `any` | No `: any`, `as any`, `<any>`, or `Array<any>` in `src/` or `tests/`. `pnpm run typecheck && pnpm run lint` pass with 0 errors. | `SKILL.md` Important Rules |
| P0-2 | ESM NodeNext `.js` imports | Every relative local import ends in `.js`. | `SKILL.md` Important Rules |
| P0-3 | SQLite persistence for value-bearing state | No active game, wager, proposal, or cooldown holding coins/items lives solely in `Map`/`Set`. | `references/persistence-and-economy.md` |
| P0-4 | Idempotent non-destructive migrations | New tables use `CREATE TABLE IF NOT EXISTS`; new columns use `ensureColumn` (`PRAGMA table_info`); existing user rows are preserved. | `assets/repo-migration-template.ts` |
| P0-5 | Atomic escrow & refund | Creation deducts and cancel/expire/settle credits inside `db.transaction(...)` with conditional `WHERE status = ...` (`changes === 1`). | `references/persistence-and-economy.md` |
| P0-6 | Economy anti-exploit invariants | System red packets (`system_funded = 1`) never refund to sender; predictions block creator self-bet, lock before settle, and auto-void after 72h; robbery enforces asset thresholds and bank-linked fine deduction; `target.bot` rejected. | `references/persistence-and-economy.md` |
| P0-7 | Auth & `ownerId` protection | Personal buttons/selects verify `ownerId === interaction.user.id`; admin routes verify `requireBotAdmin` / `isInteractionAdmin`; destructive ops verify `isGuildSuperAdmin`. | `references/visibility-and-interaction.md` |
| P0-8 | Full-chain module toggle enforcement | Commands (`requireModuleEnabled`), menus (`checkModuleDisabled`), and direct component handlers all reject actions when `cfg.modules[key]` is false. | `references/persistence-and-economy.md` |
| P0-9 | No `expireDue*(` in interaction handlers | Zero calls to global batch `expireDue*` under `src/interactions/`; handlers only call single-ID expiry methods. | `references/persistence-and-economy.md` |
| P0-10 | 3s timeout & error-first ordering | Slow paths call `deferUpdate`/`deferReply` first; `!res.ok` error paths reply Ephemeral before any optional card edit; cooldown/already-claimed paths do not edit shared cards. | `references/visibility-and-interaction.md` |
| P0-11 | Tests written & passing | New or modified logic has unit tests covering happy path, guard denial, and edge/refund cases; `pnpm test` passes. | `SKILL.md` Important Rules |

## P1: Warnings (Resolve or Justify)

| ID | Rule | Pass Criteria | Fix Reference |
|---|---|---|---|
| P1-1 | Single source of truth constants | Numeric caps, cooldowns, and rates are imported from `src/config/economyConstants.ts` instead of magic literals. | `references/reuse-catalog.md` |
| P1-2 | Zero duplicate helpers | `menuHandler.ts` and sub-handlers import shared helpers from `src/interactions/menuHelpers.ts` instead of local re-declarations. | `references/reuse-catalog.md` |
| P1-3 | Dynamic currency & timezone | UI and service logic read `guildConfig.economy.currencyName`/`currencyEmoji` and `ctx.timezone` (`getDateKey`), with no hardcoded `星币` or `北京时间`. | `references/reuse-catalog.md` |
| P1-4 | 15m token expiry degradation | Modal responses use `respondFromModal`; deferred edits use `safeEditOrFollowUp` handling `10008`/`50027`. | `references/visibility-and-interaction.md` |
| P1-5 | Visibility & anti-spam compliance | Errors and solo game steps are Ephemeral; Blackjack completion and highlights use `sendChannelPublicNotice` with `allowedMentions: { parse: [] }`; no per-shot roulette `followUp` or duplicate Embeds on paging. | `references/visibility-and-interaction.md` |
| P1-6 | Select pagination & Discord limits | Select menus paginate at `MENU_SELECT_PAGE_SIZE` (`20`) via `paginateSlice`; modal labels <= 45 chars; button labels <= 80 chars; embed descriptions <= 4096 chars; custom emojis validated by `isValidDiscordEmoji`. | `references/visibility-and-interaction.md` |
| P1-7 | Two-step confirmation on destructive ops | Delete/clear/reset UI actions require a confirmation step before executing. | `references/visibility-and-interaction.md` |
| P1-8 | Background timer isolation | Every timer sub-task and per-item loop has its own `try/catch` with structured error logging. | `references/persistence-and-economy.md` |
| P1-9 | AI safety gates | Image size/count caps, prompt-injection memory guard, user-only auto-memory scope, and safe mentions enforced. | `references/persistence-and-economy.md` |

## P2: Polish

| ID | Rule | Pass Criteria | Fix Reference |
|---|---|---|---|
| P2-1 | Chinese localization coverage | Slash commands and options use `applyZh` (`src/ui/localization.ts`) for `zh-CN` and `zh-TW`. | `assets/command-template.ts` |
| P2-2 | Shared formatter reuse | Command and `/菜单` views share formatters from `src/ui/soloFormatters.ts` or `src/ui/menuShared.ts` so copy stays consistent. | `references/reuse-catalog.md` |
| P2-3 | Clean static scan | `bash .claude/skills/discord-bot-guardrails/scripts/check-guardrails.sh .` reports 0 failures and no newly introduced warnings. | `scripts/check-guardrails.sh` |
