# Plan: move ledger storage into a journal

Move the Loot Ledger's data out of the world settings `lootRecords` and `treasury` and into one journal, the **ledger journal**. The journal holds custom page types and every user owns it. Players then write the ledger directly and the GM relay goes away.

All code is in `scripts/add-loot.js`; line numbers refer to commit `55fc406`. Foundry source paths are relative to `~/devel/foundry-homebrew/third_party/foundryvtt` (v14).

## Decisions

These have been questioned and settled. Build on them as given.

- **Storage is a journal with custom page types.** World settings are writable only by users with `SETTINGS_MODIFY` (Assistant GM and up), so players needed the relay. A page type is the intended way for a module to add typed data to a journal; a plain journal with JSON in it is not.
- **One page per loot record, plus one treasury page.** A Foundry update only sends the fields that changed, so saves to different records never overwrite each other. A single array would be replaced whole on every save.
- **Every user is Owner, through `ownership.default = OWNER`.** New players are covered automatically, so no hook keeps ownership in sync.
- **The GM relay is removed.** Each client writes the ledger itself. Players can give items only to characters they own (`OWNER`), so no action needs the GM's client.
- **A missing journal is an error, not a fallback.** Only the GM's client creates the ledger journal. Until then, players see: "The GM must log in once before this works."
- **Deletes are blocked by `preDelete` hooks that return `false`.** The ledger's own "Delete record" action passes the option `{ lootLedger: true }`, and only that option gets through.
- **Treasury collisions are accepted.** If two users save the treasury at the same moment, the last save wins.

## Open decision: crash safety

Ask the user before step 5. Do not pick one yourself.

An action like Take changes two documents, the record page and a character's Item, and neither save can undo the other. Today this is handled by `pendingActorMutation`, mutation receipts, and the "Review interrupted action" dialog (`:797`–`:1122`, `:1308`, `:1462`). A lot of that complexity comes from the relay: retries, timeouts, and duplicate processing by two GM clients.

- **Keep:** port the machinery as it is, storing the pending fields on the record page.
- **Simplify:** fix the order. Change the character first, then the record. If the record save fails, show a warning naming the Item and the record. Drop the receipts and the review flow.

## Assumptions this plan takes for granted

These were not questioned. Raise them with the user if one blocks you:

- each record keeps an **item snapshot** (`snapshot.itemData`);
- the **Stash** code stays and keeps working, with its UI hidden (`SHOW_STASH_UI`);
- adding loot stays **GM-only** in the UI.

## Foundry facts

- `JournalEntry` has no subtypes. `JournalEntryPage` does (`hasTypeData`, `common/documents/journal-entry-page.mjs:27`).
- A module declares page types in `module.json` under `documentTypes.JournalEntryPage`. The full type name gets the module prefix: `loot-ledger.record`. Example of an Actor subtype: `~/devel/foundry-homebrew/module/module.json` and `module/src/party-actor.js`.
- Pages inherit the journal's ownership by default (`journal-entry-page.mjs:74`). Creating or deleting a page needs Owner on the journal (`:33`).
- Creating a journal needs `JOURNAL_CREATE`, which is Trusted and up by default (`common/constants.mjs:1315`). That is why only the GM creates the ledger journal.
- Players see a journal in the sidebar from Observer up (`client/documents/journal-entry.mjs:29`). With default Owner, every user sees the ledger journal.
- Register page sheets with `DocumentSheetConfig.registerSheet` (`client/applications/apps/document-sheet-config.mjs:409`). Base class: `JournalEntryPageHandlebarsSheet` (`client/applications/sheets/journal/journal-entry-page-hbs-sheet.mjs`).
- Foundry has no locking or version checks on updates; the last save wins.

## Steps

### 1. Declare the page types

Add `"documentTypes": { "JournalEntryPage": { "record": {}, "treasury": {} } }` to `module.json` and remove `"socket": true`. In `init`, register a `TypeDataModel` for each type in `CONFIG.JournalEntryPage.dataModels`:

- **record**: one field for each top-level key of the record object built in `openAddLoot` (`:1850`). Drop `id`; the page's `_id` replaces it. Keep `history`. Keep the pending/receipt fields only if the open decision is **Keep**. Use the page `name` for the item name.
- **treasury**: `gp`, `sp`, `cp` as non-negative integer fields. These replace `validateTreasuryAmounts` (`:87`).

