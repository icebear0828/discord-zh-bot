# Persistence, Economy Anti-Exploit & Operational Safety Reference

Apply these rules to every SQLite schema change, repository method, economy/game service, background timer, and AI integration.

## 1. SQLite Idempotent Migration Rules

- **Non-destructive schema init:** Define every table with `CREATE TABLE IF NOT EXISTS` and every index with `CREATE INDEX IF NOT EXISTS` inside a dedicated `init<Domain>Schema(db)` function registered in `src/db/schema.ts#initSchema`.
- **Idempotent column additions:** Add new columns to existing tables via `ensureColumn(db, table, column, definition)` backed by `PRAGMA table_info(<table>)`. Never assume a fresh database; production holds live member balances and records.
- **Safe constraint upgrades:** If an existing table needs a wider `CHECK (...)` constraint (as in `shop_items`), run a single `db.transaction(() => { ... })` that creates `<table>_new`, copies all existing rows with `INSERT INTO ... SELECT ...`, drops the old table, renames `<table>_new`, and recreates indexes.
- **Zero memory-only value state:** Never keep active games, escrowed wagers, cooldowns, or pending offers solely in process memory (`Map` / `Set`). Persist Blackjack (`blackjack_games`), Duels (`duels`), Red Packets (`red_packets`), Roulette (`roulette_games`), Number Bombs (`number_bomb_games`), Predictions (`predictions` / `prediction_bets`), Proposals (`relationship_proposals`), and Pet Battles (`pet_battles`) in SQLite so restarts never lose player funds.
- **Atomic transitions:** Guard every state transition (`claim`, `accept`, `cancel`, `settle`, `expire`) inside `db.transaction(...)` with a conditional SQL update (`WHERE id = ? AND status = 'open'`, verifying `info.changes === 1`) before crediting or refunding coins.

## 2. Economy Anti-Exploit Closed-Loop Checklist

| Mechanism | Required Invariant | Canonical Reference / Constants |
|---|---|---|
| Escrow & refund | Deduct wager/fee atomically on creation; refund 100% atomically on cancel, reject, or timeout expiry. | `db.transaction(...)` + conditional `status` update |
| User-level cooldowns | Store cooldown timestamps per `(guild_id, user_id)` in SQLite (`last_work_at`, `last_rob_at`, `last_pet_work_at`, `rob_shield_until`, `next_attack_at`). Never bypass cooldowns by reopening panels or restarting the process. | `member_profiles`, `world_event_participants` |
| Bet, level & bonus caps | Enforce hard upper bounds on all bets, grants, pet levels, work bonuses, boss bonuses, and daily PVP XP. | `MAX_COIN_AMOUNT`, `MAX_SOLO_GAMBLE_BET`, `PET_MAX_LEVEL`, `PET_WORK_LEVEL_BONUS_CAP`, `PET_BOSS_BONUS_CAP`, `PET_PVP_DAILY_XP_CAP`, `PET_PVP_COOLDOWN_MS`, `PREDICTION_MAX_BET`, `SHOP_MYSTERY_BOX_MIN_PRICE` |
| Sell / refund ratio | Any item resale or refund must return strictly less than or equal to actual purchase price (proportional refund ratio) to prevent infinite buy-sell arbitrage. | `shopService.ts`, `economyConstants.ts` |
| Prediction integrity | 1) Forbid creator from betting on their own prediction. 2) Enforce `open -> locked -> settled` (must lock before settling). 3) Auto-void and refund 100% after `PREDICTION_LOCKED_EXPIRE_MS` (72h) if unsettled. 4) Refund 100% if winning side has 0 bets. | `worldEventService.ts`, `PREDICTION_LOCKED_EXPIRE_MS` |
| System red packets | When `system_funded = 1`, expired unclaimed remainder MUST NOT be credited to the admin/sender's personal wallet. | `red_packets.system_funded`, `multiplayerService.ts` |
| Robbery anti-zero-risk | Require attacker total assets (pocket + bank) >= `ROB_ATTACKER_MIN_ASSETS` / `BANK_ROB_ATTACKER_MIN_ASSETS` and target >= `ROB_TARGET_MIN_COINS` / `BANK_ROB_TARGET_MIN`. On failed rob or trap fine, deduct pocket cash first and automatically draw any remaining fine from `bank_coins`. | `economyService.ts`, `economyConstants.ts` |
| Bot target guard | Reject `target.bot` before deducting fees or mutating state on transfer, robbery, duel, proposal, and bounty commands/handlers. | `target.bot` check at entry |
| Duel bounty anti-farm | Require duel wager >= `Math.max(DUEL_BOUNTY_MIN_BET, Math.ceil(bounty * DUEL_BOUNTY_MIN_BET_RATIO))` before a duel victory can claim an active bounty pool. | `DUEL_BOUNTY_MIN_BET`, `DUEL_BOUNTY_MIN_BET_RATIO` |

## 3. Full-Chain Module Toggles & Single-ID Expiry

- **Every entry point checked:** Enforce `cfg.modules[moduleKey]` on:
  1. Slash commands via `requireModuleEnabled(interaction, ctx, moduleKey, displayName)`
  2. Menu routes via `checkModuleDisabled(ctx, guildId, moduleKey, displayName)`
  3. Direct public-card component handlers (buttons, selects, modals) so disabling a module also blocks clicks on previously posted cards.
- **Single-ID expiry in interactions:** When a user interacts with a time-limited card (Duel, Roulette, Number Bomb, Proposal, Battle), expire only that specific record (`expireDuelIfDue(id)`, `expireRouletteById(id)`, `expireNumberBombById(id)`).
- **Batch expiry only in timers:** Reserve global `expireDue*()` methods exclusively for periodic timers in `src/events/ready.ts`.

## 4. Background Timer Error Isolation (`src/events/ready.ts`)

- Wrap every timer entry point (`runGiveawayTick`, `runRedPacketTick`, `runGamesTick`, `runMonitorPruneTick`) in an outer `try/catch`.
- Inside composite ticks like `runGamesTick`, wrap **each domain sub-task** (roulette, number bomb, prediction lock, world events, proposals, pet battles, blackjack, duels, 72h prediction expiry) in its own `try/catch`.
- Inside every loop over expired items, wrap **each item's Discord message edit / channel send** in an inner `try/catch` logged with the item ID (e.g. `[timer:games:duel:${duel.id}]`), so one deleted channel or missing permission never aborts processing for remaining items.
- Bound log table growth: prune `interaction_logs` periodically with `MONITOR_RETENTION_MS` (14 days) and per-guild row retention caps.

## 5. AI Integration Safety (`src/services/aiService.ts`)

- **Module & channel gate:** Enforce `cfg.modules.ai` and configured allowed/ignored channel rules before calling the LLM client.
- **Attachment limits:** Enforce `MAX_AI_IMAGE_BYTES` (`5 * 1024 * 1024`) on both Discord attachment metadata and downloaded buffer byte length, and cap at `MAX_AI_IMAGES_PER_MESSAGE` (`4`).
- **Prompt-injection & memory scoping:** Strip bot mentions via `stripBotMention`; skip auto-memory extraction when `containsPromptInjectionMemoryTag(userText)` triggers; restrict auto-extracted `[MEMORY:...]` tags strictly to `user` scope (never allow untrusted user prompts to write `guild` or `channel` memories).
- **Output safety:** Split long replies into <= 2000-char Discord chunks and send with safe `allowedMentions` to prevent mass pings.
