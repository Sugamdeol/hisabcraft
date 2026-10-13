# AGENTS.md — how AI agents work on this repo

This app is built to be agent-friendly. Follow these rules or you break the khata.

## Run the tests
```bash
node tests/gst.test.mjs
```
Every PR must keep them green. CI runs the same file.

## Where things live
- `js/gst.js` — pure GST math. CGST/SGST/IGST, discount, round-off, GSTIN checksum (official mod-36), Indian digit grouping, amount in words. **Zero dependencies, no DOM access.** Any change here needs a new test.
- `js/db.js` — IndexedDB wrapper. Stores: settings, parties, items, invoices, purchases, payments. JSON backup/restore.
- `js/i18n.js` — English + Hindi label dictionaries.
- `js/app.js` — UI: hash router, 8 views, invoice editor, print generation, CSV, demo data.
- `index.html`, `css/style.css`, `sw.js`, `manifest.webmanifest` — shell.

## Data model
- `parties`: { id, name, phone, gstin, state (2-digit code), address, type: 'customer'|'supplier' }
- `items`: { id, name, hsn, unit, gstRate, stock, lowAt, salePrice, purchasePrice }
- `invoices` / `purchases`: { id, no, seq, date, partyId, partyName, partyPhone, partyGstin, partyState, interState, lines[], taxable, cgst, sgst, igst, roundDiff, grandTotal }
- `invoice lines` are SNAPSHOTTED (name, hsn, unit copied from item) so records survive item edits.
- `payments`: { id, date, partyId, direction: 'in'|'out', amount, note, partyName }

## Rules (hard)
1. **Party balances are DERIVED, never stored.** customer: Σ(invoices) − Σ(payments in) + Σ(payments out). supplier: Σ(purchases) − Σ(payments out) + Σ(payments in). Never add a `balance` field.
2. **Sales decrement stock, purchases increment it.** Deleting a document reverses it.
3. **GST math changes REQUIRE a new test** in `tests/gst.test.mjs`.
4. **Zero dependencies.** No npm, no build step. Vanilla JS that runs from a static host.
5. **Inline form handlers must be async-safe**: use `onsubmit="saveX(event,...); return false;"` — an async handler returns a truthy Promise, which would submit the form.

## Debug console
The app exposes `window.HC = { DB, GST, state, partyBalance, ledgerEntries }` for debugging and automation.

## Adding a view
1. Add nav link in `index.html` with `data-view="name"`.
2. Add i18n keys (`nav_name`, `name`) to both dictionaries in `js/i18n.js`.
3. Add `case 'name': renderName(main); break;` in `renderView()` in `js/app.js`.
4. Write `renderName` as `async function`.
5. Register `window.yourFunction = ...` for anything called from inline HTML.
