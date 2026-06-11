import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Dual-engine data layer.
 *
 *  - DATABASE_URL set (e.g. a Supabase Postgres connection string)  → postgres.js
 *  - otherwise → local SQLite file via better-sqlite3 (zero-config dev)
 *
 * One async interface for both:
 *   q(sql, params)  → all rows        q1(sql, params) → first row | undefined
 *   run(sql, params)→ void            tx(fn)          → serialized transaction
 *
 * SQL is written once in a portable dialect: `?` placeholders (translated to
 * $1..$n for Postgres), integer 0/1 flags, epoch-ms bigint timestamps.
 */

type Params = ReadonlyArray<string | number | null>;

interface Engine {
  q<T>(sql: string, params?: Params): Promise<T[]>;
  run(sql: string, params?: Params): Promise<void>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: () => Promise<T>): Promise<T>;
}

let engine: Engine | null = null;
let migrated: Promise<void> | null = null;

function isPostgres(): boolean {
  return !!process.env.DATABASE_URL;
}

// ---------------------------------------------------------------------------
// SQLite engine (local development / single-server deployments)
// ---------------------------------------------------------------------------
async function createSqliteEngine(): Promise<Engine> {
  const { default: Database } = await import("better-sqlite3");
  const { existsSync, mkdirSync } = await import("node:fs");
  const path = await import("node:path");
  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  const dbPath = process.env.DB_PATH ?? path.join(dataDir, "marketplace.db");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const d = new Database(dbPath);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");

  // single shared connection: serialize async transactions with a mutex
  let txChain: Promise<unknown> = Promise.resolve();
  let txDepth = 0;

  return {
    async q<T>(sql: string, params: Params = []) {
      return d.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: Params = []) {
      d.prepare(sql).run(...params);
    },
    async exec(sql: string) {
      d.exec(sql);
    },
    tx<T>(fn: () => Promise<T>): Promise<T> {
      if (txDepth > 0) return fn(); // join the outer transaction
      const job = txChain.then(async () => {
        txDepth++;
        d.exec("begin");
        try {
          const result = await fn();
          d.exec("commit");
          return result;
        } catch (e) {
          d.exec("rollback");
          throw e;
        } finally {
          txDepth--;
        }
      });
      txChain = job.catch(() => undefined);
      return job as Promise<T>;
    },
  };
}

// ---------------------------------------------------------------------------
// Postgres engine (Supabase or any Postgres via DATABASE_URL)
// ---------------------------------------------------------------------------
type PgSql = {
  unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  begin: <T>(fn: (tx: PgSql) => Promise<T>) => Promise<T>;
};

const pgTxStore = new AsyncLocalStorage<PgSql>();

function toPgPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

async function createPostgresEngine(): Promise<Engine> {
  const { default: postgres } = await import("postgres");
  const numericOids = [20, 1700]; // int8, numeric → JS numbers (cents/timestamps fit safely)
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 10,
    prepare: false, // required for Supabase transaction-mode pooler
    types: Object.fromEntries(
      numericOids.map((oid) => [
        `num${oid}`,
        {
          to: oid,
          from: [oid],
          serialize: (x: unknown) => String(x),
          parse: (x: string) => Number(x),
        },
      ]),
    ),
  }) as unknown as PgSql;

  const client = () => pgTxStore.getStore() ?? sql;
  return {
    async q<T>(text: string, params: Params = []) {
      return (await client().unsafe(toPgPlaceholders(text), params as unknown[])) as T[];
    },
    async run(text: string, params: Params = []) {
      await client().unsafe(toPgPlaceholders(text), params as unknown[]);
    },
    async exec(text: string) {
      await client().unsafe(text);
    },
    tx<T>(fn: () => Promise<T>): Promise<T> {
      if (pgTxStore.getStore()) return fn(); // join the outer transaction
      return sql.begin((txSql) => pgTxStore.run(txSql, fn)) as Promise<T>;
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function getEngine(): Promise<Engine> {
  if (!engine) engine = await (isPostgres() ? createPostgresEngine() : createSqliteEngine());
  if (!migrated) migrated = migrate(engine);
  await migrated;
  return engine;
}

export async function q<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]> {
  try {
    return await (await getEngine()).q<T>(sql, params);
  } catch (e) {
    console.error("[db] q failed:", (e as Error)?.message, "sql:", sql, "params:", JSON.stringify(params));
    throw e;
  }
}

export async function q1<T = Record<string, unknown>>(
  sql: string,
  params?: Params,
): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}