Done when Foundry starts without errors and a GM can create a page of each type from the console with default values.

### 2. Find or create the ledger journal

Identify the ledger journal by the flag `flags["loot-ledger"].ledger === true`, not by its name, so renaming it is harmless. On `ready`:

- **GM client:** if there is no ledger journal, create "Party Loot Ledger" with `ownership: { default: OWNER }`, the flag, and one treasury page.
- **Any client:** if the journal is still missing, opening the ledger shows "The GM must log in once before this works." and stops.

If two ledger journals exist, use the oldest (`_stats.createdTime`) and log a warning.

Done when a fresh world gets exactly one ledger journal on the first GM login, and a player who logs in before that sees the message.

### 3. Migrate existing settings

On the GM's `ready`, after step 2: if the ledger journal has no flag `migratedFromSettings` and `lootRecords` is non-empty, create one record page per record and copy `treasury` into the treasury page. Then set `migratedFromSettings` on the journal. Keep the two settings registered and leave their data in place for one release as a backup.

Done when a world with existing records shows the same records, holdings, history and treasury after migrating, and a second GM login creates no duplicates.

### 4. Switch reads and writes to pages

Every function that touches the two settings changes. Find them all with `grep -n "RECORDS_SETTING\|TREASURY_SETTING\|currentRecords\|writeRecords\|currentTreasury" scripts/add-loot.js`.

- `currentRecords()` reads the record pages of the ledger journal.
- `writeRecords(records)` turns into a per-record `page.update(changes)`. Pass only the fields that changed, so the per-record merge does its job.
- Adding a record turns into `journal.createEmbeddedDocuments("JournalEntryPage", ...)`.
- The setting `onChange` re-renders become `createJournalEntryPage`, `updateJournalEntryPage` and `deleteJournalEntryPage` hooks. They only re-render when the page belongs to the ledger journal.

Done when `grep -n "game.settings" scripts/add-loot.js` shows only the setting registrations and the reads in the migration from step 3.

### 5. Remove the relay

Before you start: get the answer to the open decision.

Delete `registerMutationSocket`, `requestMutation`, `serializeWorldMutation`, `isMutationLeader`, `activeMutationLeaderId`, `SOCKET_CHANNEL`, `pendingMutationRequests` and `retryableMutationIds`. UI handlers call `performMutation` (or the perform function for that action) directly, with `game.user` as the requester. Rename `canEditRecords` (`:198`) to say what it checks now, "is GM". Apply the chosen crash-safety option here.

Done when `grep -n "socket\|Leader\|requestMutation" scripts/add-loot.js` returns nothing, and every action in the old `MUTATION_ACTIONS` works for a player while no GM is logged in.

### 6. Limit target characters to owned ones

`transferActors` (`:601`) and `actorHoldingsAvailableToUser` (`:1362`) already filter on Owner in the UI. Add the same check inside each perform function that changes an Actor, so a stale dialog cannot write to someone else's character. GMs pass every check.

Done when every `createEmbeddedDocuments`, `updateEmbeddedDocuments` and `deleteEmbeddedDocuments` call on an Actor follows an Owner check for `game.user`.

### 7. Block deletes

Register `preDeleteJournalEntry` and `preDeleteJournalEntryPage`. For the ledger journal, and for any page in it, return `false` unless `options.lootLedger === true`. Pass that option from the ledger's delete-record action (`performDeleteRecord`, `:1122`).

Done when deleting the journal or a page from Foundry's own UI does nothing, and "Delete record" in the ledger still deletes the page.

### 8. Readable page sheets

Register a sheet for each type, based on `JournalEntryPageHandlebarsSheet`, that shows the data read-only:

- **record:** item name, quantity found, current holdings (reuse `holdingLines`, `:333`), and the history as a dated log.
- **treasury:** the three amounts.

Editing stays in the ledger window.

Done when opening the ledger journal shows readable pages, without JSON, for a record with history and for the treasury.

### 9. Verify in Foundry

The repo has no automated tests. Check by hand, in a world with one GM and one player client, each logged in as a different user:

- a fresh world as in step 2, and migration as in step 3;
- every action from `MUTATION_ACTIONS`, run by the player while the GM is logged out;
- the player cannot target a character they don't own;
- both delete blocks from step 7;
- with the GM and the player each running Take on a different record at the same moment, both records end up correct.

Done when every item above has been run and its result written in the PR description.
