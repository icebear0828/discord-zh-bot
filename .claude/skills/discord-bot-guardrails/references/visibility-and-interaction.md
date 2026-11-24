# Visibility, Interaction Safety & UX Reference

Apply these rules to every slash command, button, select menu, and modal handler to prevent hijacking, 3-second timeouts, 15-minute token errors, and channel spam.

## 1. Public vs Ephemeral Visibility Matrix

| Scenario | Visibility | Implementation Rule |
|---|---|---|
| Validation failure, business error (`!res.ok`), cooldown, insufficient funds | Ephemeral | Reply with `flags: MessageFlags.Ephemeral` immediately; do not pollute the channel. |
| Permission denied or module disabled | Ephemeral | Use `requireGuildMember`, `requireModuleEnabled`, `requireBotAdmin`, or `checkModuleDisabled`. |
| `/菜单` navigation, personal inventory, bank, shop browse, leaderboard paging (`:prev`/`:next`) | Ephemeral | Update the caller's private panel in place; never re-broadcast to channel on page turns. |
| Admin config panels & `/菜单` monitor logs (`admin_*`) | Ephemeral | Always private to the invoking admin. |
| Solo game process (Blackjack Hit/Stand/Double, Slots, Dice, Work, Fortune) | Ephemeral process + optional Public highlight | Keep intermediate states and routine outcomes Ephemeral. Post a Public notice via `sendChannelPublicNotice` / `sendPublicBroadcast` only for Blackjack final battle reports (`buildBlackjackPublicReportEmbed`) and true high-value highlights (Slots jackpot, Dice triple win, Fortune top tier). |
| Multiplayer interactive cards (Duels, Red Packets, Roulette, Number Bomb, Predictions, World Chest/Boss, CP Proposals, Pet Arena, Giveaways, Role Panels) | Public | Post one shared channel card and update that single message in place. |
| Robbery (`/打劫` pocket or bank) | Public outcome, Ephemeral errors | Errors (`!res.ok` or `target.bot`) must be Ephemeral; executed robbery outcomes post publicly with `allowedMentions: { parse: [] }`. |

## 2. Anti-Hijack `ownerId` Rule for Personal Components

- Encode the owning user's ID in `customId` for every personal interactive component:
  `<prefix>:<action>:<ownerId>[:<extra>]` (example: `bj:hit:${userId}`).
- Verify `ownerId === interaction.user.id` before reading or mutating game/user state.
- On mismatch, reply with an Ephemeral error and return immediately without editing the original message.
- For multiplayer cards (e.g. Duels, CP Proposals, Roulette turn actions), verify the clicker matches the expected participant/challenger/target/current-turn user ID from the SQLite record before mutating state.

## 3. Preventing 3-Second Interaction Timeouts (`10062`)

- **Acknowledge immediately:** Whenever a handler performs async fetches, modal-to-write operations, or multiple Discord REST edits, call `await interaction.deferUpdate()` (for component updates) or `await interaction.deferReply({ flags: MessageFlags.Ephemeral })` as the first async step before executing slow work.
- **Error-first ordering:** On any `!res.ok` branch, call `interaction.reply({ ..., flags: MessageFlags.Ephemeral })` **first**, before any optional `message.edit()`.
- **No unnecessary shared-card edits:** Never edit a shared public card on cooldown rejections or already-claimed branches (such as World Boss attack cooldown or already-claimed Chest). Repeated edits hit Discord's 5-edits/5s per-channel rate limit, delay the interaction past 3 seconds (`10062`), and can overwrite `extraLog`.
- **No global batch sweeps in handlers:** Never call `expireDue*()` inside `src/interactions/`. Refresh only the single target record by ID (`expireDuelIfDue(id)`, `expireRouletteById(id)`, `expireNumberBombById(id)`).

## 4. 15-Minute Token Expiry Degradation & Error Code Mapping

Discord interaction webhook tokens expire after 15 minutes, and original messages may be deleted while a panel is open.