export async function run(sql: string, params?: Params): Promise<void> {
  try {
    return await (await getEngine()).run(sql, params);
  } catch (e) {
    console.error("[db] run failed:", (e as Error)?.message, "sql:", sql, "params:", JSON.stringify(params));
    throw e;
  }
}

export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  return (await getEngine()).tx(fn);
}

export function resetDbForTests() {
  engine = null;
  migrated = null;
}

// ---------------------------------------------------------------------------
// Schema — portable DDL applied on first boot (idempotent). The same schema
// ships as supabase/migrations/0001_init.sql for the Supabase SQL editor.
// ---------------------------------------------------------------------------
export function schemaSql(dialect: "sqlite" | "postgres"): string {
  const pk =
    dialect === "postgres"
      ? "bigint generated always as identity primary key"
      : "integer primary key autoincrement";
  const big = dialect === "postgres" ? "bigint" : "integer";
  const real = dialect === "postgres" ? "double precision" : "real";
  return `
  create table if not exists users (
    id text primary key,
    email text unique not null,
    username text unique not null,
    password_hash text not null,
    role text not null default 'buyer',
    seller_status text not null default 'none',
    seller_level integer not null default 1,
    rating ${real} not null default 0,
    rating_count integer not null default 0,
    total_sales integer not null default 0,
    completion_rate ${real} not null default 100,
    is_banned integer not null default 0,
    wallet_frozen integer not null default 0,
    vacation_mode integer not null default 0,
    created_at ${big} not null
  );

  create table if not exists sessions (
    token text primary key,
    user_id text not null references users(id),
    expires_at ${big} not null,
    created_at ${big} not null
  );

  create table if not exists seller_applications (
    id text primary key,
    user_id text not null references users(id),
    full_name text not null,
    country text not null,
    experience text not null,
    usdt_payout_address text not null,
    usdt_network text not null,
    status text not null default 'pending',
    admin_note text,
    reviewed_by text,
    created_at ${big} not null,
    reviewed_at ${big}
  );

  create table if not exists categories (
    id text primary key,
    name text not null,
    slug text unique not null,
    icon text,
    sort integer not null default 0,
    default_warranty_hours integer not null default 72,
    commission_pct ${real} not null default 8,
    risk_tier text not null default 'normal',
    is_active integer not null default 1
  );

  create table if not exists products (
    id text primary key,
    seller_id text not null references users(id),
    category_id text not null references categories(id),
    title text not null,
    slug text unique not null,
    description text not null,
    image_key text,
    delivery_type text not null,
    delivery_sla_minutes integer not null default 60,
    warranty_hours integer,
    price_cents ${big} not null,
    min_qty integer not null default 1,
    max_qty integer not null default 100,
    stock_count integer not null default 0,
    status text not null default 'pending_review',
    reject_reason text,
    region text,
    platform text,
    required_info text,
    views integer not null default 0,
    sold_count integer not null default 0,
    created_at ${big} not null
  );

  create table if not exists stock_items (
    id text primary key,
    product_id text not null references products(id),
    content_encrypted text not null,
    content_hash text not null,
    status text not null default 'available',
    order_id text,
    delivered_at ${big},
    created_at ${big} not null
  );
  create index if not exists idx_stock_product on stock_items(product_id, status);

  create table if not exists orders (
    id text primary key,
    order_no text unique not null,
    buyer_id text not null references users(id),
    seller_id text not null references users(id),
    product_id text not null references products(id),
    product_title text not null,
    image_key text,
    qty integer not null,
    unit_price_cents ${big} not null,
    total_cents ${big} not null,
    commission_pct ${real} not null,
    commission_cents ${big} not null,
    seller_net_cents ${big} not null,
    status text not null default 'awaiting_payment',
    delivery_type text not null,
    delivery_sla_minutes integer not null default 60,
    warranty_hours integer not null,
    buyer_info text,
    cancel_reason text,
    paid_at ${big},
    delivered_at ${big},
    completed_at ${big},
    warranty_ends_at ${big},
    released_at ${big},
    auto_confirm_at ${big},
    expires_at ${big},
    created_at ${big} not null
  );
  create index if not exists idx_orders_buyer on orders(buyer_id, created_at);
  create index if not exists idx_orders_seller on orders(seller_id, created_at);
  create index if not exists idx_orders_status on orders(status);

  create table if not exists order_deliveries (
    id text primary key,
    order_id text not null references orders(id),
    type text not null,
    payload text,
    note text,
    delivered_by text,
    created_at ${big} not null
  );

  create table if not exists deposits (
    id text primary key,
    order_id text references orders(id),
    user_id text not null references users(id),
    amount_cents ${big} not null,
    network text not null,
    pay_address text not null,
    tx_hash text,
    confirmations integer not null default 0,
    status text not null default 'pending',
    expires_at ${big},
    created_at ${big} not null
  );

  create table if not exists wallets (
    user_id text primary key references users(id),
    available_cents ${big} not null default 0,
    pending_cents ${big} not null default 0,
    frozen_cents ${big} not null default 0
  );

  create table if not exists wallet_ledger (
    id ${pk},
    user_id text not null,
    order_id text,
    type text not null,
    amount_cents ${big} not null,
    balance_after_cents ${big} not null,
    note text,
    created_at ${big} not null
  );
  create index if not exists idx_ledger_user on wallet_ledger(user_id, created_at);

  create table if not exists withdrawals (
    id text primary key,
    user_id text not null references users(id),
    amount_cents ${big} not null,
    fee_cents ${big} not null,
    address text not null,
    network text not null,
    status text not null default 'pending',
    tx_hash text,
    reviewed_by text,
    created_at ${big} not null,
    reviewed_at ${big}
  );

  create table if not exists conversations (
    id text primary key,
    order_id text references orders(id),
    product_id text references products(id),
    buyer_id text not null references users(id),
    seller_id text not null references users(id),
    buyer_last_read_at ${big} not null default 0,
    seller_last_read_at ${big} not null default 0,
    last_message_at ${big},
    created_at ${big} not null
  );
  create index if not exists idx_conv_buyer on conversations(buyer_id);
  create index if not exists idx_conv_seller on conversations(seller_id);

  create table if not exists messages (
    id text primary key,
    conversation_id text not null references conversations(id),
    sender_id text,
    body text not null,
    is_system integer not null default 0,
    is_flagged integer not null default 0,
    flag_reason text,
    moderated_at ${big},
    moderated_by text,
    created_at ${big} not null
  );
  create index if not exists idx_msg_conv on messages(conversation_id, created_at);

  create table if not exists disputes (
    id text primary key,
    order_id text unique not null references orders(id),
    opened_by text not null,
    reason text not null,
    description text,
    seller_response text,
    status text not null default 'open',
    resolution text,
    resolution_cents ${big},
    resolved_by text,
    created_at ${big} not null,
    resolved_at ${big}
  );

  create table if not exists reviews (
    id text primary key,
    order_id text unique not null references orders(id),
    buyer_id text not null,
    seller_id text not null,
    product_id text not null,
    rating integer not null,
    comment text,
    seller_reply text,
    created_at ${big} not null
  );
  create index if not exists idx_reviews_seller on reviews(seller_id, created_at);
  create index if not exists idx_reviews_product on reviews(product_id, created_at);

  create table if not exists notifications (
    id text primary key,
    user_id text not null,
    type text not null,
    title text not null,
    body text,
    link text,
    read_at ${big},
    created_at ${big} not null
  );
  create index if not exists idx_notif_user on notifications(user_id, created_at);

  create table if not exists audit_logs (
    id ${pk},
    actor_id text,
    action text not null,
    entity text,
    entity_id text,
    meta text,
    created_at ${big} not null
  );

  create table if not exists site_settings (
    id integer primary key check (id = 1),
    default_commission_pct ${real} not null default 8,
    withdrawal_fee_cents ${big} not null default 100,
    min_withdrawal_cents ${big} not null default 1000,
    auto_confirm_hours integer not null default 48,
    payment_window_minutes integer not null default 30,
    maintenance_mode integer not null default 0
  );
  insert into site_settings (id) values (1) on conflict (id) do nothing;

  create table if not exists favorites (
    user_id text not null references users(id),
    product_id text not null references products(id),
    created_at ${big} not null,
    primary key (user_id, product_id)
  );

  create index if not exists idx_products_status on products(status, sold_count);
  create index if not exists idx_products_seller on products(seller_id, status);
  create index if not exists idx_deposits_order on deposits(order_id);
  create index if not exists idx_conv_order on conversations(order_id);
  create index if not exists idx_disputes_status on disputes(status);
  create index if not exists idx_withdrawals_status on withdrawals(status, created_at);

  create table if not exists catalog_items (
    id text primary key,
    name text not null,
    slug text unique not null,
    is_active integer not null default 1,
    sort integer not null default 0,
    created_at ${big} not null
  );

  -- allowed sub-categories per item (no rows = all categories allowed)
  create table if not exists catalog_item_categories (
    item_id text not null references catalog_items(id),
    category_id text not null references categories(id),
    primary key (item_id, category_id)
  );

  create table if not exists item_suggestions (
    id text primary key,
    user_id text not null references users(id),
    name text not null,
    note text,
    status text not null default 'pending',
    admin_note text,
    reviewed_by text,
    created_at ${big} not null,
    reviewed_at ${big}
  );

  create table if not exists product_variants (
    id text primary key,
    product_id text not null references products(id),
    title text not null,
    price_cents ${big} not null,
    sort integer not null default 0
  );
  create index if not exists idx_variants_product on product_variants(product_id);

  create table if not exists coupons (
    id text primary key,
    code text unique not null,
    pct_off ${real} not null,
    min_total_cents ${big} not null default 0,
    max_uses integer not null default 0,
    used_count integer not null default 0,
    expires_at ${big},
    is_active integer not null default 1,
    created_at ${big} not null
  );
  `;
}

