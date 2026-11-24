---
name: discord-bot-guardrails
description: >-
  Enforce architecture reuse, Discord interaction safety, SQLite persistence, and economy anti-exploit guardrails for discord-zh-bot.
  TRIGGER when: creating or modifying Discord slash commands, button/select/modal interaction handlers, SQLite tables or repositories, economy/game mechanics, background timers, or reviewing PRs in discord-zh-bot.
  DO NOT TRIGGER when: editing non-Discord standalone scripts, modifying CI/README prose unrelated to bot runtime, or working on projects outside discord-zh-bot.
allowed-tools:
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash"
---

# Discord Bot Guardrails

Generate and review `discord-zh-bot` commands, interaction handlers, SQLite migrations, and economy services without reinventing helpers, breaking persistence, or introducing Discord API timeout and exploit bugs.

## Overview

This skill combines a **Generator** workflow (lookup existing symbols, then build from verified templates) with a **Reviewer** workflow (severity-ranked checklist plus static verification). Every rule maps directly to real modules in `src/` so new code matches repository conventions on the first pass.

## When to Use

- Add or update a slash command in `src/commands/`
- Add or refactor a button, select menu, or modal handler in `src/interactions/`
- Add or migrate a SQLite table or repository in `src/db/`
- Implement or tune economy, gambling, social game, world event, or AI features in `src/services/`
- Review a diff or PR for interaction safety, persistence durability, and anti-exploit regressions

## Important Rules

1. Never use TypeScript `any` (`: any`, `as any`, `<any>`); use concrete types, `unknown` narrowing, or generics.
2. Use ESM NodeNext relative imports ending in `.js` for all local TypeScript modules.
3. Never hardcode currency names (such as `星币`) or timezone strings (such as `北京时间`) outside `src/config/defaults.ts`, migrations, or tests; always read `guildConfig.economy.currencyName` and `ctx.timezone`.
4. Never re-declare helpers already exported by `src/interactions/menuHelpers.ts`, `src/commands/guards.ts`, `src/ui/soloFormatters.ts`, or `src/config/economyConstants.ts`.
5. Never store value-bearing or active game state solely in memory (`Map` or `Set`); persist it in SQLite with idempotent `CREATE TABLE IF NOT EXISTS` and `ensureColumn`.
6. Never call global batch `expireDue*()` methods inside `src/interactions/`; use single-ID expiry methods in handlers and keep batch sweeps in background timers.
7. Require explicit user confirmation before any destructive schema rewrite, table drop, data wipe, or network/deployment change.
8. Follow TDD: add or update unit tests before marking any feature or fix complete.

## Key Workflows

### Phase 1: Lookup & Reuse Gate

**Goal:** Identify every existing constant, helper, guard, formatter, and repository that the task must reuse before writing code.

1. Read the reuse catalog first:
   Read: .claude/skills/discord-bot-guardrails/references/reuse-catalog.md
2. Search `src/` with `Grep` or `Glob` for the target domain (command group, service, repository, menu builder) to confirm current signatures and avoid duplicate definitions.
3. List the exact symbols you will import from `economyConstants.ts`, `guards.ts`, `menuHelpers.ts`, `soloFormatters.ts`, `menuShared.ts`, and existing repositories.

**Gate:** Do NOT proceed to Phase 2 until you have verified that no equivalent constant, helper, formatter, or repository method already exists in the codebase.

### Phase 2: Guided Generation

**Goal:** Implement the requested change using on-demand domain references and verified zero-`any` templates.

Load only the reference(s) and template(s) matching the files you will edit:

| Task Scope | Reference to Read | Template to Read |
|---|---|---|
| Slash command (`src/commands/`) | `.claude/skills/discord-bot-guardrails/references/visibility-and-interaction.md` | `.claude/skills/discord-bot-guardrails/assets/command-template.ts` |
| Button / select / modal (`src/interactions/`) | `.claude/skills/discord-bot-guardrails/references/visibility-and-interaction.md` | `.claude/skills/discord-bot-guardrails/assets/interaction-handler-template.ts` |
| SQLite table / repository (`src/db/`) | `.claude/skills/discord-bot-guardrails/references/persistence-and-economy.md` | `.claude/skills/discord-bot-guardrails/assets/repo-migration-template.ts` |
| Economy / game / timer / AI (`src/services/`, `src/events/ready.ts`) | `.claude/skills/discord-bot-guardrails/references/persistence-and-economy.md` | `.claude/skills/discord-bot-guardrails/assets/repo-migration-template.ts` |

Execute the implementation steps:

1. Read the applicable reference file(s) using the exact paths above.
2. Read the applicable template file(s) and adapt their structure, guard order, and error-handling flow to the task.
3. Enforce module toggles (`requireModuleEnabled` or `checkModuleDisabled`), `target.bot` rejection, `ownerId` checks on personal components, and `allowedMentions: { parse: [] }` on public broadcasts.
4. Add or update unit tests covering happy paths, permission/module denials, invalid inputs, and rollback/refund edge cases.

**Gate:** Do NOT proceed to Phase 3 until implementation and unit tests are written and match the loaded reference rules.

### Phase 3: Self-Review & Static Gate

**Goal:** Catch P0 blockers, static violations, and regressions before reporting completion.

1. Read the severity-ranked checklist:
   Read: .claude/skills/discord-bot-guardrails/references/review-checklist.md
2. Audit every modified file against all **P0 (Blocker)**, **P1 (Warning)**, and **P2 (Polish)** items in the checklist.
3. Run the static guardrail scan against the repository root:
   ```bash
   bash .claude/skills/discord-bot-guardrails/scripts/check-guardrails.sh .
   ```
4. Run the full TypeScript, lint, and test verification suite:
   ```bash
   pnpm run typecheck && pnpm run lint && pnpm test
   ```
5. Fix every P0 failure and static violation, then re-run the failed checks until green. Report any remaining P1 items explicitly with rationale.

**Gate:** Do NOT claim completion if any P0 item, static scan failure, typecheck error, lint error, or test failure remains unresolved.

## Common Pitfalls

- Do not edit a shared public card before replying on `!res.ok` error branches; reply Ephemeral first to avoid rate-limit cascades (`10062 Unknown interaction`) and wiping `extraLog`.
- Do not put more than 20 options into a `StringSelectMenu`; paginate with `paginateSlice` and `MENU_SELECT_PAGE_SIZE`.
- Do not exceed Discord length limits: clamp Modal input labels to 45 chars (`prefilledField` / `truncateText`), button labels to 80 chars (`makeButton`), and Embed descriptions to 4096 chars (`truncateDescriptionLines` / `truncateText`).
- Do not refund `system_funded` red packet remainders to the admin's personal wallet.
- Do not let one failing channel or record abort a background timer loop; isolate each sub-task and item in its own `try/catch`.
