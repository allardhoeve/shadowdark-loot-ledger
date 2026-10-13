# Loot Ledger: code review

Reviewed: `scripts/add-loot.js` (1,890 lines), as of 13 October 2026.
Reviewed against: Foundry VTT 14 and Shadowdark 4.0.6, using the source code of both.

Line numbers below refer to `scripts/add-loot.js`. They will drift once the file changes; search for the quoted code if they no longer match.

## Summary

The code is careful about what matters, and much more careful than you'd expect from a first module. Its weaknesses are size and over-defensiveness rather than carelessness. There is one real bug, which is the duplicate-transfer problem you already know about, and it has a simple fix (see below).

## What's good

- **The security is better than in many published modules.** When a player's request arrives over the socket, the GM checks who actually sent it using the sender ID Foundry provides, not the name the message claims (lines 238-260). The GM also re-checks that the player owns the character before changing its inventory (lines 1093 and 1173). The player's screen is not trusted.
- **Text is escaped wherever it's shown.** Item names, descriptions, locations and history are all escaped before being put on screen, so nobody can inject HTML through an item name. The small Markdown formatter escapes the text first and only then adds bold and italics (lines 14-24), which is the right order.
- **The slot check uses Shadowdark's own rules.** To preview "what if this item were added", it temporarily wraps the character's data so Shadowdark's own slot calculation counts the new item as well (lines 620-628). That avoids copying Shadowdark's rules. It's clever, though fragile (see point 4).
- **Retries don't double up.** If a request times out and the player clicks again, it reuses the same request ID (lines 293-299). The GM recognises the ID from a stored receipt and returns the earlier result instead of doing it twice.
- **No inline styles.** All styling is done through CSS classes.

## The duplicate-transfer bug: cause and fix

**Cause.** In lines 190-197, the "leader" (the GM client that handles requests) is chosen as the active GM user with the lowest ID. If the same GM account is logged in on two clients (say a laptop and a second screen), both pass that check. Both receive the player's request, both read the ledger before either has saved, and both create the item. That matches the incident in your notes: two items with the same `recordId` and `transferId`.

The existing safeguards (the pending marker and the reconciliation code) can't stop this, because both clients pass every check before either one writes anything.

**Fix.** When creating the item in `executeTakeTransfer` (around line 1200-1210), give it a fixed ID taken from the request ID, and tell Foundry to keep it:

```js
itemData._id = requestId;  // already a 16-character Foundry ID
await actor.createEmbeddedDocuments("Item", [itemData], { keepId: true });
```

The Foundry server refuses a second item with the same ID on the same character, with the error "The _id [...] already exists within the parent collection". So the second GM client gets an error instead of creating a duplicate, and the server makes sure exactly one item is created, however many GM clients are open.

The second client will then report an error even though the transfer succeeded. It should treat "already exists" as "someone else already did this" and stay quiet, or simply stop processing.

With that in place, most of the pending/reconcile machinery for Take Loot (lines 1157-1341) could be removed later.

## Bigger structural points

### 1. It all lives in one 1,890-line file

Treasury, socket messaging, ledger maths, stash, take, return, delete, the detail window and Add Loot are all in `add-loot.js`, which is also a misleading name now. For an AI working on it this is the biggest problem: every change means re-reading everything, and a fix in one area can quietly break another.

Suggested split, about five files:

- `socket.js`: sending requests to the GM and handling them
- `ledger.js`: records and holdings maths
- `treasury.js`
- `transfer.js`: Take Loot, Return, Sold
- `ui.js`: the windows

### 2. It uses the old `Dialog` class for all 9 windows, plus jQuery

Foundry deprecated this window system (Application V1) in v13 and will remove it by v16. The `buttons: {}` crash in your notes is a sign of it. Moving to `DialogV2` / `ApplicationV2` (`foundry.applications.api.ApplicationV2`) is the bulk of the refactor work, and it would also handle tab switching for you (point 7).

### 3. The code is very defensive, and that makes it hard to read

Typical AI hedging:

- Quantities are read as `quantity ?? amount ?? count` and locations as `location ?? stashName ?? name`, for data layouts that never existed. The module wrote all the data itself, so there's only one layout.
- After almost every save it reads the setting back to confirm Foundry saved it (lines 849, 880, 1019, 1135). If the save had failed, it would already have thrown an error.
- The rollback-of-the-rollback paths (lines 1013-1016 and 1237-1240) may never run once and would be very hard to test.

I'd estimate a third of the file is this kind of code. Every line of it is something an AI has to read and keep consistent.

### 4. The slot preview depends on Shadowdark's internals

The wrapping trick (lines 620-628) works only because Shadowdark's slot calculation happens to fetch the item list through the same object. If Shadowdark changes how it does that, the preview quietly gives wrong numbers. This is acceptable, but it deserves a comment in the code and a quick re-test after each Shadowdark update.

### 5. The whole ledger is one world setting

Every record, including a full copy of the item, its history and up to 64 retry receipts, sits in a single array. Any change rewrites the whole array and sends it to every client. That's fine for a few dozen items, and it's a reasonable choice for a first version. The receipts are the part that grows without limit, so trim those first.

## Smaller things

6. **The ledger opens for everyone, every time the world loads** (line 57). Players may find that annoying. A user setting to turn it off would be enough.
7. **Switching tabs discards unsaved edits.** Each tab click rebuilds the detail window from scratch (lines 1673-1678), so half-typed text in Edit is lost.
8. **Some text is still in Dutch.** For example, "Terug naar Unassigned" at lines 647, 708 and 711. It sits in the hidden stash code, but it will show once stash is switched back on.
9. **The console is noisy.** Every socket message is logged at info or debug level (lines 205-273). That was useful while chasing the bug, but it should be reduced before release.
10. **A second GM account can't add loot.** Only the "leader" GM sees Add Loot (`canEditRecords`, line 199). An assistant GM will wonder why the drop zone is missing.
11. **The toolbar button is added even when the game system isn't Shadowdark** (line 64). The rest of the module checks for Shadowdark first (line 55).
12. **The market value is free text** such as "5 gp", which is then parsed again just for sorting (lines 369-377). Storing a number in gold pieces would be simpler. It's not urgent.
13. **An empty character list has no explanation.** In Take Loot, players only see characters they own (lines 602-609). When they own none, the dropdown just says "Select an Actor" with nothing under it. A line like "You don't own any characters with an inventory. Ask your GM to give you ownership" would save confusion.

## Suggested order

1. **First:** the fixed item ID fix for duplicate transfers. It's about 5 lines, and it turns "only one GM client" from a house rule into a guarantee.
2. **Next:** split the file, and remove the defensive code as part of the split.
3. **Then:** move the windows to ApplicationV2.
