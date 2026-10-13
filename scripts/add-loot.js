const MODULE_ID = "loot-ledger";
const RECORDS_SETTING = "lootRecords";
const TREASURY_SETTING = "treasury";
const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const MUTATION_ACTIONS = new Set(["take", "stash", "return-to-unassigned", "sold", "return-actor", "delete", "treasury"]);
const TREASURY_CURRENCIES = ["gp", "sp", "cp"];
const MUTATION_RECEIPT_LIMIT = 64;
// Keep Stash implementation and stored holdings intact; flip this flag to restore its UI later.
const SHOW_STASH_UI = false;
let ledgerDialog;
let ledgerHtml;

const escape = value => foundry.utils.escapeHTML(String(value ?? ""));
function descriptionMarkup(value) {
  const paragraphs = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n[\t ]*\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  const renderInline = text => escape(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return paragraphs.map(paragraph => `<p>${renderInline(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
}
const clone = value => foundry.utils.deepClone(value);
const activeTransfers = new Set();
let worldMutationQueue = Promise.resolve();
const pendingMutationRequests = new Map();
const retryableMutationIds = new Map();
const treasuryFormStates = new WeakMap();
let recordSortMode = "status";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, RECORDS_SETTING, {
    name: "Loot Ledger Records",
    hint: "Internal Loot Ledger records.",
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => renderRecordList()
  });
  game.settings.register(MODULE_ID, TREASURY_SETTING, {
    name: "Loot Ledger Treasury",
    hint: "Shared Loot Ledger party currency.",
    scope: "world",
    config: false,
    type: Object,
    default: { gp: 0, sp: 0, cp: 0 },
    onChange: () => renderTreasury()
  });
});

Hooks.once("ready", () => {
  if (game.system.id !== "shadowdark") return;
  registerMutationSocket();
  openLedger();
  if (canEditRecords()) {
    const pending = currentRecords().filter(record => record.pendingActorMutation);
    if (pending.length) ui.notifications.warn(`${pending.length} interrupted Loot Ledger Actor change(s) need review. Foundry did not change Actor inventories during startup; open the affected record and choose Review interrupted action.`);
  }
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user || !controls.tokens?.tools) return;
  controls.tokens.tools.lootLedger = {
    name: "lootLedger",
    title: "Loot Ledger",
    icon: "fa-solid fa-coins",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    onChange: () => openLedger()
  };
});

function currentRecords() {
  return clone(game.settings.get(MODULE_ID, RECORDS_SETTING) ?? []);
}

function currentTreasury() {
  const stored = game.settings.get(MODULE_ID, TREASURY_SETTING) ?? {};
  return Object.fromEntries(TREASURY_CURRENCIES.map(currency => {
    const amount = stored[currency];
    return [currency, Number.isSafeInteger(amount) && amount >= 0 ? amount : 0];
  }));
}

function validateTreasuryAmounts(data) {
  const amounts = {};
  for (const currency of TREASURY_CURRENCIES) {
    const raw = data?.[currency];
    const text = typeof raw === "string" ? raw.trim() : String(raw ?? "");
    if (!/^\d+$/.test(text)) throw new Error(`${currency.toUpperCase()} must be a non-negative whole number.`);
    const amount = Number(text);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`${currency.toUpperCase()} must be a valid non-negative whole number.`);
    amounts[currency] = amount;
  }
  return amounts;
}

function sameTreasury(left, right) {
  return TREASURY_CURRENCIES.every(currency => left?.[currency] === right?.[currency]);
}

async function saveTreasury(data, requester) {
  if (!requester?.active || (!requester.isGM && requester.role < CONST.USER_ROLES.PLAYER)) {
    throw new Error("This Foundry user is not allowed to update the Treasury.");
  }
  const amounts = validateTreasuryAmounts(data);
  await game.settings.set(MODULE_ID, TREASURY_SETTING, amounts);
  const saved = currentTreasury();
  if (TREASURY_CURRENCIES.some(currency => saved[currency] !== amounts[currency])) {
    throw new Error("Foundry did not confirm the Treasury update. Please check the displayed amounts before retrying.");
  }
  return { treasury: saved, message: "Treasury saved." };
}

function treasuryPanelMarkup(values = currentTreasury()) {
  return `<aside class="ll-treasury-panel" aria-label="Treasury">
    <h3>TREASURY</h3>
    <form class="ll-treasury-form">
      ${TREASURY_CURRENCIES.map(currency => `<label class="ll-treasury-row"><input name="${currency}" type="number" min="0" step="1" inputmode="numeric" value="${escape(values[currency])}" required aria-label="${currency.toUpperCase()}"><span>${currency.toUpperCase()}</span></label>`).join("")}
      <p class="ll-treasury-message" role="status" aria-live="polite"></p>
    </form>
  </aside>`;
}

async function saveTreasuryEdit(rawValues, state, request = requestMutation, callbacks = {}) {
  if (state.saving) return false;
  let amounts;
  try {
    amounts = validateTreasuryAmounts(rawValues);
  } catch (error) {
    callbacks.onError?.(error);
    return false;
  }
  if (sameTreasury(amounts, state.lastSaved)) return false;

  state.saving = true;
  callbacks.onStart?.();
  try {
    const result = await request("treasury", amounts);
    state.lastSaved = result.treasury;
    callbacks.onSaved?.(result);
    return true;
  } catch (error) {
    callbacks.onError?.(error);
    return false;
  } finally {
    state.saving = false;
    callbacks.onFinish?.();
  }
}

function treasuryFormValues(form) {
  return Object.fromEntries(TREASURY_CURRENCIES.map(currency => [currency, form.find(`[name="${currency}"]`).val()]));
}

function setTreasuryFormValues(form, values) {
  for (const currency of TREASURY_CURRENCIES) form.find(`[name="${currency}"]`).val(values[currency]);
}

function setTreasuryMessage(message, text, isError = false) {
  message.toggleClass("is-error", isError).text(text);
  fitLedgerDialog();
}

function renderTreasury() {
  if (!ledgerHtml) return;
  const values = currentTreasury();
  const form = ledgerHtml.find(".ll-treasury-form");
  const state = form[0] && treasuryFormStates.get(form[0]);
  if (state?.saving) return;
  if (state) state.lastSaved = values;
  setTreasuryFormValues(form, values);
  ledgerHtml.find(".ll-treasury-message").text("");
  fitLedgerDialog();
}

function fitLedgerDialog() {
  if (ledgerDialog?.rendered) ledgerDialog.setPosition({ height: "auto" });
}

function serializeWorldMutation(operation) {
  const pending = worldMutationQueue.then(operation);
  worldMutationQueue = pending.catch(() => undefined);
  return pending;
}

function isMutationLeader() {
  return activeMutationLeaderId() === game.user.id;
}

function activeMutationLeaderId() {
  const leaders = [...game.users].filter(user => user.isGM && user.active).sort((a, b) => a.id.localeCompare(b.id));
  return leaders[0]?.id ?? null;
}

function canEditRecords() {
  return Boolean(game.user?.isGM && isMutationLeader());
}

function registerMutationSocket() {
  const moduleActive = Boolean(game.modules.get(MODULE_ID)?.active);
  console.info("Loot Ledger: socket listener registering", {
    channel: SOCKET_CHANNEL,
    moduleActive,
    socketConnected: Boolean(game.socket?.connected),
    userId: game.user?.id,
    isGM: Boolean(game.user?.isGM),
    activeMutationLeaderId: activeMutationLeaderId()
  });
  game.socket.on(SOCKET_CHANNEL, async (message, senderId) => {
    console.debug("Loot Ledger: socket message received", {
      channel: SOCKET_CHANNEL,
      kind: message?.kind,
      requestId: message?.requestId,
      action: message?.action,
      senderId,
      recipientId: message?.to,
      isGM: Boolean(game.user?.isGM),
      activeMutationLeaderId: activeMutationLeaderId()
    });
    if (message?.kind === "response" && message.to === game.user.id) {
      const pending = pendingMutationRequests.get(message.requestId);
      if (!pending) return;
      if (senderId !== pending.leaderId) {
        console.warn("Loot Ledger: ignored a mutation response from an unexpected client", { requestId: message.requestId, senderId });
        return;
      }
      clearTimeout(pending.timeout);
      pendingMutationRequests.delete(message.requestId);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message?.kind !== "request" || !game.user.isGM || !isMutationLeader()) return;
    // Foundry V14 supplies the authenticated sender as the second socket callback argument.
    // Do not authorize based on the client-provided message.userId alone.
    const requester = game.users.get(senderId);
    const requestId = typeof message.requestId === "string" && message.requestId.length <= 64 ? message.requestId : "";
    const reply = payload => game.socket.emit(SOCKET_CHANNEL, { kind: "response", to: senderId, requestId, ...payload }, () => {
      console.debug("Loot Ledger: Foundry server relayed the response", { requestId, action: message.action, senderId, recipientId: senderId });
    });
    console.info("Loot Ledger: received multiplayer mutation request", {
      requestId,
      action: message.action,
      senderId,
      requesterActive: Boolean(requester?.active),
      requesterIsGM: Boolean(requester?.isGM),
      claimedUserId: message.userId
    });
    if (!senderId) {
      console.error("Loot Ledger: Foundry relayed a mutation request without an authenticated sender ID", { requestId, action: message.action });
      return;
    }
    if (!requestId || !requester?.active || requester.id !== message.userId) {
      reply({ error: "The Foundry user could not be verified. No change was made." });
      return;
    }
    if (!MUTATION_ACTIONS.has(message.action) || (!requester.isGM && requester.role < CONST.USER_ROLES.PLAYER)) {
      reply({ error: "This Foundry user is not allowed to perform that Loot Ledger action." });
      return;
    }
    try {
      console.debug("Loot Ledger: mutation request queued", { requestId, action: message.action, senderId });
      const result = await serializeWorldMutation(async () => {
        console.debug("Loot Ledger: mutation request processing started", { requestId, action: message.action, senderId });
        const result = await performMutation(message.action, message.data, requestId, requester);
        console.debug("Loot Ledger: mutation request processing finished", { requestId, action: message.action, senderId });
        return result;
      });
      console.info("Loot Ledger: multiplayer mutation completed", { requestId, action: message.action, senderId });
      reply({ result });
    } catch (error) {
      console.warn("Loot Ledger: multiplayer mutation failed", { requestId, action: message.action, senderId, error });
      reply({ error: error.message || "The Loot Ledger change could not be saved." });
    }
  });
}

function requestMutation(action, data) {
  if (!MUTATION_ACTIONS.has(action)) return Promise.reject(new Error("This Loot Ledger action is not supported."));
  if (!game.socket || game.socket.connected === false) {
    console.error("Loot Ledger: cannot send mutation because the Foundry socket is disconnected", {
      action,
      userId: game.user?.id,
      isGM: Boolean(game.user?.isGM),
      activeMutationLeaderId: activeMutationLeaderId()
    });
    return Promise.reject(new Error("Foundry is disconnected. No Loot Ledger change was requested; reconnect and try again."));
  }
  const signature = JSON.stringify([game.user.id, action, data]);
  let requestId = retryableMutationIds.get(signature);
  if (!requestId) {
    requestId = foundry.utils.randomID();
    retryableMutationIds.set(signature, requestId);
    while (retryableMutationIds.size > MUTATION_RECEIPT_LIMIT) retryableMutationIds.delete(retryableMutationIds.keys().next().value);
  }
  const clearRetryId = () => retryableMutationIds.delete(signature);
  if (game.user.isGM && isMutationLeader()) {
    console.info("Loot Ledger: handling mutation locally", { requestId, action, userId: game.user.id });
    return serializeWorldMutation(() => performMutation(action, data, requestId, game.user)).then(result => {
      clearRetryId();
      return result;
    });
  }
  const leaderId = activeMutationLeaderId();
  if (!leaderId) return Promise.reject(new Error("No active GM is connected. No change was requested."));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingMutationRequests.delete(requestId);
      console.warn("Loot Ledger: multiplayer mutation timed out without a GM response", { requestId, action, leaderId });
      reject(new Error("The active GM did not respond before the request timed out. Check the Loot holdings before trying again."));
    }, 30000);
    pendingMutationRequests.set(requestId, { resolve, reject, timeout, leaderId });
    console.info("Loot Ledger: sending multiplayer mutation request", {
      channel: SOCKET_CHANNEL,
      requestId,
      action,
      senderId: game.user.id,
      leaderId,
      socketConnected: Boolean(game.socket?.connected)
    });
    game.socket.emit(SOCKET_CHANNEL, { kind: "request", requestId, userId: game.user.id, action, data }, () => {
      console.debug("Loot Ledger: Foundry server relayed the request", { requestId, action, leaderId });
    });
  }).then(result => {
    clearRetryId();
    return result;
  });
}

function holdingLines(record) {
  const holdings = record.currentHoldings ?? {};
  const lines = [];
  const amount = entry => entry?.quantity ?? entry?.amount ?? entry?.count ?? 0;
  const entries = value => Array.isArray(value) ? value : [];

  for (const actor of entries(holdings.actors)) {
    const quantity = Number(amount(actor));
    if (quantity <= 0) continue;
    const name = actor.actorName ?? actor.name ?? actor.actor?.name ?? actor.actorId ?? "Actor";
    lines.push({ name, quantity });
  }
  for (const stash of entries(holdings.stashes)) {
    const quantity = Number(amount(stash));
    if (quantity <= 0) continue;
    const name = stash.location ?? stash.stashName ?? stash.name ?? "Stashed";
    lines.push({ name: `Stashed — ${name}`, quantity });
  }
  const unassigned = Number(holdings.unassignedQuantity ?? 0);
  if (unassigned > 0) lines.push({ name: "Unassigned", quantity: unassigned });
  const sold = Number(holdings.soldQuantity ?? 0);
  if (sold > 0) lines.push({ name: "Sold", quantity: sold });

  if (!lines.length) {
    const quantityFound = Number(record.quantityFound ?? 0);
    return `Unassigned${quantityFound === 1 ? "" : `: ${quantityFound}`}`;
  }
  return lines.map(({ name, quantity }) => `${escape(name)}${Number(record.quantityFound) === 1 ? "" : `: ${quantity}`}`).join("<br>");
}

function recordName(record) {
  const item = record.snapshot?.relevant ?? record.snapshot?.itemData ?? {};
  return String(item.name ?? "Unnamed item");
}

function marketValueNumber(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim().toLocaleLowerCase();
  const amount = Number.parseFloat(text.replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  if (/\bsp\b/.test(text)) return amount / 10;
  if (/\bcp\b/.test(text)) return amount / 100;
  return amount;
}

function recordStatusGroup(record) {
  const holdings = record.currentHoldings ?? {};
  if (Number(holdings.unassignedQuantity ?? unassignedQuantity(record)) > 0) return 0;
  if ([...(holdings.actors ?? []), ...(holdings.stashes ?? [])].some(entry => holdingAmount(entry) > 0)) return 1;
  if (Number(holdings.soldQuantity ?? 0) > 0) return 2;
  return 0;
}

function compareRecords(a, b) {
  const nameOrder = recordName(a).localeCompare(recordName(b), undefined, { sensitivity: "base" }) || String(a.id).localeCompare(String(b.id));
  if (recordSortMode === "name") return nameOrder;
  if (recordSortMode === "market-value") {
    const av = marketValueNumber(a.estimatedMarketValue);
    const bv = marketValueNumber(b.estimatedMarketValue);
    return (av == null ? 1 : bv == null ? -1 : bv - av) || nameOrder;
  }
  if (recordSortMode === "newest") return (Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0)) || nameOrder;
  return recordStatusGroup(a) - recordStatusGroup(b) || nameOrder;
}

function recordSlotUsage(record) {
  const storedData = record.snapshot?.itemData ?? {};
  const relevant = record.snapshot?.relevant ?? {};
  const data = clone(storedData);
  data.name ??= relevant.name;
  data.img ??= relevant.img;
  data.type ??= relevant.type;
  data.system ??= {};
  if ((!data.system.slots || Object.keys(data.system.slots).length === 0) && relevant.slots) data.system.slots = clone(relevant.slots);
  data.system.quantity = Number(record.quantityFound ?? 0);
  try {
    const item = new CONFIG.Item.documentClass(data, { strict: false });
    if (item.system?.isPhysical === false) return "—";
    const slotsUsed = Number(item.system.slotsUsed);
    return Number.isFinite(slotsUsed) && slotsUsed >= 0 ? slotsUsed : "—";
  } catch (error) {
    console.warn("Loot Ledger: Shadowdark could not calculate Loot record slots", { recordId: record.id, error });
    return "—";
  }
}

function slotDetailsForItemData(itemData, quantityFound) {
  const data = clone(itemData ?? {});
  data.system ??= {};
  data.system.quantity = Number(quantityFound ?? 0);
  const slots = data.system.slots ?? {};
  let stackSize = Number(slots.per_slot);
  let slotsPerStack = Number(slots.slots_used);
  if (!Number.isFinite(stackSize) || stackSize <= 0 || data.system.isPhysical === false) stackSize = null;
  if (!Number.isFinite(slotsPerStack) || slotsPerStack < 0 || data.system.isPhysical === false) slotsPerStack = null;
  let totalSlots = "—";
  try {
    const item = new CONFIG.Item.documentClass(data, { strict: false });
    if (item.system?.isPhysical !== false) {
      const calculated = Number(item.system?.slotsUsed);
      if (Number.isFinite(calculated) && calculated >= 0) totalSlots = calculated;
    }
  } catch (error) {
    console.warn("Loot Ledger: Shadowdark could not calculate item slot details", error);
  }
  return {
    stackSize: stackSize == null ? "—" : `${stackSize} per slot`,
    slotsPerStack: slotsPerStack == null ? "—" : slotsPerStack,
    quantityFound: data.system.quantity,
    totalSlots
  };
}

function itemSlotDetails(record) {
  const storedData = record.snapshot?.itemData ?? {};
  const relevant = record.snapshot?.relevant ?? {};
  const data = clone(storedData);
  data.name ??= relevant.name;
  data.img ??= relevant.img;
  data.type ??= relevant.type;
  data.system ??= {};
  if ((!data.system.slots || Object.keys(data.system.slots).length === 0) && relevant.slots) data.system.slots = clone(relevant.slots);
  return slotDetailsForItemData(data, record.quantityFound);
}

function renderRecordList() {
  if (!ledgerHtml) return;
  const records = currentRecords().slice().sort(compareRecords);
  const body = records.map(record => {
    const item = record.snapshot?.relevant ?? record.snapshot?.itemData ?? {};
    const name = item.name ?? "Unnamed item";
    const img = item.img
      ? `<img class="ll-record-img" src="${escape(item.img)}" alt="" loading="lazy">`
      : `<span class="ll-record-img ll-no-image" aria-hidden="true"><i class="fa-solid fa-coins"></i></span>`;
    const quantity = record.quantityFound ?? "—";
    const slots = recordSlotUsage(record);
    const value = record.estimatedMarketValue == null || record.estimatedMarketValue === "" ? "—" : record.estimatedMarketValue;
    const holdings = holdingLines(record);
    return `<tr class="ll-record-row" data-record-id="${escape(record.id)}" tabindex="0" aria-haspopup="dialog" aria-label="Open ${escape(name)} details">
      <td class="ll-item-cell"><div class="ll-item-cell-content">${img}<strong title="${escape(name)}">${escape(name)}</strong></div></td>
      <td class="ll-number">${escape(quantity)}</td>
      <td class="ll-number">${escape(slots)}</td>
      <td class="ll-whereabouts">${holdings}</td>
      <td class="ll-value">${escape(value)}</td>
    </tr>`;
  }).join("");
  const markup = records.length
    ? `<div class="ll-table-scroll"><table class="ll-record-table"><thead><tr><th>Item</th><th>Qty</th><th>Slots</th><th>Whereabouts</th><th>Value</th></tr></thead><tbody>${body}</tbody></table></div>`
    : `<p class="ll-empty">No loot recorded yet.</p>`;
  ledgerHtml.find(".ll-saved-records").html(markup);
  fitLedgerDialog();
}

function openRecordDetailsFromRow(event) {
  if ($(event.target).closest("a, button, input, select, textarea, [role='button'], [data-no-row-open]").length) return;
  const recordId = $(event.currentTarget).attr("data-record-id");
  const record = currentRecords().find(entry => entry.id === recordId);
  if (record) openItemDetail(record);
}

function activateRecordDetailsFromKeyboard(event) {
  if ($(event.target).closest("a, button, input, select, textarea, [role='button'], [data-no-row-open]").length) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  $(event.currentTarget).trigger("click");
}

function openLedger() {
  if (ledgerDialog?.rendered) {
    ledgerDialog.bringToTop?.();
    return;
  }
  const addLootPanel = canEditRecords() ? `<section class="ll-add-panel"><div class="ll-section-heading"><h3>Add Loot</h3></div>
      <p class="ll-add-copy">Add a Foundry Item to the Ledger by dropping it here.</p>
      <div class="ll-dropzone" role="region" aria-label="Drag an item here"><span>Drag an item here</span></div>
      <p class="ll-drop-hint">Items from Compendiums and World Items are supported.</p>
    </section>` : "";
  const content = `<section class="ll-ledger-root">
    <header class="ll-overview-header"><div><h2>Loot Ledger</h2></div></header>
    <div class="ll-overview-layout">
      <section class="ll-overview-panel"><div class="ll-sort-row"><label for="ll-record-sort">Sort by</label><select id="ll-record-sort" class="ll-record-sort"><option value="status">Status</option><option value="name">Name (A–Z)</option><option value="market-value">Market Value</option><option value="newest">Newest First</option></select></div><div class="ll-saved-records"></div></section>
      ${treasuryPanelMarkup()}
    </div>
    ${addLootPanel}
  </section>`;
  ledgerDialog = new Dialog({
    title: "Loot Ledger",
    content,
    buttons: {},
    render: html => {
      ledgerHtml = html;
      const zone = html.find(".ll-dropzone");
      zone.on("dragenter dragover", event => {
        event.preventDefault();
        const nativeEvent = event.originalEvent;
        if (nativeEvent?.dataTransfer) nativeEvent.dataTransfer.dropEffect = "copy";
        zone.addClass("is-dragging");
      });
      zone.on("dragleave", () => zone.removeClass("is-dragging"));
      zone.on("drop", async event => {
        event.preventDefault();
        event.stopPropagation();
        zone.removeClass("is-dragging");
        const dragEvent = event.originalEvent ?? event;
        try {
          const dragData = foundry.applications.ux.TextEditor.implementation.getDragEventData(dragEvent);
          if (dragData.type !== "Item" || !dragData.uuid) {
            ui.notifications.warn("Drop a Foundry Item to continue.");
            return;
          }
          const item = await foundry.utils.fromUuid(dragData.uuid);
          if (!item || item.documentName !== "Item") {
            ui.notifications.warn("Foundry could not resolve that Item UUID.");
            return;
          }
          openAddLoot(item);
        } catch (error) {
          console.error("Loot Ledger: unable to process dropped Item", error);
          ui.notifications.error(`Could not open Add Loot: ${error.message}`);
        }
      });
      html.find(".ll-saved-records").on("click", ".ll-record-row", openRecordDetailsFromRow);
      html.find(".ll-saved-records").on("keydown", ".ll-record-row", activateRecordDetailsFromKeyboard);
      renderRecordList();
      html.find(".ll-record-sort").val(recordSortMode).on("change", event => {
        recordSortMode = String($(event.currentTarget).val() ?? "status");
        renderRecordList();
      });
      const form = html.find(".ll-treasury-form");
      const message = form.find(".ll-treasury-message");
      const formState = { lastSaved: currentTreasury(), saving: false };
      if (form[0]) treasuryFormStates.set(form[0], formState);
      form.on("submit", event => event.preventDefault());
      form.on("change", "input[name]", async event => {
        await saveTreasuryEdit(treasuryFormValues(form), formState, requestMutation, {
          onStart: () => {
            form.find("input").prop("disabled", true);
            setTreasuryMessage(message, "Saving…");
          },
          onSaved: result => {
            setTreasuryFormValues(form, result.treasury);
            setTreasuryMessage(message, result.message ?? "Treasury saved.");
          },
          onError: error => {
            setTreasuryFormValues(form, formState.lastSaved);
            setTreasuryMessage(message, error.message || "Treasury could not be saved.", true);
          },
          onFinish: () => form.find("input").prop("disabled", false)
        });
      });
    },
    close: () => { ledgerHtml = null; }
  }, { width: 920, height: "auto", resizable: true, classes: ["ll-ledger-dialog"] });
  ledgerDialog.render(true);
}

function detailValue(value) {
  return value == null || value === "" ? "—" : escape(value);
}

function unassignedQuantity(record) {
  const holdings = record.currentHoldings ?? {};
  if (Number.isFinite(Number(holdings.unassignedQuantity))) return Number(holdings.unassignedQuantity);
  const assigned = [...(holdings.actors ?? []), ...(holdings.stashes ?? [])]
    .reduce((sum, holding) => sum + Number(holding.quantity ?? holding.amount ?? holding.count ?? 0), 0);
  return Math.max(0, Number(record.quantityFound ?? 0) - assigned - Number(holdings.soldQuantity ?? 0));
}

function transferActors() {
  return [...game.actors]
    .filter(actor => typeof actor.system?.getPhysicalItems === "function"
      && typeof actor.system?.getSlotUsage === "function"
      && Number.isFinite(Number(actor.system?.slots))
      && (game.user.isGM || actor.testUserPermission(game.user, "OWNER")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function transferCandidate(actor, sourceItem, quantity) {
  const data = clone(sourceItem.toObject());
  for (const key of ["_id", "folder", "sort", "ownership", "_stats"]) delete data[key];
  data.system ??= {};
  data.system.quantity = quantity;
  data.system.stashed = false;
  const candidate = new CONFIG.Item.documentClass(data, { strict: false });
  if (!candidate.system.isPhysical) throw new Error("This Foundry Item is not a physical Shadowdark item.");

  const projectedSystem = new Proxy(actor.system, {
    get(target, property, receiver) {
      if (property === "getPhysicalItems") {
        return () => [...actor.system.getPhysicalItems(), candidate];
      }
      return Reflect.get(target, property, receiver);
    }
  });
  return { candidate, usage: projectedSystem.getSlotUsage() };
}

function actorUsage(actor) {
  const usage = actor.system.getSlotUsage();
  const capacity = Number(actor.system.slots);
  if (!Number.isFinite(capacity) || !Number.isFinite(Number(usage?.total))) {
    throw new Error("Shadowdark did not return a usable slot total for this Actor.");
  }
  return { usage, capacity, free: capacity - Number(usage.total) };
}

function stashActionsMarkup(record) {
  const holdings = normalizedHoldings(record);
  const available = Number(holdings.unassignedQuantity ?? 0);
  const locations = holdings.stashes.map(holding => {
    const location = String(holding.location ?? holding.stashName ?? holding.name ?? "Stash");
    const quantity = holdingAmount(holding);
    const returnButton = quantity > 0
      ? `<button type="button" class="ll-return-stash" data-location="${escape(location)}" data-available="${quantity}">Terug naar Unassigned</button>`
      : `<span class="ll-stash-empty">No loot currently here</span>`;
    return `<li><span><strong>${escape(location)}</strong><small>${quantity} ${quantity === 1 ? "item" : "items"}</small></span>${returnButton}</li>`;
  }).join("");
  return `<section class="ll-stash-actions"><div class="ll-section-heading"><h3>Stash</h3></div>
    <p>Unassigned: <strong>${available}</strong></p>
    ${available > 0 ? `<button type="button" class="ll-stash-loot">Stash loot</button>` : ""}
    ${locations ? `<ul class="ll-stash-list">${locations}</ul>` : `<p class="ll-stash-empty">This record has no stash holdings.</p>`}
  </section>`;
}

function openStashDialog(record, onUpdated) {
  const locations = stashLocations();
  const options = locations.map(location => `<option value="${escape(location)}"></option>`).join("");
  const content = `<section class="ll-stash-form">
    <p>Move loot from Unassigned to a stash location.</p>
    <p>Available Unassigned: <strong>${unassignedQuantity(record)}</strong></p>
    <label>Quantity<input name="quantity" type="number" min="1" step="1" max="${unassignedQuantity(record)}" value="1" required></label>
    <label>Stash location<input name="location" type="text" list="ll-stash-locations" autocomplete="off" required></label>
    <datalist id="ll-stash-locations">${options}</datalist>
    <p class="ll-error" role="alert"></p>
    <button type="button" class="ll-confirm-stash">Stash</button>
  </section>`;
  const dialog = new Dialog({
    title: "Stash Loot",
    content,
    buttons: {},
    render: html => {
      const quantityInput = html.find('[name="quantity"]');
      const locationInput = html.find('[name="location"]');
      const error = html.find(".ll-error");
      const confirm = html.find(".ll-confirm-stash");
      confirm.on("click", async () => {
        const quantity = Number(quantityInput.val());
        const location = String(locationInput.val() ?? "").trim();
        if (!Number.isInteger(quantity) || quantity < 1) { error.text("Enter a positive whole-number quantity."); return; }
        if (!location) { error.text("Choose an existing stash location or enter a new name."); return; }
        confirm.prop("disabled", true);
        error.text("");
        try {
          const result = await requestMutation("stash", { recordId: record.id, quantity, location });
          renderRecordList();
          onUpdated?.(result.record);
          ui.notifications.info(result.message);
          dialog.close();
        } catch (saveError) {
          error.text(saveError.message || "The loot could not be stashed.");
          confirm.prop("disabled", false);
        }
      });
    }
  }, { width: 460, resizable: false });
  dialog.render(true);
}

function openReturnStashDialog(record, location, available, onUpdated) {
  const content = `<section class="ll-stash-form">
    <p>Return loot from <strong>${escape(location)}</strong> to Unassigned.</p>
    <p>Available at this location: <strong>${available}</strong></p>
    <label>Quantity<input name="quantity" type="number" min="1" step="1" max="${available}" value="${available}" required></label>
    <p class="ll-error" role="alert"></p>
    <button type="button" class="ll-confirm-return">Terug naar Unassigned</button>
  </section>`;
  const dialog = new Dialog({
    title: "Terug naar Unassigned",
    content,
    buttons: {},
    render: html => {
      const quantityInput = html.find('[name="quantity"]');
      const error = html.find(".ll-error");
      const confirm = html.find(".ll-confirm-return");
      confirm.on("click", async () => {
        const quantity = Number(quantityInput.val());
        if (!Number.isInteger(quantity) || quantity < 1) { error.text("Enter a positive whole-number quantity."); return; }
        confirm.prop("disabled", true);
        error.text("");
        try {
          const result = await requestMutation("return-to-unassigned", { recordId: record.id, quantity, location });
          renderRecordList();
          onUpdated?.(result.record);
          ui.notifications.info(result.message);
          dialog.close();
        } catch (saveError) {
          error.text(saveError.message || "The loot could not be returned to Unassigned.");
          confirm.prop("disabled", false);
        }
      });
    }
  }, { width: 460, resizable: false });
  dialog.render(true);
}

function findTransferItem(actor, transferId, recordId = null) {
  return actor?.items?.find(item => item.flags?.[MODULE_ID]?.transferId === transferId
    && (!recordId || item.flags?.[MODULE_ID]?.recordId === recordId)) ?? null;
}

async function writeRecords(records) {
  await game.settings.set(MODULE_ID, RECORDS_SETTING, records);
}

function holdingAmount(entry) {
  return Number(entry?.quantity ?? entry?.amount ?? entry?.count ?? 0);
}

function hasCurrentHoldings(record) {
  const current = record.currentHoldings ?? {};
  const hasNonZeroOrInvalid = entries => (entries ?? []).some(entry => {
    const quantity = holdingAmount(entry);
    return !Number.isFinite(quantity) || quantity !== 0;
  });
  return hasNonZeroOrInvalid(current.actors) || hasNonZeroOrInvalid(current.stashes);
}

function normalizedLocation(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function stashLocations(records = currentRecords()) {
  const locations = new Map();
  for (const record of records) {
    for (const holding of record.currentHoldings?.stashes ?? []) {
      const name = String(holding.location ?? holding.stashName ?? holding.name ?? "").trim().replace(/\s+/g, " ");
      const key = normalizedLocation(name);
      if (key && !locations.has(key)) locations.set(key, name);
    }
  }
  return [...locations.values()].sort((a, b) => a.localeCompare(b));
}

function normalizedHoldings(record) {
  const holdings = clone(record.currentHoldings ?? {});
  holdings.actors ??= [];
  holdings.stashes ??= [];
  holdings.unassignedQuantity = Number(holdings.unassignedQuantity ?? unassignedQuantity(record));
  holdings.soldQuantity = Number(holdings.soldQuantity ?? 0);
  return holdings;
}

function assertHoldingBalance(record, holdings = normalizedHoldings(record)) {
  const quantities = [holdings.unassignedQuantity, holdings.soldQuantity ?? 0, ...holdings.actors.map(holdingAmount), ...holdings.stashes.map(holdingAmount)];
  if (!Number.isInteger(Number(record.quantityFound)) || Number(record.quantityFound) < 0
    || quantities.some(quantity => !Number.isInteger(Number(quantity)) || Number(quantity) < 0)) {
    throw new Error("This Loot record has an invalid quantity in its holdings. No change was made.");
  }
  const total = quantities.reduce((sum, quantity) => sum + Number(quantity), 0);
  if (total !== Number(record.quantityFound)) {
    throw new Error(`This Loot record is out of balance (${total} held, ${record.quantityFound} active). No change was made; ask the GM to review the record.`);
  }
}

function mutationReceipt(record, requestId, action) {
  const receipt = (record.mutationReceipts ?? []).find(entry => entry.requestId === requestId);
  if (receipt && receipt.action !== action) throw new Error("This request ID was already used for a different action. No change was made.");
  return receipt;
}

function rememberMutation(record, requestId, action, message) {
  record.mutationReceipts ??= [];
  record.mutationReceipts = record.mutationReceipts.filter(entry => entry.requestId !== requestId);
  record.mutationReceipts.push({ requestId, action, message, completedAt: Date.now() });
  if (record.mutationReceipts.length > MUTATION_RECEIPT_LIMIT) {
    record.mutationReceipts.splice(0, record.mutationReceipts.length - MUTATION_RECEIPT_LIMIT);
  }
}

function previousMutationResult(record, requestId, action) {
  const receipt = mutationReceipt(record, requestId, action);
  return receipt ? { record, message: receipt.message, duplicate: true } : null;
}

async function performStash(data, requestId) {
  const records = currentRecords();
  const record = records.find(entry => entry.id === data?.recordId);
  if (!record) throw new Error("This Loot record is no longer available.");
  const previous = previousMutationResult(record, requestId, "stash");
  if (previous) return previous;
  if (record.pendingTransfer || record.pendingActorMutation) throw new Error("This record has an inventory change that needs reconciliation. No further change was made.");
  const quantity = Number(data.quantity);
  const requestedName = String(data.location ?? "").trim().replace(/\s+/g, " ");
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Enter a positive whole-number quantity.");
  if (!requestedName) throw new Error("Choose an existing stash location or enter a new name.");
  const holdings = normalizedHoldings(record);
  assertHoldingBalance(record, holdings);
  if (quantity > holdings.unassignedQuantity) throw new Error(`Only ${holdings.unassignedQuantity} item(s) remain Unassigned.`);
  const known = stashLocations(records);
  const canonicalName = known.find(name => normalizedLocation(name) === normalizedLocation(requestedName)) ?? requestedName;
  const key = normalizedLocation(canonicalName);
  let stash = holdings.stashes.find(entry => normalizedLocation(entry.location ?? entry.stashName ?? entry.name) === key);
  if (stash) {
    stash.location = canonicalName;
    stash.quantity = holdingAmount(stash) + quantity;
    delete stash.amount;
    delete stash.count;
  } else holdings.stashes.push({ location: canonicalName, quantity });
  holdings.unassignedQuantity -= quantity;
  record.currentHoldings = holdings;
  assertHoldingBalance(record, holdings);
  const message = `Stashed ${quantity} ${record.snapshot?.relevant?.name ?? "item(s)"} at ${canonicalName}.`;
  rememberMutation(record, requestId, "stash", message);
  await writeRecords(records);
  const saved = currentRecords().find(entry => entry.id === record.id);
  if (!saved || unassignedQuantity(saved) !== holdings.unassignedQuantity || !mutationReceipt(saved, requestId, "stash")) throw new Error("Foundry did not confirm the updated Loot holdings. Reopen the record before retrying.");
  return { record: saved, message };
}

async function performReturnToUnassigned(data, requestId) {
  const records = currentRecords();
  const record = records.find(entry => entry.id === data?.recordId);
  if (!record) throw new Error("This Loot record is no longer available.");
  const previous = previousMutationResult(record, requestId, "return-to-unassigned");
  if (previous) return previous;
  if (record.pendingTransfer || record.pendingActorMutation) throw new Error("This record has an inventory change that needs reconciliation. No further change was made.");
  const quantity = Number(data.quantity);
  const key = normalizedLocation(data.location);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Enter a positive whole-number quantity.");
  const holdings = normalizedHoldings(record);
  assertHoldingBalance(record, holdings);
  const stash = holdings.stashes.find(entry => normalizedLocation(entry.location ?? entry.stashName ?? entry.name) === key);
  if (!stash) throw new Error("That stash location is no longer listed for this Loot record.");
  const available = holdingAmount(stash);
  if (quantity > available) throw new Error(`Only ${available} item(s) remain at this stash location.`);
  stash.location = String(stash.location ?? stash.stashName ?? stash.name).trim().replace(/\s+/g, " ");
  stash.quantity = available - quantity;
  delete stash.amount;
  delete stash.count;
  holdings.unassignedQuantity += quantity;
  record.currentHoldings = holdings;
  assertHoldingBalance(record, holdings);
  const message = `Returned ${quantity} item(s) from ${stash.location} to Unassigned.`;
  rememberMutation(record, requestId, "return-to-unassigned", message);
  await writeRecords(records);
  const saved = currentRecords().find(entry => entry.id === record.id);
  if (!saved || unassignedQuantity(saved) !== holdings.unassignedQuantity || !mutationReceipt(saved, requestId, "return-to-unassigned")) throw new Error("Foundry did not confirm the updated Loot holdings. Reopen the record before retrying.");
  return { record: saved, message };
}

function recordActorHolding(record, actorId) {
  return (record.currentHoldings?.actors ?? []).find(entry => entry.actorId === actorId) ?? null;
}

function actorRemovalPlan(record, actor, quantity) {
  const holding = recordActorHolding(record, actor.id);
  if (!holding || holdingAmount(holding) <= 0) throw new Error("This Actor has no current holding for this Loot record.");
  const transferIds = Array.isArray(holding.transferIds) ? holding.transferIds : [];
  if (!transferIds.length || transferIds.some(id => typeof id !== "string" || !id) || new Set(transferIds).size !== transferIds.length) {
    throw new Error("The Actor holding has missing or ambiguous Item links. No inventory item was changed.");
  }
  const linkedItems = transferIds.map(transferId => {
    const matches = actor.items.filter(item => item.flags?.[MODULE_ID]?.transferId === transferId
      && item.flags?.[MODULE_ID]?.recordId === record.id);
    if (matches.length !== 1) throw new Error("A linked Actor Item is missing or ambiguous. No inventory item was changed.");
    const item = matches[0];
    if (!item.system?.isPhysical || !actor.system.getPhysicalItems().some(entry => entry.id === item.id)) {
      throw new Error("A linked Item is not in this Actor's Shadowdark physical inventory. No change was made.");
    }
    const beforeQuantity = Number(item.system?.quantity);
    if (!Number.isInteger(beforeQuantity) || beforeQuantity < 1) throw new Error("A linked Actor Item has an invalid quantity. No change was made.");
    return { item, transferId, beforeQuantity, beforeData: clone(item.toObject()) };
  });
  const linkedQuantity = linkedItems.reduce((sum, entry) => sum + entry.beforeQuantity, 0);
  if (linkedQuantity !== holdingAmount(holding)) {
    throw new Error("The Actor inventory no longer matches the Ledger holding. No change was made; ask the GM to review the record.");
  }
  if (quantity > linkedQuantity) throw new Error(`Only ${linkedQuantity} linked item(s) are present on this Actor.`);
  let remaining = quantity;
  const plan = [];
  for (const entry of linkedItems) {
    if (remaining <= 0) break;
    const removed = Math.min(remaining, entry.beforeQuantity);
    plan.push({
      id: entry.item.id,
      transferId: entry.transferId,
      beforeQuantity: entry.beforeQuantity,
      afterQuantity: entry.beforeQuantity - removed,
      beforeData: entry.beforeData
    });
    remaining -= removed;
  }
  if (remaining !== 0) throw new Error("The requested quantity could not be matched to linked Actor Items.");
  return plan;
}

async function applyActorRemovalPlan(actor, plan) {
  for (const change of plan) {
    const item = actor.getEmbeddedDocument("Item", change.id);
    if (change.afterQuantity === 0 && !item) continue;
    if (!item) throw new Error(`Linked Actor Item ${change.id} is missing. The Ledger was not changed.`);
    const currentQuantity = Number(item.system?.quantity);
    if (currentQuantity === change.afterQuantity) continue;
    if (currentQuantity !== change.beforeQuantity) throw new Error(`Linked Actor Item ${item.name} changed during this request. The Ledger was not changed.`);
    if (change.afterQuantity === 0) await actor.deleteEmbeddedDocuments("Item", [change.id]);
    else await actor.updateEmbeddedDocuments("Item", [{ _id: change.id, "system.quantity": change.afterQuantity }]);
  }
  for (const change of plan) {
    const item = actor.getEmbeddedDocument("Item", change.id);
    if (change.afterQuantity === 0) {
      if (item) throw new Error("Foundry did not confirm removal of a fully consumed Item.");
    } else if (!item || Number(item.system?.quantity) !== change.afterQuantity
      || item.flags?.[MODULE_ID]?.transferId !== change.transferId
      || !actor.system.getPhysicalItems().some(entry => entry.id === item.id)) {
      throw new Error("Foundry did not confirm the requested Actor inventory change.");
    }
  }
}

async function restoreActorRemovalPlan(actor, plan) {
  for (const change of [...plan].reverse()) {
    let item = actor.getEmbeddedDocument("Item", change.id);
    if (!item && change.afterQuantity === 0) {
      const [restored] = await actor.createEmbeddedDocuments("Item", [change.beforeData], { keepId: true });
      item = actor.getEmbeddedDocument("Item", change.id) ?? restored;
    } else if (item && Number(item.system?.quantity) !== change.beforeQuantity) {
      if (Number(item.system?.quantity) !== change.afterQuantity) throw new Error(`Cannot safely restore ${item.name}; its quantity changed again.`);
      await actor.updateEmbeddedDocuments("Item", [{ _id: change.id, "system.quantity": change.beforeQuantity }]);
      item = actor.getEmbeddedDocument("Item", change.id);
    }
    if (!item || Number(item.system?.quantity) !== change.beforeQuantity) throw new Error(`Foundry could not restore linked Item ${change.id}.`);
  }
}

function appendHistory(record, entry) {
  record.history ??= [];
  if (record.history.some(existing => existing.requestId === entry.requestId && existing.action === entry.action)) return;
  record.history.push({ id: entry.requestId, ...entry, createdAt: Date.now() });
}

async function commitActorRemoval(recordId, pending) {
  const records = currentRecords();
  const record = records.find(entry => entry.id === recordId);
  if (!record || record.pendingActorMutation?.requestId !== pending.requestId) throw new Error("The saved inventory-change reservation no longer matches. Reconciliation is required.");
  const actor = game.actors.get(pending.actorId);
  if (!actor) throw new Error("The Actor for this pending inventory change is no longer available.");
  const holdings = normalizedHoldings(record);
  assertHoldingBalance(record, holdings);
  const actorHolding = holdings.actors.find(entry => entry.actorId === pending.actorId) ?? null;
  if (!actorHolding || holdingAmount(actorHolding) < pending.quantity) throw new Error("The Ledger Actor holding no longer matches the pending inventory change.");
  actorHolding.quantity = holdingAmount(actorHolding) - pending.quantity;
  actorHolding.transferIds = (actorHolding.transferIds ?? []).filter(id => {
    const change = pending.plan.find(entry => entry.transferId === id);
    return !change || change.afterQuantity > 0;
  });
  delete actorHolding.amount;
  delete actorHolding.count;
  if (actorHolding.quantity === 0) holdings.actors = holdings.actors.filter(entry => entry.actorId !== pending.actorId);
  if (pending.action === "return-actor") holdings.unassignedQuantity += pending.quantity;
  else holdings.soldQuantity += pending.quantity;
  record.currentHoldings = holdings;
  const action = pending.action === "return-actor" ? "return-to-unassigned" : "sold";
  const verb = action === "sold" ? "Sold" : "Returned to Unassigned";
  const message = `${verb} ${pending.quantity} ${record.snapshot?.relevant?.name ?? "item(s)"} ${action === "sold" ? "from" : "from"} ${actor.name}.`;
  appendHistory(record, { requestId: pending.requestId, action, actorId: actor.id, actorName: actor.name, quantity: pending.quantity, message });
  delete record.pendingActorMutation;
  rememberMutation(record, pending.requestId, pending.action, message);
  assertHoldingBalance(record, holdings);
  try {
    await writeRecords(records);
  } catch (saveError) {
    const saved = currentRecords().find(entry => entry.id === recordId);
    if (mutationReceipt(saved, pending.requestId, pending.action)) return { record: saved, message };
    try {
      await restoreActorRemovalPlan(actor, pending.plan);
      const rollback = currentRecords();
      const rollbackRecord = rollback.find(entry => entry.id === recordId);
      if (rollbackRecord?.pendingActorMutation?.requestId === pending.requestId) delete rollbackRecord.pendingActorMutation;
      await writeRecords(rollback);
    } catch (rollbackError) {
      throw new Error(`Ledger save failed (${saveError.message}) and the Actor change could not be restored (${rollbackError.message}). The record is marked for reconciliation; do not retry yet.`);
    }
    throw new Error(`Ledger save failed. The Actor inventory was restored and holdings were unchanged. (${saveError.message})`);
  }
  const saved = currentRecords().find(entry => entry.id === recordId);
  if (!saved || !mutationReceipt(saved, pending.requestId, pending.action)) throw new Error("Foundry did not confirm the updated holdings. Reopen the record before retrying.");
  assertHoldingBalance(saved);
  return { record: saved, message };
}

async function completePendingActorRemoval(recordId, requestId) {
  const record = currentRecords().find(entry => entry.id === recordId);
  const pending = record?.pendingActorMutation;
  if (!pending || pending.requestId !== requestId) throw new Error("The pending Actor change could not be verified.");
  const actor = game.actors.get(pending.actorId);
  if (!actor) throw new Error("The Actor for this pending inventory change is no longer available. No Actor Item was changed.");
  const state = inspectActorRemovalPlan(actor, pending.plan, record.id);
  if (state === "before") {
    const records = currentRecords();
    const latest = records.find(entry => entry.id === recordId);
    if (latest?.pendingActorMutation?.requestId !== requestId) throw new Error("The pending reservation changed during review. No Actor Item was changed.");
    delete latest.pendingActorMutation;
    await writeRecords(records);
    const saved = currentRecords().find(entry => entry.id === recordId);
    if (saved?.pendingActorMutation) throw new Error("Foundry did not confirm clearing the unused reservation. No Actor Item was changed.");
    throw new Error("No Actor inventory change had been applied. The pending reservation was cleared; review the holdings and submit the action again if needed.");
  }
  if (state !== "after") {
    throw new Error("The Actor inventory matches neither the original nor the fully completed change. No automatic repair was made; the record remains paused for GM review.");
  }
  // The Actor change is already present. Reconcile only the Ledger; never replay an inventory mutation here.
  return commitActorRemoval(recordId, pending);
}

function inspectActorRemovalPlan(actor, plan, recordId) {
  let beforeCount = 0;
  let afterCount = 0;
  for (const change of plan) {
    const item = actor.getEmbeddedDocument("Item", change.id);
    const hasIdentity = item
      && item.flags?.[MODULE_ID]?.recordId === recordId
      && item.flags?.[MODULE_ID]?.transferId === change.transferId;
    const beforeMatches = hasIdentity && Number(item.system?.quantity) === change.beforeQuantity;
    const afterMatches = change.afterQuantity === 0
      ? !item
      : hasIdentity && Number(item.system?.quantity) === change.afterQuantity
        && item.system?.isPhysical
        && actor.system.getPhysicalItems().some(entry => entry.id === item.id);
    if (beforeMatches) beforeCount++;
    if (afterMatches) afterCount++;
  }
  if (beforeCount === plan.length) return "before";
  if (afterCount === plan.length) return "after";
  return "mixed";
}

async function reconcilePendingActorRemoval(recordId) {
  const record = currentRecords().find(entry => entry.id === recordId);
  if (!record?.pendingActorMutation) return record;
  const result = await completePendingActorRemoval(recordId, record.pendingActorMutation.requestId);
  renderRecordList();
  return result.record;
}

async function performActorRemoval(action, data, requestId, requester) {
  const records = currentRecords();
  const record = records.find(entry => entry.id === data?.recordId);
  if (!record) throw new Error("This Loot record is no longer available.");
  const previous = previousMutationResult(record, requestId, action);
  if (previous) return previous;
  if (record.pendingTransfer) throw new Error("A Take Loot transfer for this record needs reconciliation first.");
  if (record.pendingActorMutation) {
    if (record.pendingActorMutation.requestId === requestId && record.pendingActorMutation.action === action) {
      return completePendingActorRemoval(record.id, requestId);
    }
    throw new Error("A previous Actor inventory change is being reconciled. Refresh this record before trying again.");
  }
  const actor = game.actors.get(String(data?.actorId ?? ""));
  if (!actor) throw new Error("Choose an Actor.");
  if (!requester.isGM && !actor.testUserPermission(requester, "OWNER")) throw new Error("You can only change an Actor inventory you have permission to edit.");
  const quantity = Number(data?.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Enter a positive whole-number quantity.");
  const holdings = normalizedHoldings(record);
  assertHoldingBalance(record, holdings);
  const holding = recordActorHolding(record, actor.id);
  if (!holding || quantity > holdingAmount(holding)) throw new Error(`This Actor holds only ${holdingAmount(holding)} item(s) from this record.`);
  const plan = actorRemovalPlan(record, actor, quantity);
  const pending = { requestId, action, actorId: actor.id, quantity, actorName: actor.name, plan, startedAt: Date.now() };
  record.pendingActorMutation = pending;
  await writeRecords(records);
  const saved = currentRecords().find(entry => entry.id === record.id);
  if (saved?.pendingActorMutation?.requestId !== requestId) throw new Error("Foundry did not confirm the inventory-change reservation. No Actor Item was changed.");
  try {
    await applyActorRemovalPlan(actor, plan);
  } catch (inventoryError) {
    try {
      await restoreActorRemovalPlan(actor, plan);
      const rollbackRecords = currentRecords();
      const rollbackRecord = rollbackRecords.find(entry => entry.id === record.id);
      if (rollbackRecord?.pendingActorMutation?.requestId === requestId) delete rollbackRecord.pendingActorMutation;
      await writeRecords(rollbackRecords);
    } catch (rollbackError) {
      throw new Error(`The Actor inventory change failed (${inventoryError.message}) and could not be fully restored (${rollbackError.message}). The record is marked for reconciliation; do not retry yet.`);
    }
    throw new Error(`The Actor inventory change failed. The original inventory was restored and the Ledger was not changed. (${inventoryError.message})`);
  }
  return commitActorRemoval(record.id, pending);
}

async function performDeleteRecord(recordId, requestId, requester) {
  if (!requester?.isGM) throw new Error("Only the GM can delete a Loot record.");
  const records = currentRecords();
  const index = records.findIndex(entry => entry.id === recordId);
  if (index < 0) return { record: null, message: "This Loot record was already removed.", duplicate: true };
  const record = records[index];
  if (record.pendingTransfer || record.pendingActorMutation) throw new Error("This record has an inventory change that needs reconciliation before it can be deleted.");
  if (hasCurrentHoldings(record)) {
    throw new Error("This record still has current holdings. Return Actor-held items to Unassigned first; records with Stash holdings cannot be deleted.");
  }
  records.splice(index, 1);
  await writeRecords(records);
  if (currentRecords().some(entry => entry.id === recordId)) throw new Error("Foundry did not confirm deletion of this Loot record.");
  return { record: null, message: `Deleted ${record.snapshot?.relevant?.name ?? "Loot record"}.` };
}

async function performMutation(action, data, requestId, requester) {
  if (!MUTATION_ACTIONS.has(action)) throw new Error("That Loot Ledger action is not supported.");
  if (!requester?.active || (!requester.isGM && requester.role < CONST.USER_ROLES.PLAYER)) throw new Error("The Foundry user is not allowed to perform this Loot Ledger action.");
  if (action === "treasury") return saveTreasury(data, requester);
  if (action === "delete") return performDeleteRecord(String(data?.recordId ?? ""), requestId, requester);
  if (action === "sold" || action === "return-actor") return performActorRemoval(action, data, requestId, requester);
  if (action === "stash") return performStash(data, requestId);
  if (action === "return-to-unassigned") return performReturnToUnassigned(data, requestId);
  if (action === "take") return executeTakeTransfer(data, requestId, requester);
  throw new Error("That Loot Ledger action is not supported.");
}

async function executeTakeTransfer(data, requestId, requester) {
  const recordId = String(data?.recordId ?? "");
  const actorId = String(data?.actorId ?? "");
  const quantity = Number(data?.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Enter a positive whole-number quantity.");
  if (!requestId) throw new Error("The Take Loot request could not be verified. No transfer was made.");
  let current = currentRecords().find(entry => entry.id === recordId);
  if (!current) throw new Error("This Loot record is no longer available.");
  const previous = previousMutationResult(current, requestId, "take");
  if (previous) return previous;
  if (current.pendingActorMutation) throw new Error("Another Actor inventory change for this record needs reconciliation first.");
  const oldPending = current.pendingTransfer;
  const hadPending = Boolean(oldPending);
  let latest = await recoverPendingTransfer(recordId);
  latest = currentRecords().find(entry => entry.id === recordId);
  const recovered = previousMutationResult(latest, requestId, "take");
  if (recovered) return recovered;
  if (hadPending && oldPending?.requestId !== requestId) throw new Error("A previous transfer was reconciled or cleared. Review the updated holdings, then confirm any new transfer separately.");
  latest = currentRecords().find(entry => entry.id === recordId);
  const actor = game.actors.get(actorId);
  if (!latest) throw new Error("This Loot record is no longer available.");
  if (!actor) throw new Error("Choose an Actor.");
  if (!requester.isGM && !actor.testUserPermission(requester, "OWNER")) throw new Error("You can only Take Loot into an Actor you have permission to edit.");
  if (!transferActors().some(entry => entry.id === actor.id)) throw new Error("This Actor does not use Shadowdark physical inventory slots.");
  assertHoldingBalance(latest);
  const available = unassignedQuantity(latest);
  if (quantity > available) throw new Error(`Only ${available} item(s) remain Unassigned.`);
  if (latest.pendingTransfer) throw new Error("A previous transfer is still being reconciled. No duplicate was created.");
  const uuid = latest.sourceRef?.uuid;
  if (!uuid) throw new Error("The original Foundry Item reference is missing. No transfer was made.");
  const sourceItem = await foundry.utils.fromUuid(uuid);
  if (!sourceItem || sourceItem.documentName !== "Item") throw new Error("The original Foundry Item can no longer be resolved. No transfer was made.");
  const before = actorUsage(actor);
  const projected = transferCandidate(actor, sourceItem, quantity);
  if (Number(projected.usage.total) > before.capacity) {
    const required = Number(projected.usage.total) - Number(before.usage.total);
    throw new Error(`Not enough room: ${before.free} free slot(s), but this transfer requires ${required} slot(s).`);
  }

  const transferId = `${recordId}-${requestId}`;
  const pending = { transferId, requestId, actorId: actor.id, actorName: actor.name, itemName: sourceItem.name, quantity, sourceUuid: uuid, startedAt: Date.now() };
  const reservedRecords = currentRecords();
  const reservedRecord = reservedRecords.find(entry => entry.id === recordId);
  if (!reservedRecord || reservedRecord.pendingTransfer) throw new Error("This Loot record is already being transferred. Refresh and try again.");
  assertHoldingBalance(reservedRecord);
  if (unassignedQuantity(reservedRecord) < quantity) throw new Error(`Only ${unassignedQuantity(reservedRecord)} item(s) remain Unassigned.`);
  reservedRecord.pendingTransfer = pending;
  await writeRecords(reservedRecords);

  const itemData = clone(sourceItem.toObject());
  for (const key of ["_id", "folder", "sort", "ownership", "_stats"]) delete itemData[key];
  itemData.system ??= {};
  itemData.system.quantity = quantity;
  itemData.system.stashed = false;
  itemData.flags ??= {};
  itemData.flags[MODULE_ID] = { ...(itemData.flags[MODULE_ID] ?? {}), recordId, transferId };

  let created;
  let creationError;
  try { [created] = await actor.createEmbeddedDocuments("Item", [itemData]); }
  catch (error) { creationError = error; created = findTransferItem(actor, transferId, recordId); }
  created ??= findTransferItem(actor, transferId, recordId);
  if (!created) {
    const clearRecords = currentRecords();
    const clearRecord = clearRecords.find(entry => entry.id === recordId);
    if (clearRecord?.pendingTransfer?.transferId === transferId) { delete clearRecord.pendingTransfer; await writeRecords(clearRecords); }
    throw creationError ?? new Error("Foundry did not confirm that the Item was added.");
  }

  const persisted = actor.getEmbeddedDocument("Item", created.id) ?? findTransferItem(actor, transferId, recordId);
  if (!persisted) throw new Error("Foundry returned a transfer result but the saved Actor Item could not be read back. The Ledger was not changed; a pending marker blocks another transfer until reconciliation.");
  const after = actorUsage(actor);
  const verified = persisted.flags?.[MODULE_ID]?.transferId === transferId
    && persisted.flags?.[MODULE_ID]?.recordId === recordId
    && Number(persisted.system?.quantity) === quantity
    && Number(after.usage.total) === Number(projected.usage.total)
    && Number(after.usage.total) <= after.capacity
    && actor.system.getPhysicalItems().some(item => item.id === persisted.id);
  if (!verified) {
    try {
      await actor.deleteEmbeddedDocuments("Item", [persisted.id]);
      if (actor.getEmbeddedDocument("Item", persisted.id)) throw new Error("Foundry still reports the Item in the Actor inventory.");
      const clearRecords = currentRecords();
      const clearRecord = clearRecords.find(entry => entry.id === recordId);
      if (clearRecord?.pendingTransfer?.transferId === transferId) { delete clearRecord.pendingTransfer; await writeRecords(clearRecords); }
      throw new Error("The Actor inventory check did not match the transfer. The Item was rolled back and Ledger holdings were unchanged.");
    } catch (rollbackError) {
      if (rollbackError.message.startsWith("The Actor inventory check")) throw rollbackError;
      throw new Error(`The Actor inventory check failed and Foundry could not safely roll back the Item (${rollbackError.message}). The transfer is marked for reconciliation; do not retry yet.`);
    }
  }

  const commitRecords = currentRecords();
  const commitRecord = commitRecords.find(entry => entry.id === recordId);
  if (!commitRecord?.pendingTransfer || commitRecord.pendingTransfer.transferId !== transferId) throw new Error("The Actor contains the verified Item, but the Ledger reservation changed. The transfer is marked for reconciliation; do not retry yet.");
  applyTransferToHoldings(commitRecord, pending);
  assertHoldingBalance(commitRecord);
  const message = `Transferred ${persisted.name} ×${quantity} to ${actor.name}. Actor inventory and Ledger holdings were verified.`;
  rememberMutation(commitRecord, requestId, "take", message);
  try { await writeRecords(commitRecords); }
  catch (saveError) {
    const saved = currentRecords().find(entry => entry.id === recordId);
    const committed = saved?.currentHoldings?.actors?.some(entry => entry.transferIds?.includes(transferId));
    if (!committed) {
      try {
        await actor.deleteEmbeddedDocuments("Item", [persisted.id]);
        if (actor.getEmbeddedDocument("Item", persisted.id)) throw new Error("Foundry still reports the Item in the Actor inventory.");
        const clearRecords = currentRecords();
        const clearRecord = clearRecords.find(entry => entry.id === recordId);
        if (clearRecord?.pendingTransfer?.transferId === transferId) { delete clearRecord.pendingTransfer; await writeRecords(clearRecords); }
      } catch (rollbackError) {
        throw new Error(`Ledger save failed (${saveError.message}) and the Actor transfer could not be rolled back (${rollbackError.message}). The transfer is marked for reconciliation; do not retry yet.`);
      }
      throw new Error(`Ledger save failed. The Actor Item was rolled back and holdings remain unchanged. (${saveError.message})`);
    }
  }
  const updated = currentRecords().find(entry => entry.id === recordId);
  assertHoldingBalance(updated);
  return { record: updated, message };
}

function applyTransferToHoldings(record, pending) {
  const holdings = clone(record.currentHoldings ?? { actors: [], stashes: [], unassignedQuantity: Number(record.quantityFound ?? 0) });
  holdings.actors ??= [];
  holdings.stashes ??= [];
  holdings.unassignedQuantity = Number(holdings.unassignedQuantity ?? unassignedQuantity(record));
  const existing = holdings.actors.find(entry => entry.actorId === pending.actorId);
  if (existing?.transferIds?.includes(pending.transferId)) {
    record.currentHoldings = holdings;
    delete record.pendingTransfer;
    if (pending.requestId) {
      const message = `Transferred ${pending.itemName} ×${pending.quantity} to ${pending.actorName}. Actor inventory and Ledger holdings were verified.`;
      appendHistory(record, { requestId: pending.requestId, action: "take", actorId: pending.actorId, actorName: pending.actorName, quantity: pending.quantity, message });
      rememberMutation(record, pending.requestId, "take", message);
    }
    return;
  }
  if (holdings.unassignedQuantity < pending.quantity) {
    throw new Error("The Ledger no longer has enough Unassigned loot to reconcile this transfer.");
  }
  if (existing) {
    existing.quantity = Number(existing.quantity ?? existing.amount ?? existing.count ?? 0) + pending.quantity;
    existing.actorName = pending.actorName;
    existing.transferIds ??= [];
    existing.transferIds.push(pending.transferId);
  } else {
    holdings.actors.push({ actorId: pending.actorId, actorName: pending.actorName, quantity: pending.quantity, transferIds: [pending.transferId] });
  }
  holdings.unassignedQuantity -= pending.quantity;
  record.currentHoldings = holdings;
  delete record.pendingTransfer;
  if (pending.requestId) {
    const message = `Transferred ${pending.itemName} ×${pending.quantity} to ${pending.actorName}. Actor inventory and Ledger holdings were verified.`;
    appendHistory(record, { requestId: pending.requestId, action: "take", actorId: pending.actorId, actorName: pending.actorName, quantity: pending.quantity, message });
    rememberMutation(record, pending.requestId, "take", message);
  }
}

async function recoverPendingTransfer(recordId, onUpdated) {
  const records = currentRecords();
  const record = records.find(entry => entry.id === recordId);
  const pending = record?.pendingTransfer;
  if (!pending) return record;
  const actor = game.actors.get(pending.actorId);
  if (!actor) throw new Error("The Actor for a pending Take Loot transfer is unavailable. The reservation remains in place; no change was made.");
  const item = findTransferItem(actor, pending.transferId, record.id);
  if (!item) {
    delete record.pendingTransfer;
    await writeRecords(records);
    ui.notifications.warn("A previous transfer did not leave an Item on the Actor. The pending attempt was cleared; no duplicate was created.");
    return record;
  }
  const inPhysicalInventory = actor?.system?.getPhysicalItems?.().some(entry => entry.id === item.id);
  if (Number(item.system?.quantity) !== Number(pending.quantity)
    || !item.system?.isPhysical
    || !inPhysicalInventory
    || (pending.itemName && item.name !== pending.itemName)) {
    throw new Error("A previous transfer left an Item that does not match the expected Actor inventory. It was not duplicated; ask the GM to inspect the Actor before retrying.");
  }
  const { usage, capacity } = actorUsage(actor);
  if (Number(usage.total) > capacity) {
    throw new Error("A previous transfer left the Actor over capacity. The Ledger was not updated and retry is blocked to prevent a duplicate.");
  }
  applyTransferToHoldings(record, pending);
  assertHoldingBalance(record);
  await writeRecords(records);
  renderRecordList();
  onUpdated?.(record);
  ui.notifications.info("A previously completed Actor transfer was verified and reconciled with the Ledger.");
  return record;
}

function takeLootMarkup(record, actors, selectedActorId = "", quantity = 1, message = "") {
  const item = record.snapshot?.relevant ?? record.snapshot?.itemData ?? {};
  const available = unassignedQuantity(record);
  const image = item.img ? `<img class="ll-take-img" src="${escape(item.img)}" alt="">` : "";
  const actorOptions = actors.map(actor => `<option value="${escape(actor.id)}"${actor.id === selectedActorId ? " selected" : ""}>${escape(actor.name)} — ${escape(actor.type)}</option>`).join("");
  return `<section class="ll-take-form" data-record-id="${escape(record.id)}">
    <div class="ll-take-item">${image}<div><strong>${escape(item.name ?? "Unnamed item")}</strong><span>Available Unassigned: <b class="ll-take-available">${available}</b></span></div></div>
    <label>Actor<select name="actorId"><option value="">Select an Actor</option>${actorOptions}</select></label>
    <label>Quantity<input name="quantity" type="number" min="1" step="1" value="${escape(quantity)}" max="${available}" required></label>
    <dl class="ll-take-slots">
      <dt>Current slots</dt><dd data-slot="current">—</dd>
      <dt>Free slots</dt><dd data-slot="free">—</dd>
      <dt>Transfer cost</dt><dd data-slot="cost">—</dd>
      <dt>Free slots after transfer</dt><dd data-slot="after">—</dd>
    </dl>
    <p class="ll-error" role="alert">${escape(message)}</p>
    <button type="button" class="ll-confirm-transfer" disabled>Confirm Take Loot</button>
  </section>`;
}

function actorHoldingsAvailableToUser(record) {
  return (record.currentHoldings?.actors ?? []).filter(holding => {
    const actor = game.actors.get(holding.actorId);
    return holdingAmount(holding) > 0 && actor && (game.user.isGM || actor.testUserPermission(game.user, "OWNER"));
  });
}

function openActorRemovalDialog(record, action, onUpdated) {
  const actorHoldings = actorHoldingsAvailableToUser(record);
  if (!actorHoldings.length) {
    ui.notifications.warn("There are no Actor-held items you can change for this record.");
    return;
  }
  const label = action === "sold" ? "Sold" : "Return to Unassigned";
  const options = actorHoldings.map(holding => {
    const actor = game.actors.get(holding.actorId);
    return `<option value="${escape(actor.id)}" data-available="${holdingAmount(holding)}">${escape(actor.name)} — ${holdingAmount(holding)} available</option>`;
  }).join("");
  const initial = holdingAmount(actorHoldings[0]);
  const content = `<section class="ll-actor-removal-form" data-record-id="${escape(record.id)}">
    <p>${action === "sold" ? "Record the selected items as sold and remove them from the Actor inventory." : "Remove the selected items from the Actor inventory and return them to Unassigned."}</p>
    <label>Actor<select name="actorId">${options}</select></label>
    <label>Quantity<input name="quantity" type="number" min="1" step="1" value="${initial}" max="${initial}" required></label>
    <p class="ll-error" role="alert"></p>
    <button type="button" class="ll-confirm-actor-change">Confirm ${escape(label)}</button>
  </section>`;
  const dialog = new Dialog({
    title: label,
    content,
    buttons: {},
    render: html => {
      const actorSelect = html.find('[name="actorId"]');
      const quantityInput = html.find('[name="quantity"]');
      const error = html.find(".ll-error");
      const confirm = html.find(".ll-confirm-actor-change");
      const updateMaximum = () => {
        const option = actorSelect.find("option:selected");
        const available = Number(option.attr("data-available"));
        quantityInput.attr("max", available);
        if (Number(quantityInput.val()) > available) quantityInput.val(available);
      };
      actorSelect.on("change", updateMaximum);
      confirm.on("click", async () => {
        const actorId = String(actorSelect.val() ?? "");
        const quantity = Number(quantityInput.val());
        const available = Number(actorSelect.find("option:selected").attr("data-available"));
        if (!actorId) { error.text("Choose an Actor."); return; }
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > available) { error.text(`Enter a whole number between 1 and ${available}.`); return; }
        confirm.prop("disabled", true);
        error.text("");
        try {
          const result = await requestMutation(action, { recordId: record.id, actorId, quantity });
          renderRecordList();
          onUpdated?.(result.record);
          ui.notifications.info(result.message);
          dialog.close();
        } catch (changeError) {
          error.text(changeError.message || "The Actor inventory could not be changed.");
          ui.notifications.error(error.text());
          confirm.prop("disabled", false);
        }
      });
    }
  }, { width: 470, resizable: false });
  dialog.render(true);
}

function openDeleteLootDialog(record, detailDialog) {
  const hasHoldings = hasCurrentHoldings(record);
  const blockMessage = hasHoldings
    ? "This record still has current holdings. Return Actor-held items to Unassigned first; records with Stash holdings cannot be deleted."
    : "This removes only the Ledger record. It does not remove Items from Actor inventories.";
  const content = `<section class="ll-delete-confirmation"><p>${escape(blockMessage)}</p><p><strong>${escape(recordName(record))}</strong></p>
    <p class="ll-error" role="alert"></p>
    <button type="button" class="ll-confirm-delete"${hasHoldings ? " disabled" : ""}>Delete Loot Record</button>
  </section>`;
  const dialog = new Dialog({
    title: "Delete Loot Record",
    content,
    buttons: {},
    render: html => html.find(".ll-confirm-delete").on("click", async event => {
      const button = $(event.currentTarget);
      const error = html.find(".ll-error");
      button.prop("disabled", true);
      try {
        const result = await requestMutation("delete", { recordId: record.id });
        renderRecordList();
        detailDialog.close();
        ui.notifications.info(result.message);
        dialog.close();
      } catch (deleteError) {
        error.text(deleteError.message || "The record could not be deleted.");
        ui.notifications.error(error.text());
        button.prop("disabled", false);
      }
    })
  }, { width: 470, resizable: false });
  dialog.render(true);
}

function openPendingActorMutationReview(record, detailDialog) {
  if (!canEditRecords()) {
    ui.notifications.warn("Only the active GM can review an interrupted Actor change.");
    return;
  }
  const content = `<section class="ll-pending-review">
    <p>This checks the saved Actor Items against the interrupted action. It never changes Actor inventory automatically.</p>
    <p>If the Actor still matches the original state, the unused reservation is cleared. If the complete change is already present, only Ledger holdings are reconciled. A partial or unexpected state stays paused for GM review.</p>
    <p class="ll-error" role="alert"></p>
    <button type="button" class="ll-confirm-pending-review">Review current state</button>
  </section>`;
  const dialog = new Dialog({
    title: "Review Interrupted Actor Change",
    content,
    buttons: {},
    render: html => html.find(".ll-confirm-pending-review").on("click", async event => {
      const button = $(event.currentTarget);
      const error = html.find(".ll-error");
      button.prop("disabled", true);
      error.text("");
      try {
        const updated = await serializeWorldMutation(() => reconcilePendingActorRemoval(record.id));
        detailDialog.data.content = itemDetailMarkup(updated);
        detailDialog.render(true);
        renderRecordList();
        ui.notifications.info("The interrupted action was reconciled without changing Actor inventory.");
        dialog.close();
      } catch (reviewError) {
        error.text(reviewError.message || "The interrupted action remains paused.");
        ui.notifications.warn(error.text());
        const latest = currentRecords().find(entry => entry.id === record.id);
        if (latest) {
          detailDialog.data.content = itemDetailMarkup(latest);
          detailDialog.render(true);
        }
        button.prop("disabled", false);
      }
    })
  }, { width: 520, resizable: false });
  dialog.render(true);
}

function openTakeLoot(record, onUpdated) {
  if (activeTransfers.has(record.id)) {
    ui.notifications.warn("A transfer for this loot record is already in progress.");
    return;
  }
  const actors = transferActors();
  let previewToken = 0;
  const dialog = new Dialog({
    title: "Take Loot",
    content: takeLootMarkup(record, actors),
    buttons: {},
    render: html => {
      const form = html.find(".ll-take-form");
      const actorSelect = form.find('[name="actorId"]');
      const quantityInput = form.find('[name="quantity"]');
      const error = form.find(".ll-error");
      const confirm = form.find(".ll-confirm-transfer");
      const fields = Object.fromEntries(["current", "free", "cost", "after"].map(key => [key, form.find(`[data-slot="${key}"]`)]));
      const updatePreview = () => {
        const token = ++previewToken;
        const actor = game.actors.get(actorSelect.val());
        const quantity = Number(quantityInput.val());
        const latest = currentRecords().find(entry => entry.id === record.id) ?? record;
        const available = unassignedQuantity(latest);
        form.find(".ll-take-available").text(available);
        quantityInput.attr("max", available);
        let valid = Boolean(actor) && Number.isInteger(quantity) && quantity > 0 && quantity <= available;
        let failure = "";
        for (const field of Object.values(fields)) field.text("—");
        if (activeTransfers.has(record.id)) { valid = false; failure = "Transfer in progress…"; }
        else if (latest.pendingTransfer) { valid = false; failure = "A previous transfer needs reconciliation before another can begin."; }
        else if (!actor) failure = "Choose an Actor.";
        else if (!Number.isInteger(quantity) || quantity < 1) failure = "Enter a positive whole-number quantity.";
        else if (quantity > available) failure = `Only ${available} item(s) remain Unassigned.`;
        if (valid) {
          try {
            const current = actorUsage(actor);
            const uuid = latest.sourceRef?.uuid;
            if (!uuid) throw new Error("The original Foundry Item reference is missing.");
            fields.current.text(`${current.usage.total}/${current.capacity}`);
            fields.free.text(current.free);
            confirm.prop("disabled", true);
            error.text("Checking Shadowdark slot cost…");
            foundry.utils.fromUuid(uuid).then(sourceItem => {
              if (!sourceItem || sourceItem.documentName !== "Item") throw new Error("The original Foundry Item can no longer be resolved. No transfer was made.");
              const projected = transferCandidate(actor, sourceItem, quantity);
              const cost = Number(projected.usage.total) - Number(current.usage.total);
              if (token !== previewToken) return;
              fields.cost.text(cost);
              fields.after.text(`${current.capacity - Number(projected.usage.total)} (${projected.usage.total}/${current.capacity})`);
              const stillCurrent = game.actors.get(actorSelect.val())?.id === actor.id
                && Number(quantityInput.val()) === quantity
                && (currentRecords().find(entry => entry.id === record.id)?.sourceRef?.uuid === uuid);
              if (!stillCurrent) return;
              valid = cost >= 0 && Number(projected.usage.total) <= current.capacity;
              if (!valid) failure = `Not enough room: ${current.free} free slot(s), but this transfer requires ${cost} slot(s).`;
              error.text(failure);
              confirm.prop("disabled", !valid);
            }).catch(resolveError => {
              if (token !== previewToken) return;
              error.text(resolveError.message || "Could not check the original Item and Shadowdark slots.");
              confirm.prop("disabled", true);
            });
          } catch (previewError) {
            valid = false;
            failure = previewError.message;
          }
        }
        if (!valid || failure) error.text(failure);
        confirm.prop("disabled", !valid || Boolean(failure));
      };
      actorSelect.on("change", updatePreview);
      quantityInput.on("input change", updatePreview);
      confirm.on("click", async () => {
        if (activeTransfers.has(record.id)) return;
        activeTransfers.add(record.id);
        confirm.prop("disabled", true);
        error.text("");
        try {
          const result = await requestMutation("take", { recordId: record.id, actorId: actorSelect.val(), quantity: Number(quantityInput.val()) });
          renderRecordList();
          onUpdated?.(result.record);
          ui.notifications.info(result.message);
          dialog.close();
        } catch (transferError) {
          console.error("Loot Ledger: Take Loot transfer failed", transferError);
          error.text(transferError.message || "The transfer could not be confirmed. Ledger holdings were not changed.");
          confirm.prop("disabled", true);
          ui.notifications.error(error.text());
        } finally {
          activeTransfers.delete(record.id);
          if (dialog.rendered && !error.text()) updatePreview();
        }
      });
      updatePreview();
    }
  }, { width: 520, resizable: true });
  dialog.render(true);
}
function itemDetailMarkup(record, activeTab = "overview", editing = false) {
  const item = record.snapshot?.relevant ?? record.snapshot?.itemData ?? {};
  const slotDetails = itemSlotDetails(record);
  const name = item.name ?? "Unnamed item";
  const img = item.img
    ? `<img class="ll-detail-img" src="${escape(item.img)}" alt="">`
    : `<span class="ll-detail-img ll-no-image" aria-hidden="true"><i class="fa-solid fa-coins"></i></span>`;
  const description = record.description ? descriptionMarkup(record.description) : "";
  const descriptionTopMarkup = description ? `<div class="ll-detail-description-top">${description}</div>` : "";
  const tabs = ["overview", "history", "edit"];
  const tabButton = (tab, label) => `<button type="button" class="ll-detail-tab${activeTab === tab ? " is-active" : ""}" data-tab="${tab}" aria-selected="${activeTab === tab}">${label}</button>`;
  const actorActions = actorHoldingsAvailableToUser(record).length
    ? `<div class="ll-actor-actions"><button type="button" class="ll-sold-loot">Sold</button><button type="button" class="ll-return-actor-loot">Return to Unassigned</button></div>`
    : "";
  const deleteAction = game.user?.isGM ? `<button type="button" class="ll-delete-loot">Delete</button>` : "";
  const pendingReview = canEditRecords() && record.pendingActorMutation
    ? `<div class="ll-pending-review-action"><p>This record has an interrupted Actor change.</p><button type="button" class="ll-review-pending">Review interrupted action</button></div>`
    : "";
  const overview = `<div class="ll-detail-overview"><div class="ll-detail-summary">${img}<div class="ll-detail-summary-content"><h2>${escape(name)}</h2>${descriptionTopMarkup}</div></div><dl class="ll-detail-fields">
      <dt>Quantity found</dt><dd>${detailValue(record.quantityFound)}</dd>
      <dt>Estimated market value per item</dt><dd>${detailValue(record.estimatedMarketValue)}</dd>
      <dt>Item type</dt><dd>${detailValue(item.type)}</dd>
      <dt>Stack size</dt><dd>${escape(slotDetails.stackSize)}</dd>
      <dt>Slots per full stack</dt><dd>${escape(slotDetails.slotsPerStack)}</dd>
      <dt>Slots for quantity found (${escape(slotDetails.quantityFound)})</dt><dd>${escape(slotDetails.totalSlots)}</dd>
      <dt>Found during</dt><dd>${detailValue(record.foundDuring)}</dd>
      <dt>Location</dt><dd>${detailValue(record.location)}</dd>
      <dt>Whereabouts</dt><dd class="ll-whereabouts">${holdingLines(record)}</dd>
    </dl><button type="button" class="ll-take-loot">TAKE LOOT</button>${actorActions}${deleteAction}${pendingReview}${SHOW_STASH_UI ? stashActionsMarkup(record) : ""}</div>`;
  const historyEntries = [...(record.history ?? [])].sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0));
  const history = historyEntries.length
    ? `<ol class="ll-history-list">${historyEntries.map(entry => `<li><strong>${escape(entry.action === "take" ? "Taken" : entry.action === "sold" ? "Sold" : entry.action === "return-to-unassigned" ? "Returned to Unassigned" : entry.action)}</strong><span>${escape(entry.message ?? "")}</span><small>${escape(entry.actorName ?? "")} · ${escape(entry.quantity ?? "")} · ${escape(entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "")}</small></li>`).join("")}</ol>`
    : `<div class="ll-detail-history"><p>No history recorded yet.</p></div>`;
  const edit = canEditRecords() ? `<form class="ll-detail-edit"><div class="ll-campaign-fields">
      <label>Quantity found<input name="quantityFound" type="number" min="1" step="1" value="${escape(record.quantityFound ?? 1)}" required></label>
      <label>Estimated market value per item<input name="estimatedMarketValue" type="text" value="${escape(record.estimatedMarketValue ?? "")}" placeholder="Blank means unknown"></label>
      <label>Found during<input name="foundDuring" type="text" value="${escape(record.foundDuring ?? "")}"></label>
      <label>Location<input name="location" type="text" value="${escape(record.location ?? "")}"></label>
      <label class="ll-description">Description<textarea name="description" rows="3">${escape(record.description ?? "")}</textarea></label>
    </div><p class="ll-error" role="alert"></p><button type="submit" class="ll-save-record">Save changes</button></form>`
    : `<p class="ll-readonly-note">Campaign details can only be edited by a GM.</p>`;
  return `<section class="ll-detail-root"><nav class="ll-detail-tabs" role="tablist">${tabButton("overview", "Overview")}${tabButton("history", "History")}${tabButton("edit", "Edit")}</nav>
    <div class="ll-detail-panel${activeTab === "overview" ? " is-active" : ""}" data-panel="overview">${overview}</div>
    <div class="ll-detail-panel${activeTab === "history" ? " is-active" : ""}" data-panel="history">${history}</div>
    <div class="ll-detail-panel${activeTab === "edit" ? " is-active" : ""}" data-panel="edit">${edit}</div>
  </section>`;
}

function openItemDetail(record) {
  let currentRecord = record;
  let currentTab = "overview";
  let detailDialog;
  const fitDetailDialog = html => {
    if (!detailDialog?.rendered) return;
    const root = html?.find(".ll-detail-root")?.[0];
    const windowElement = detailDialog.element?.[0];
    const windowContent = detailDialog.element?.find(".window-content")?.[0];
    const contentHeight = root?.getBoundingClientRect?.().height;
    const outerHeight = windowElement?.getBoundingClientRect?.().height;
    const visibleContentHeight = windowContent?.getBoundingClientRect?.().height;
    if (![contentHeight, outerHeight, visibleContentHeight].every(Number.isFinite)) {
      detailDialog.setPosition({ height: "auto" });
      return;
    }
    const chromeHeight = Math.max(0, outerHeight - visibleContentHeight);
    const desiredHeight = Math.ceil(contentHeight + chromeHeight);
    const screenLimit = Math.max(240, window.innerHeight - 16);
    detailDialog.setPosition({ height: Math.min(desiredHeight, screenLimit) });
  };
  const refreshDetail = (updated = currentRecord, tab = "overview") => {
    currentRecord = updated;
    currentTab = tab;
    detailDialog.data.content = itemDetailMarkup(updated, currentTab);
    detailDialog.render(true);
  };
  detailDialog = new Dialog({
    title: record.snapshot?.relevant?.name ?? record.snapshot?.itemData?.name ?? "Item Detail",
    content: itemDetailMarkup(record, currentTab),
    buttons: {},
    render: html => {
      html.find(".ll-detail-tab").on("click", event => {
        const tab = $(event.currentTarget).attr("data-tab");
        refreshDetail(currentRecord, tab);
      });
      html.find(".ll-take-loot").on("click", () => openTakeLoot(currentRecord, updated => {
        refreshDetail(updated);
      }));
      html.find(".ll-sold-loot").on("click", () => openActorRemovalDialog(currentRecord, "sold", updated => {
        refreshDetail(updated);
      }));
      html.find(".ll-return-actor-loot").on("click", () => openActorRemovalDialog(currentRecord, "return-actor", updated => {
        refreshDetail(updated);
      }));
      html.find(".ll-delete-loot").on("click", () => openDeleteLootDialog(currentRecord, detailDialog));
      html.find(".ll-review-pending").on("click", () => openPendingActorMutationReview(currentRecord, detailDialog));
      html.find(".ll-stash-loot").on("click", () => openStashDialog(currentRecord, updated => {
        refreshDetail(updated);
      }));
      html.find(".ll-return-stash").on("click", event => {
        const button = $(event.currentTarget);
        openReturnStashDialog(currentRecord, button.attr("data-location"), Number(button.attr("data-available")), updated => {
          refreshDetail(updated);
        });
      });
      html.find(".ll-detail-edit").on("submit", async event => {
        event.preventDefault();
        const form = $(event.currentTarget);
        const error = form.find(".ll-error");
        const quantity = Number(form.find('[name="quantityFound"]').val());
        const estimatedMarketValue = String(form.find('[name="estimatedMarketValue"]').val() ?? "").trim();
        const foundDuring = String(form.find('[name="foundDuring"]').val() ?? "").trim();
        const location = String(form.find('[name="location"]').val() ?? "").trim();
        const description = String(form.find('[name="description"]').val() ?? "").trim();
        if (!Number.isInteger(quantity) || quantity < 1) {
          error.text("Quantity found must be a whole number greater than zero.");
          return;
        }
        const saveButton = form.find(".ll-save-record");
        saveButton.prop("disabled", true);
        error.text("");
        try {
          const updated = await serializeWorldMutation(async () => {
            const records = currentRecords();
            const latest = records.find(entry => entry.id === currentRecord.id);
            if (!latest) throw new Error("This Loot record is no longer available.");
            if (latest.pendingTransfer || latest.pendingActorMutation) throw new Error("This record has an inventory change that needs reconciliation. Campaign details cannot be edited until it is resolved.");
            const holdings = normalizedHoldings(latest);
            assertHoldingBalance(latest, holdings);
            const nextUnassigned = holdings.unassignedQuantity + quantity - Number(latest.quantityFound ?? 0);
            if (nextUnassigned < 0) throw new Error("Quantity cannot be lower than the amount already held by Actors or stashes.");
            holdings.unassignedQuantity = nextUnassigned;
            latest.quantityFound = quantity;
            latest.estimatedMarketValue = estimatedMarketValue;
            latest.foundDuring = foundDuring;
            latest.location = location;
            latest.description = description;
            latest.currentHoldings = holdings;
            assertHoldingBalance(latest, holdings);
            await writeRecords(records);
            return latest;
          });
          currentRecord = updated;
          renderRecordList();
          refreshDetail(updated);
          ui.notifications.info("Loot record updated.");
        } catch (saveError) {
          console.error("Loot Ledger: failed to update Loot record", saveError);
          error.text(`Could not save changes: ${saveError.message}`);
          saveButton.prop("disabled", false);
        }
      });
      fitDetailDialog(html);
    }
  }, { width: 620, height: "auto", resizable: true, classes: ["ll-detail-dialog"] });
  detailDialog.render(true);
}

function itemSummary(data) {
  const system = data.system ?? {};
  return {
    name: data.name,
    img: data.img,
    type: data.type,
    quantity: system.quantity ?? null,
    slots: clone(system.slots ?? null),
    slotsUsed: system.slotsUsed ?? system.slots?.slots_used ?? null
  };
}

function suggestedMarketValue(itemData) {
  const cost = itemData?.system?.cost;
  if (!cost || typeof cost !== "object") return "";
  const gp = Number(cost.gp ?? 0);
  const sp = Number(cost.sp ?? 0);
  const cp = Number(cost.cp ?? 0);
  if (![gp, sp, cp].every(Number.isFinite)) return "";
  // Market Value is stored and shown per individual item, independent of stack size.
  const valueInGp = gp + sp / 10 + cp / 100;
  if (valueInGp <= 0) return "";
  return `${Number(valueInGp.toFixed(2))} gp`;
}

function openAddLoot(item) {
  const data = clone(item.toObject());
  const summary = itemSummary(data);
  const suggestedValue = suggestedMarketValue(data);
  const img = summary.img ? `<img class="ll-preview-img" src="${escape(summary.img)}" alt="">` : "";
  const initialQuantity = Number(summary.quantity ?? 1);
  const slotDetails = slotDetailsForItemData(data, initialQuantity);
  const details = `<div class="ll-item-preview">${img}<div class="ll-item-fields">
    <div><b>Item</b><span>${escape(summary.name)}</span></div>
    <div><b>Item type</b><span>${escape(summary.type)}</span></div>
    <div><b>Quantity in source Item</b><span>${escape(summary.quantity ?? "—")}</span></div>
    <div><b>Stack size</b><span>${escape(slotDetails.stackSize)}</span></div>
    <div><b>Slots per full stack</b><span>${escape(slotDetails.slotsPerStack)}</span></div>
    <div><b>Slots for quantity found (<span class="ll-preview-slot-quantity">${escape(initialQuantity)}</span>)</b><span class="ll-preview-slot-total">${escape(slotDetails.totalSlots)}</span></div>
  </div></div>`;
  const content = `<section class="ll-add-form">
    <p class="ll-intro">Foundry Item details are read-only here. Add the campaign details for this loot record.</p>
    ${details}
    <div class="ll-campaign-fields">
      <label>Quantity found<input name="quantityFound" type="number" min="1" step="1" value="${escape(summary.quantity ?? 1)}" required></label>
      <label>Estimated market value per item<input name="estimatedMarketValue" type="text" value="${escape(suggestedValue)}" placeholder="Blank means unknown"></label>
      <label>Found during<input name="foundDuring" type="text"></label>
      <label>Location<input name="location" type="text"></label>
      <label class="ll-description">Description<textarea name="description" rows="3"></textarea></label>
    </div>
    <p class="ll-error" role="alert"></p>
    <button type="button" class="ll-save-record">Add Loot</button>
  </section>`;

  let addDialog;
  addDialog = new Dialog({
    title: "Add Loot",
    content,
    buttons: { cancel: { label: "Cancel" } },
    default: "cancel",
    render: html => {
      html.find('[name="quantityFound"]').on("input change", event => {
        const quantity = Number(event.currentTarget.value);
        const currentSlotDetails = slotDetailsForItemData(data, Number.isInteger(quantity) && quantity > 0 ? quantity : 0);
        html.find(".ll-preview-slot-quantity").text(Number.isInteger(quantity) && quantity > 0 ? quantity : "—");
        html.find(".ll-preview-slot-total").text(currentSlotDetails.totalSlots);
      });
      html.find(".ll-save-record").on("click", async () => {
        const error = html.find(".ll-error");
        const quantity = Number(html.find('[name="quantityFound"]').val());
        const estimatedMarketValue = String(html.find('[name="estimatedMarketValue"]').val() ?? "").trim();
        const foundDuring = String(html.find('[name="foundDuring"]').val() ?? "").trim();
        const location = String(html.find('[name="location"]').val() ?? "").trim();
        const description = String(html.find('[name="description"]').val() ?? "").trim();
        if (!Number.isInteger(quantity) || quantity < 1) {
          error.text("Quantity found must be a whole number greater than zero.");
          return;
        }
        const saveButton = html.find(".ll-save-record");
        saveButton.prop("disabled", true);
        error.text("");
        try {
          const sourceData = clone(item.toObject());
          const snapshotData = clone(sourceData);
          delete snapshotData._id;
          delete snapshotData.folder;
          delete snapshotData.sort;
          delete snapshotData.ownership;
          delete snapshotData._stats;
          const sourceIsCompendium = Boolean(item.pack || item.parent?.collection);
          const record = {
            id: foundry.utils.randomID(),
            createdAt: Date.now(),
            sourceRef: {
              id: item.id,
              uuid: item.uuid,
              sourceType: sourceIsCompendium ? "compendium" : "world",
              pack: item.pack ?? item.parent?.collection ?? null
            },
            snapshot: {
              schemaVersion: 1,
              capturedAt: Date.now(),
              itemData: snapshotData,
              relevant: itemSummary(snapshotData)
            },
            quantityFound: quantity,
            estimatedMarketValue,
            foundDuring,
            location,
            description,
            currentHoldings: { actors: [], stashes: [], unassignedQuantity: quantity, soldQuantity: 0 }
          };
          await serializeWorldMutation(async () => {
            const records = currentRecords();
            records.push(record);
            await writeRecords(records);
          });
          addDialog.close();
          ui.notifications.info(`Loot record saved: ${record.snapshot.relevant.name}.`);
          renderRecordList();
        } catch (saveError) {
          console.error("Loot Ledger: failed to save Loot record", saveError);
          error.text(`Could not save the Loot record: ${saveError.message}`);
          saveButton.prop("disabled", false);
        }
      });
    }
  }, { width: 600, resizable: true });
  addDialog.render(true);
}
