# Reuse Catalog & Anti-Hardcoding Reference

Always import existing constants, guards, helpers, formatters, and repositories from their canonical source instead of re-implementing or hardcoding values.

## 1. Economy & Game Constants (`src/config/economyConstants.ts`)

Single source of truth for economic caps, robbery formulas, cooldowns, and expiry durations. Import named constants or `ECONOMY_CONSTANTS`.

| Domain | Exported Constants |
|---|---|
| Global cap | `MAX_COIN_AMOUNT` (`1_000_000_000`) |
| Pocket robbery | `ROB_TARGET_MIN_COINS`, `ROB_ATTACKER_MIN_ASSETS`, `ROB_STEAL_MIN_RATE`, `ROB_STEAL_MAX_RATE`, `ROB_STEAL_MIN_AMOUNT`, `ROB_STEAL_MAX_AMOUNT`, `ROB_FINE_RATE`, `ROB_FINE_MIN`, `ROB_FINE_MAX`, `ROB_TRAP_FINE_RATE`, `ROB_TRAP_FINE_MIN`, `ROB_TRAP_FINE_MAX`, `ROB_LOCKPICK_BONUS`, `ROB_LOCKPICK_CAP` |
| Bank vault robbery | `BANK_ROB_TARGET_MIN`, `BANK_ROB_ATTACKER_MIN_ASSETS`, `BANK_ROB_STEAL_MIN_RATE`, `BANK_ROB_STEAL_MAX_RATE`, `BANK_ROB_STEAL_MIN`, `BANK_ROB_STEAL_MAX`, `BANK_ROB_FINE_RATE`, `BANK_ROB_FINE_MIN`, `BANK_ROB_FINE_MAX`, `BANK_ROB_TRAP_FINE_RATE`, `BANK_ROB_TRAP_FINE_MIN`, `BANK_ROB_TRAP_FINE_MAX`, `BANK_ROB_LOCKPICK_BONUS`, `BANK_ROB_LOCKPICK_CAP` |
| Gambling & duels | `MAX_SOLO_GAMBLE_BET`, `BLACKJACK_TTL_MS`, `DUEL_TTL_MS`, `DUEL_BOUNTY_MIN_BET_RATIO`, `DUEL_BOUNTY_MIN_BET` |
| Pets & world boss | `PET_MAX_LEVEL`, `PET_WORK_COOLDOWN_MS`, `PET_WORK_LEVEL_BONUS_CAP`, `PET_BOSS_BONUS_CAP`, `PET_PVP_DAILY_XP_CAP`, `PET_PVP_COOLDOWN_MS`, `BOSS_LIGHT_ATTACK_COOLDOWN_MS`, `BOSS_HEAVY_ATTACK_COOLDOWN_MS` |
| Shop, predictions & monitoring | `SHOP_MYSTERY_BOX_MIN_PRICE`, `PREDICTION_MAX_BET`, `PREDICTION_LOCKED_EXPIRE_MS`, `MONITOR_RETENTION_MS` |

## 2. Shared Interaction & Menu Helpers (`src/interactions/menuHelpers.ts`)

All menu and component handlers (`menuHandler.ts`, `gamesMenuHandler.ts`, `configMenuHandler.ts`, `aiMenuHandler.ts`, and domain handlers) must import from `menuHelpers.ts` rather than defining local duplicates.

| Category | Exported Symbols | Purpose |
|---|---|---|
| Types & feedback | `MenuSupportedInteraction`, `ADMIN_DENIED_FEEDBACK`, `SUPER_ADMIN_DENIED_FEEDBACK` | Shared interaction union and standard permission-denied banners |
| Actor & auth | `isGuildSuperAdmin`, `getActor`, `resolveActor`, `isInteractionAdmin` | Resolve actor metadata, Bot admin status, and Guild super-admin status (`resolveActor` fetches uncached members safely) |
| Error inspection | `extractDiscordErrorCode`, `isTokenOrMessageExpiredError` | Normalize Discord API error codes and detect `10008` / `50027` token/message expiry |
| Input parsers | `parsePositiveInt`, `parseNonNegativeInt`, `parseIntInRange`, `parseNumberInRange` | Strict numeric validation returning `number \| null` with `Number.isSafeInteger` / `Number.isFinite` checks |
| Modal & module guards | `prefilledField`, `checkModuleDisabled` | Build `TextInputBuilder` rows with `truncateText(label, 45)`; check `cfg.modules[key]` |
| Response degradation | `respondFromModal`, `safeEditOrFollowUp` | Gracefully fall back to Ephemeral `reply`/`followUp` when original message or 15m webhook token expires |
| Channel messaging | `sendPublicBroadcast`, `sendToChannel`, `editChannelMessage` | Send broadcasts with default `allowedMentions: { parse: [] }` and safe channel/message fetch |

## 3. Command Guards & Permissions (`src/commands/guards.ts`, `src/services/permissionService.ts`)

| Module | Exported Symbols | Purpose |
|---|---|---|
| `src/commands/guards.ts` | `checkMemberIsBotAdmin`, `requireGuildMember`, `requireModuleEnabled`, `requireBotAdmin` | Standard slash-command guild check, module toggle gate, and Bot admin gate (replies Ephemeral on denial) |
| `src/services/permissionService.ts` | `isBotAdmin` | Pure permission check combining `Administrator`, `ManageGuild`, `adminRoleIds`, and `adminUserIds` |