async function migrate(e: Engine): Promise<void> {
  const dialect = isPostgres() ? "postgres" : "sqlite";
  if (dialect === "postgres") {
    // strip line comments first (a ";" inside a comment would corrupt the split)
    const cleaned = schemaSql("postgres")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    // run statements one by one so partial application is idempotent
    for (const stmt of cleaned.split(";")) {
      const s = stmt.trim();
      if (s) await e.exec(s);
    }
  } else {
    await e.exec(schemaSql("sqlite"));
  }
  // additive columns for databases created before these features existed
  const big = dialect === "postgres" ? "bigint" : "integer";
  const real = dialect === "postgres" ? "double precision" : "real";
  const addColumns = [
    `alter table orders add column discount_cents ${big} not null default 0`,
    `alter table orders add column coupon_code text`,
    `alter table site_settings add column announcement text`,
    `alter table products add column item_id text`,
    `alter table products add column expires_at ${big}`,
    `alter table products add column insurance_days integer not null default 0`,
    `alter table orders add column variant_title text`,
    // --- Seller trust system ---
    `alter table users add column verification_tier text not null default 'unverified'`,
    `alter table users add column trust_score ${real} not null default 0`,
    `alter table users add column refund_count integer not null default 0`,
    `alter table users add column dispute_count integer not null default 0`,
    `alter table users add column avg_delivery_minutes integer not null default 0`,
    // --- Phase 3: explicit escrow state machine ---
    `alter table orders add column escrow_status text not null default 'none'`,
    `alter table orders add column escrow_hold_reason text`,
    `alter table orders add column escrow_hold_by text`,
    `alter table orders add column escrow_hold_at ${big}`,
    // --- Phase 5: dispute evidence vault & thread ---
    `alter table disputes add column priority text not null default 'normal'`,
    `alter table disputes add column staff_owner text`,
    `alter table disputes add column last_activity_at ${big} not null default 0`,
  ];
  for (const stmt of addColumns) {
    await e.exec(stmt).catch(() => {}); // already exists
  }
  await e
    .exec(
      `create table if not exists dispute_evidence (
        id text primary key,
        dispute_id text not null,
        author_id text not null,
        author_role text not null,
        kind text not null,
        title text not null,
        body text,
        url text,
        created_at ${big} not null
      )`,
    )
    .catch(() => {});
  await e
    .exec(
      `create index if not exists idx_dispute_evidence on dispute_evidence(dispute_id, created_at)`,
    )
    .catch(() => {});
  await e
    .exec(
      `create table if not exists dispute_messages (
        id text primary key,
        dispute_id text not null,
        author_id text not null,
        author_role text not null,
        body text not null,
        is_internal integer not null default 0,
        created_at ${big} not null
      )`,
    )
    .catch(() => {});
  await e
    .exec(
      `create index if not exists idx_dispute_messages on dispute_messages(dispute_id, created_at)`,
    )
    .catch(() => {});
  const tail: string[] = [

  await e
    .exec(
      `create table if not exists seller_verifications (
        id text primary key,
        user_id text not null references users(id),
        tier_requested text not null,
        legal_name text not null,
        country text not null,
        business_name text,
        business_registration text,
        id_doc_ref text,
        notes text,
        status text not null default 'pending',
        reviewed_by text,
        admin_note text,
        created_at ${big} not null,
        reviewed_at ${big}
      )`,
    )
    .catch(() => {});
}
