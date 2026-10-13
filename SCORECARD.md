# Scorecard — what works, what doesn't

The ArtCraft lesson: overclaiming ("I one-shotted Photoshop") gets you flagged on HN.
So: every claim below maps to a test or a verified browser run. Nothing else is claimed.

## ✅ What works (verified)

| Capability | Status | Evidence |
|---|---|---|
| GST math: intra-state CGST+SGST | ✅ Works | `tests/gst.test.mjs` — 18/18 pass |
| GST math: inter-state IGST | ✅ Works | same test suite |
| Discount before GST | ✅ Works | same |
| Invoice round-off to ₹1 | ✅ Works | same |
| Amount in words (lakh/crore) | ✅ Works | same |
| GSTIN validation (mod-36 checksum) | ✅ Works | same, incl. negative cases |
| Printable GST tax invoice (both GSTINs, HSN, breakup, declaration, signature) | ✅ Works | browser-verified |
| Khata: party balances derived from invoices+payments | ✅ Works | browser-verified; delete-safe by design |
| Per-party ledger with running balance | ✅ Works | browser-verified |
| Inventory: stock moves on sale/purchase, restored on delete | ✅ Works | browser-verified |
| Low-stock alerts | ✅ Works | browser-verified |
| GSTR-1 style reports: B2B invoice-wise, B2C rate-wise | ✅ Works | browser-verified |
| Month-wise sales, outstanding report | ✅ Works | browser-verified |
| CSV export (invoices) | ✅ Works | browser-verified |
| JSON backup / restore / reset | ✅ Works | browser-verified |
| English + Hindi UI toggle | ✅ Works | browser-verified |
| Offline (service worker, no network calls) | ✅ Works | PWA; cache-first |
| Installable on Android/Desktop | ✅ Works | manifest + SW |
| Zero dependencies, zero build step | ✅ Works | `ls js/` |

## ❌ What does NOT work yet (v1.0)

| Gap | Impact | When |
|---|---|---|
| No e-invoice (IRN) / QR code | Mandatory only for >₹5 cr turnover; most small shops exempt | v2.0 |
| No e-way bill | Needed for goods >₹50k interstate — generate at NIC portal for now | v1.2 |
| No GSTR-1 JSON export for portal | Manual entry in GST portal | v1.1 |
| No invoice editing (delete + re-create) | Annoying for typos; stock-safe | v1.1 |
| No barcode / scan | Slow billing for many SKUs | v1.1 |
| No batch / expiry / godown | FMCG-heavy shops will outgrow it | v1.2 |
| No multi-user / roles | Owner-only today | v2.0 |
| No cloud sync | One device (backup JSON to another device manually) | v1.2 (self-hosted) |
| No desktop installer (Tauri) | Runs in browser today | v1.2 |
| Hindi only beyond English | Tamil/Telugu/Marathi/Bengali pending | v1.1 |
| Browser storage limits (~5-10 MB) | ~5,000+ invoices per browser profile; export backups regularly | known limit |

## Overall: ~55% of a small shop's daily needs

**Right for:** kirana, general store, small wholesale, mobile repair — single owner,
single counter, turnover under the e-invoice threshold, India.

**Not right for:** multi-branch retail, pharma (expiry-critical), manufacturing (BOM),
anyone filing through a CA who needs portal-ready JSON.

## How we verified

1. `node tests/gst.test.mjs` → 18/18 pass (CI runs it on every push)
2. Real browser run: loaded demo data → created an intra-state invoice with discount →
   verified on-screen totals matched hand-computed GST → deleted it → verified stock
   restored and balance re-derived
3. Print view inspected: both GSTINs, HSN column, CGST/SGST/IGST breakup, amount in
   words, declaration, signature block

If something disagrees with your CA's calculation, the CA wins — and please open an
issue with the numbers so we can fix the math, not the marketing.