| Utility / Location | Behavior |
|---|---|
| `respondFromModal(interaction, msg)` (`src/interactions/menuHelpers.ts`) | If `interaction.isFromMessage()`, tries `interaction.update(msg)`; on failure falls back to Ephemeral `reply` (if not yet acknowledged) or `followUp`. |
| `safeEditOrFollowUp(interaction, msg)` (`src/interactions/menuHelpers.ts`) | Calls `interaction.editReply(msg)`; catches `isTokenOrMessageExpiredError(err)` (`10008` / `50027`) and falls back to Ephemeral `interaction.followUp(msg)`. |
| `formatFriendlyError(err)` (`src/interactions/router.ts`) | Maps Discord error codes via `extractDiscordErrorCode(err)`: `50013` (missing permissions / role hierarchy), `50001` (missing channel access), `10008` / `50027` (15m token expired or message deleted), `10062` (interaction timeout), `50035` (invalid form/length/emoji). |
| Unhandled fallback (`src/interactions/router.ts`) | Wraps `reply`/`update`/`deferReply`/`deferUpdate`/`showModal` to detect silent no-ops and send an Ephemeral fallback plus `unhandled` telemetry. Never rely on this fallback intentionally; every code path must explicitly acknowledge. |

## 5. Pagination & Discord Field Length Limits

- **Select menu pagination:** Always cap `StringSelectMenu` options at `MENU_SELECT_PAGE_SIZE = 20` using `paginateSlice(items, requestedPage, MENU_SELECT_PAGE_SIZE)` from `src/ui/menuShared.ts` (reserves slots below Discord's hard 25-option cap for navigation or helper options).
- **Modal input labels:** Always clamp to 45 characters via `prefilledField` (`menuHelpers.ts`) or `truncateText(label, 45)` (`menuShared.ts`).
- **Button labels:** Always clamp to 80 characters via `makeButton` (`menuShared.ts`).
- **Embed descriptions:** Always clamp to 4096 characters via `truncateDescriptionLines` (`soloFormatters.ts`) or `truncateText(..., 4096)` (`menuShared.ts`).
- **Emoji inputs:** Validate user-supplied emojis with `isValidDiscordEmoji` (`src/services/rolePanelService.ts`) before passing them to Discord builders to avoid `50035`.

## 6. Anti-Spam Broadcast Discipline

- **Single-card live updates:** For multi-turn games like Russian Roulette or Number Bomb, edit the existing public card in place on each turn. Never send a separate `followUp` message for every roulette shot; broadcast at most one concise message at final settlement.
- **No duplicate large Embeds:** Never send a new Embed on pagination clicks (`:prev`/`:next`) or redundant refreshes; update the existing message.
- **Highlight-only public notices:** Restrict channel announcements for solo activities to genuine highlights (Blackjack completed round report, Slots jackpot, Dice triple, Fortune top luck tier).
- **Safe mentions:** Always pass `allowedMentions: { parse: [] }` (default in `sendPublicBroadcast` and `sendChannelPublicNotice`) unless an intentional targeted user ping is explicitly required, and never allow `@everyone` / `@here` / role mass pings from user input.

## 7. High-Risk Action Confirmation Matrix

Every destructive or server-wide action requires a two-step confirmation UI (render confirmation state on first click, execute only on explicit confirm click) and strict privilege checks.

| Action | Required Privilege | Confirmation Mechanism |
|---|---|---|
| Delete shop item | Bot Admin (`isInteractionAdmin`) | Two-step view state (`confirmDeleteItemId`) |
| Delete role panel | Bot Admin (`isInteractionAdmin`) | Two-step view state (`confirmDeletePanelId`) |
| Clear interaction monitor logs | Super Admin (`isGuildSuperAdmin` / `SUPER_ADMIN_DENIED_FEEDBACK`) | Two-step view state (`confirmClear`) |
| Reset AI channel/guild memories or guild config | Super Admin (`isGuildSuperAdmin`) | Explicit confirm button / dedicated confirmation prompt |
| Void prediction or force-end active event | Creator or Bot Admin | Explicit status transition with full escrow refund |
| Server-wide coin grant / random red packet | Bot Admin (`requireBotAdmin` / `isInteractionAdmin`) | Modal parameter entry with `MAX_COIN_AMOUNT` validation |
