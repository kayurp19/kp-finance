# KP Finance

A private personal-finance reconciliation app for Kayur. Tracks personal spending, attributes business-card purchases to specific businesses for reimbursement, and reconciles statements against bank accounts.

Designed to be deployed at **kp.sundhm.com** via Railway.

---

## Features

- **Single-password login** — JWT cookie session, 30-day expiry
- **Accounts** — checking, savings, credit cards. Per-account reconciliation flow (statement balance + cleared checkboxes + diff)
- **Transactions** — list, filter, search, edit, CSV export. One-click "business expense" tag with per-business attribution.
- **CSV Import** — 5-step wizard (account → upload → map columns → preview with dedup → commit). Import history with one-click undo.
- **Reimbursements** — per-business owed amount, mark-cleared (preserves history), monthly + all-time totals.
- **Bills** — recurring + one-time, autopay tracking, mark-paid creates a transaction.
- **Categories + Rules** — auto-categorize on import via merchant/description rules.
- **Reports** — donut for spending by category, bar for top merchants, line for income vs expense over time.
- **Dashboard** — spending headline (business excluded by default), per-business owed breakdown, top categories with bars, accounts list, upcoming bills, recent activity.
- **Settings** — change password, daily/weekly digest toggles, SMTP setup banner.

## Quick Start (Local)

```bash
cd kp-finance
npm install
npm run dev
```

Open http://localhost:5000

**Default password:** `kayur2026` (change in Settings after first login).

The SQLite database is created automatically at `data.db` on first run, with 27 personal categories and 4 businesses (Cicero Grand, Syracuse Grand, Super 8, PuroClean) pre-seeded.

## Production Build

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

## Tech Stack

- **Backend:** Express, better-sqlite3, Drizzle ORM, bcryptjs, jsonwebtoken, papaparse
- **Frontend:** React, Vite, Tailwind v3, shadcn/ui, TanStack Query, wouter (hash routing), recharts
- **Auth:** httpOnly cookie (`kpf_session`), 30-day JWT
- **Data:** All money stored as cents (integers); credit-card balance is negative when owed.

## Environment Variables

| Var                  | Purpose                                                   |
| -------------------- | --------------------------------------------------------- |
| `APP_PASSWORD_HASH`  | bcrypt hash override; falls back to settings table.       |
| `SESSION_SECRET`     | JWT signing secret; auto-generated to settings if missing.|
| `DATABASE_PATH`      | SQLite file path (default `data.db`).                     |
| `SMTP_HOST`          | SMTP server hostname (for digest delivery).               |
| `SMTP_PORT`          | SMTP port.                                                |
| `SMTP_USER`          | SMTP username.                                            |
| `SMTP_PASS`          | SMTP password.                                            |
| `SMTP_FROM`          | Display from-address (e.g. `KP Finance <kp@sundhm.com>`). |

## Railway Deploy

1. Push this repo to GitHub.
2. New Railway project → "Deploy from GitHub" → select repo.
3. Railway auto-detects Node. Build command: `npm run build`. Start: `node dist/index.cjs`.
4. Add a persistent volume mounted at `/data` and set `DATABASE_PATH=/data/data.db`.
5. Set env vars: `SESSION_SECRET`, `APP_PASSWORD_HASH` (optional — generate via `node -e "console.log(require('bcryptjs').hashSync('your-pw',10))"`).
6. Custom domain → `kp.sundhm.com` → point CNAME at Railway's domain.
7. Optional: configure SMTP env vars to enable digest emails.

## Sample CSV (for import)

```csv
Date,Description,Amount
2026-04-20,Costco grocery run,-127.43
2026-04-21,Refund - Amazon,42.99
2026-04-22,Lunch with team,-58.00
```

The importer auto-detects date, description, and amount columns. It also supports separate Debit/Credit columns and inverted-sign amounts.

## Future: Business-Entity Expansion

The current architecture treats businesses as **tags** on personal transactions for reimbursement tracking. To grow into separate full business books later:

- The `businesses` table is already in place (id, name, archived).
- Add a `bookType` column to `accounts` ("personal" | "business") and filter dashboards/reports by book.
- Add per-business income/expense categories (currently the seeded 27 are all personal).
- Add a `businessId` filter on imports + bills.
- Promote `businesses` to first-class navigation alongside Accounts.

The schema's `entity` column on transactions is already there as a forward-compat hook.

## Data Model

See `shared/schema.ts`. Tables:

- `accounts` — incl. `lastReconciledAt`, `lastReconciledBalance`
- `categories` — incl. `parentId`, `color`, `icon`, `isIncome`
- `transactions` — incl. `isBusinessExpense`, `businessId`, `reimbursedAt`, `reconciled`, `reconciledAt`, `externalId` (SHA-1 dedup), `importBatchId`
- `categoryRules` — match rules for auto-categorization on import
- `bills` + `billPayments`
- `importBatches` — for one-click undo
- `settings` — key/value (password hash, session secret, digest toggles)
- `businesses`
- `reimbursementClearings` — historical record of "mark cleared" actions

## License

Private. © Kayur.
