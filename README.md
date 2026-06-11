# X-VAULT — Digital Goods Marketplace

A fully functional Z2U/G2G-style three-sided marketplace (buyer / seller / admin) with
**USDT escrow**, instant auto-delivery, manual delivery with SLAs, disputes, live chat
with auto-moderation, seller levels, wallets with an immutable double-entry ledger, and a
complete admin back office.

Built with **TanStack Start + React 19 + Tailwind 4**. The backend runs entirely in
server functions on a **dual-engine data layer**:

| `DATABASE_URL` env var | Engine | Use case |
|---|---|---|
| not set | SQLite file in `./data` (zero config) | local development |
| set to a Supabase/Postgres URL | Postgres via postgres.js | Lovable / production |

Schema creation **and demo seeding happen automatically on first boot** on either
engine — there is nothing to migrate by hand.

## Run it locally (developer mode)

```bash
npm install        # or bun install
npm run dev        # starts the dev server (Node runtime)
```

First boot creates `data/marketplace.db` and seeds categories, demo products with
encrypted stock codes, and demo accounts.

## Connect Supabase (for Lovable / hosted deployments)

The published Lovable site runs on serverless hosting with no file storage, so it
needs a hosted database. Steps (no SQL knowledge required):

1. In **Supabase**: create a project (free tier is fine) and set a database password.
2. In Supabase, click **Connect** (top bar) → copy the **Transaction pooler**
   connection string — it looks like
   `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`.
   Replace `[YOUR-PASSWORD]` with your database password.
3. Give that string to the app as the `DATABASE_URL` environment variable / secret
   (in Lovable: project settings → secrets / environment variables; locally: put it
   in a `.env` file — see `.env.example`).
4. Also set `STOCK_ENCRYPTION_KEY` to any long random string (protects stock codes).
5. Open the site — on the first request the app creates all tables in Supabase and
   seeds the demo accounts automatically. `supabase/migrations/0001_init.sql`
   contains the same schema if you ever want to run it manually in the SQL editor.

### Demo accounts (password for all: `Password123!`)

| Email | Role |
|---|---|
| `admin@xvault.test` | Super admin |
| `finance@xvault.test` | Finance staff (withdrawal queue) |
| `support@xvault.test` | Support staff (disputes, moderation) |
| `goldrush@xvault.test` | Approved seller with live products & stock |
| `keymaster@xvault.test` | Approved seller |
| `buyer@xvault.test` | Buyer |

## What's implemented

**Escrow state machine** (the heart of the platform):

```
awaiting_payment → paid → delivered → completed (warranty) → released
        ↘ expired                ↘ disputed → refunded / released (admin)
```

- USDT checkout with unique deposit address, 30-min payment window and live countdown.
  Payment confirmation is **simulated** in this build — the "I've sent the USDT" button
  drives the exact same `confirmPayment()` transition a real NOWPayments/Cryptomus
  webhook would call.
- **Auto delivery**: sellers bulk-upload codes (AES-256-GCM encrypted at rest, SHA-256
  duplicate detection); codes are reserved at checkout and revealed to the buyer the
  moment payment confirms.
- **Manual delivery**: per-product required buyer info, SLA countdown, proof notes;
  SLA breach lets the buyer cancel for a full refund and dings seller completion rate.
- **Warranty + auto-confirm**: buyer confirms (or auto-confirm after the configured
  window); escrow releases to the seller only after the per-category warranty passes
  with no dispute. The spec's cron workers (order-expirer, auto-confirmer,
  escrow-release) run as throttled in-process sweeps on every relevant request.
- **Wallets & ledger**: pending (escrow) / available / frozen balances, immutable
  double-entry ledger rows for every hold, release, commission, refund, withdrawal and
  adjustment. All money mutations run inside SQLite transactions.
- **Disputes**: buyer opens within warranty, seller responds with evidence, staff
  resolve with full refund / partial refund / release — all wallet math handled.
- **Withdrawals**: per-level weekly caps, flat fee, finance approval queue,
  reject-with-reversal, on-chain tx hash recording.
- **Chat**: pre-sale and per-order conversations, system messages on every status
  change, unread badges, rate limiting, and regex auto-moderation that flags contact
  sharing / off-platform payment attempts into an admin queue.
- **Catalog**: 8 seeded categories with per-category commission %, warranty hours and
  risk tier; search, filters, sorting, pagination; product pages with reviews and
  escrow explainer; public seller stores.
- **Seller dashboard**: overview (sales, escrow, low-stock alerts), product CRUD with
  admin review on create *and* edit, stock manager, order queue with SLA column,
  reviews with replies, vacation mode, seller levels (listing caps + withdrawal caps).
- **Admin panel**: KPI dashboard (GMV, revenue, escrow held), seller KYC queue,
  product approval queue with prohibited-items policy, global order search with
  force actions (audited mandatory note), disputes center, finance (withdrawals +
  deposits monitor + manual balance adjustments), user management (ban, wallet
  freeze, roles, seller levels), chat moderation, category editor, platform settings
  (fees, windows, maintenance mode), full audit log.
- **Security**: scrypt password hashing, httpOnly session cookies, role-based
  authorization on every server function, stock ciphertext never sent to clients,
  velocity limits (unpaid orders, disputes/month, messages/min), audited staff actions.

## Tests

```bash
# backend escrow engine (27 checks, direct against the DB layer)
./node_modules/.bin/esbuild scripts/smoke-test.ts --bundle --platform=node \
  --format=esm --packages=external --outfile=data/.smoke.mjs && node data/.smoke.mjs

# full HTTP integration suite (23 checks over the real server-fn wire protocol)
bun run dev &   # in another terminal
node scripts/http-test.mjs http://127.0.0.1:<port>
```

## Going to production (per the original spec)

- Swap the simulated gateway for NOWPayments/Cryptomus: point the provider webhook at
  a route that verifies the HMAC signature and calls `confirmPayment(orderId)` —
  everything downstream already works.
- Move the in-process lifecycle sweeps to real cron workers if you split the backend
  onto a VPS (`sweepLifecycle()` is the single entry point).
- Set `STOCK_ENCRYPTION_KEY` in the environment (falls back to a dev key).
- better-sqlite3 requires a Node server runtime (not edge/workers). Swap
  `src/lib/server/db.server.ts` for Postgres if you outgrow SQLite.