## 4. Shared Formatters & UI Utilities

| Module | Exported Symbols | Purpose |
|---|---|---|
| `src/ui/soloFormatters.ts` | `EconomyDisplayConfig`, `truncateDescriptionLines`, `formatWorkResultEmbed`, `formatPocketRobError`, `formatBankRobError`, `formatPocketRobResultEmbed`, `formatBankRobResultEmbed`, `buildBlackjackPublicReportEmbed`, `formatSoloBetError`, `buildSlotsResultEmbed`, `buildSlotsHighlightEmbed`, `buildDiceResultEmbed`, `buildDiceHighlightEmbed`, `buildFortuneHighlightEmbed`, `ChannelBroadcastLikeInteraction`, `sendChannelPublicNotice` | Unified rendering for solo economy/gambling commands and `/菜单` views so both paths share identical copy, dynamic currency, 4096-safe line truncation, and highlight broadcasts |
| `src/ui/menuShared.ts` | `MENU_SELECT_PAGE_SIZE` (`20`), `paginateSlice`, `truncateText`, `makeButton`, `buttonRow`, `resolveColor`, `withFeedback`, `formatRatePercent`, `formatShopItemTag`, `formatInventoryTypeLabel`, `formatShopBuyError` | Pagination (20 items/page), safe label/description truncation, button row builders, and shop formatting |
| `src/ui/embeds.ts` | `AppContext`, `CommandDefinition`, `COLORS`, `renderProgressBar`, `formatDurationZh`, `createInfoEmbed`, `createSuccessEmbed`, `createErrorEmbed` | Core types, theme colors, Chinese duration formatting, and standard Embed constructors |
| `src/ui/localization.ts` | `applyZh`, `applyZhName` | Attach `zh-CN` and `zh-TW` name/description localizations to `SlashCommandBuilder` and options |
| `src/services/rolePanelService.ts` | `isValidDiscordEmoji`, `computeRoleDiff` | Validate custom (`<a?:name:id>`) and Unicode emojis before calling Discord API; compute single/multi role diffs |

## 5. SQLite Repositories (`src/db/repositories/` & `src/db/schema.ts`)

Always access persistence through `ctx.repos.*` rather than writing ad-hoc SQL in commands or interaction handlers.

| Repo File | `ctx.repos` Key | Primary Tables | Schema Initializer |
|---|---|---|---|
| `guildConfigRepo.ts` | `guildConfig` | `guild_configs` | `src/db/schema.ts` |
| `profileRepo.ts` | `profile` | `member_profiles`, `level_role_rewards` | `src/db/schema.ts` |
| `shopRepo.ts` | `shop` | `shop_items`, `user_inventory` | `src/db/schema.ts` |
| `funRepo.ts` | `fun` | `fun_fortunes`, `fun_interactions` | `src/db/schema.ts` |
| `ticketRepo.ts` | `ticket` | `tickets` | `src/db/schema.ts` |
| `giveawayRepo.ts` | `giveaway` | `giveaways`, `giveaway_entries` | `src/db/schema.ts` |
| `inviteRepo.ts` | `invite` | `invite_records` | `src/db/schema.ts` |
| `rolePanelRepo.ts` | `rolePanel` | `role_panels`, `role_panel_options` | `src/db/schema.ts` |
| `redPacketRepo.ts` | `redPacket` | `red_packets`, `red_packet_claims` | `initRedPacketSchema` |
| `chaosRepo.ts` | `chaos` | `user_props`, `user_effects`, `bounties`, `roulette_games`, `number_bomb_games` | `initChaosSchema` |
| `worldEventRepo.ts` | `worldEvent` | `predictions`, `prediction_bets`, `world_events`, `world_event_participants` | `initWorldEventSchema` |
| `socialPetRepo.ts` | `socialPet` | `relationships`, `relationship_proposals`, `user_pets`, `pet_battles` | `initSocialPetSchema` |
| `aiMemoryRepo.ts` | `aiMemory` | `ai_memories`, `ai_channel_resets` | `initAiSchema` |
| `blackjackRepo.ts` | `blackjack` | `blackjack_games` | `initBlackjackSchema` |
| `duelRepo.ts` | `duel` | `duels` | `initDuelSchema` |
| `monitorRepo.ts` | `monitor` | `interaction_logs` | `initMonitorSchema` |
| `creditLoanRepo.ts` | `creditLoan` | credit/loan tables (when module present) | `initCreditLoanSchema` |
| `rpgRepo.ts` | `rpg` | RPG tables (when module present) | `initRpgSchema` |

## 6. Dynamic Config & Timezone Rules

- **Currency display:** Always read `const econ = ctx.repos.guildConfig.getOrCreate(guildId).economy;` and render `${econ.currencyEmoji}` and `${econ.currencyName}`. Never hardcode `星币` in commands, services, handlers, or UI builders (allowed only in `src/config/defaults.ts`, migrations, and test fixtures).
- **Timezone & date keys:** Always read `ctx.timezone` (or the service constructor's `timezone` option) and compute daily boundaries via `getDateKey(nowMs, timezone)` and `getPreviousDateKey(nowMs, timezone)` from `src/services/economyService.ts`. Never hardcode `北京时间` or fixed `+8` offsets in business logic or user-facing UI strings.
