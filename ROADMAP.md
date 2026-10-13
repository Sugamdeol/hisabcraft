# Roadmap

Honest plan. Dates are soft. Every feature ships with tests.

## v1.1 — shop essentials
- [ ] Expense tracking (bills paid in cash, not via purchase invoice)
- [ ] Barcode scan + quick-sale mode for billing counters
- [ ] Invoice editing (delete + re-create is v1; editing needs careful stock reversal)
- [ ] GSTR-1 style JSON export (for portal upload)
- [ ] Tamil / Telugu / Marathi / Bengali UI labels
- [ ] WhatsApp invoice share (deep link with PDF)

## v1.2 — grow up
- [ ] E-way bill generation (NIC API, sandbox first)
- [ ] Self-hosted multi-device sync (optional, own server)
- [ ] Tauri desktop builds (Windows / macOS / Linux .exe/.dmg/.AppImage)
- [ ] Stock godowns, batch + expiry tracking
- [ ] Customer statements (PDF)

## v2.0 — the hard parts
- [ ] E-invoice (IRN + QR via GSTN) — needs registered taxpayer onboarding
- [ ] Multi-user roles (owner / cashier, permissions)
- [ ] Plugin API so shops can add their own reports
- [ ] GSTR-2B purchase reconciliation

## Explicitly NOT planned
- Cloud-first anything. Your data stays on your device unless you self-host sync.
- Ads, analytics, tracking. Ever.
