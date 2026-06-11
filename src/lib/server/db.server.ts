import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "marketplace.db");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(d: Database.Database) {
  d.exec(`
  create table if not exists users (
    id text primary key,
    email text unique not null,
    username text unique not null,
    password_hash text not null,
    role text not null default 'buyer',            -- buyer/seller/support/finance/admin
    seller_status text not null default 'none',    -- none/pending/approved/suspended/rejected
    seller_level integer not null default 1,
    rating real not null default 0,
    rating_count integer not null default 0,
    total_sales integer not null default 0,
    completion_rate real not null default 100,
    is_banned integer not null default 0,
    wallet_frozen integer not null default 0,
    vacation_mode integer not null default 0,
    created_at integer not null
  );

  create table if not exists sessions (
    token text primary key,
    user_id text not null references users(id),
    expires_at integer not null,
    created_at integer not null
  );

  create table if not exists seller_applications (
    id text primary key,
    user_id text not null references users(id),
    full_name text not null,
    country text not null,
    experience text not null,
    usdt_payout_address text not null,
    usdt_network text not null,
    status text not null default 'pending',        -- pending/approved/rejected
    admin_note text,
    reviewed_by text,
    created_at integer not null,
    reviewed_at integer
  );

  create table if not exists categories (
    id text primary key,
    name text not null,
    slug text unique not null,
    icon text,
    sort integer not null default 0,
    default_warranty_hours integer not null default 72,
    commission_pct real not null default 8,
    risk_tier text not null default 'normal',      -- normal/high
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
    delivery_type text not null,                   -- auto/manual
    delivery_sla_minutes integer not null default 60,
    warranty_hours integer,                        -- null = category default
    price_cents integer not null,
    min_qty integer not null default 1,
    max_qty integer not null default 100,
    stock_count integer not null default 0,
    status text not null default 'pending_review', -- draft/pending_review/active/rejected/paused/out_of_stock
    reject_reason text,
    region text,
    platform text,
    required_info text,                            -- what buyer must provide at checkout (manual)
    views integer not null default 0,
    sold_count integer not null default 0,
    created_at integer not null
  );

  create table if not exists stock_items (
    id text primary key,
    product_id text not null references products(id),
    content_encrypted text not null,
    content_hash text not null,
    status text not null default 'available',      -- available/reserved/delivered/invalid
    order_id text,
    delivered_at integer,
    created_at integer not null
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
    unit_price_cents integer not null,
    total_cents integer not null,
    commission_pct real not null,
    commission_cents integer not null,
    seller_net_cents integer not null,
    status text not null default 'awaiting_payment',
    delivery_type text not null,
    delivery_sla_minutes integer not null default 60,
    warranty_hours integer not null,
    buyer_info text,
    cancel_reason text,
    paid_at integer,
    delivered_at integer,
    completed_at integer,
    warranty_ends_at integer,
    released_at integer,
    auto_confirm_at integer,
    expires_at integer,
    created_at integer not null
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
    created_at integer not null
  );

  create table if not exists deposits (
    id text primary key,
    order_id text references orders(id),
    user_id text not null references users(id),
    amount_cents integer not null,
    network text not null,
    pay_address text not null,
    tx_hash text,
    confirmations integer not null default 0,
    status text not null default 'pending',        -- pending/confirming/confirmed/expired/failed
    expires_at integer,
    created_at integer not null
  );

  create table if not exists wallets (
    user_id text primary key references users(id),
    available_cents integer not null default 0,
    pending_cents integer not null default 0,
    frozen_cents integer not null default 0
  );

  create table if not exists wallet_ledger (
    id integer primary key autoincrement,
    user_id text not null,
    order_id text,
    type text not null,  -- escrow_hold/escrow_release/commission/refund/withdrawal/withdrawal_reversal/adjustment
    amount_cents integer not null,
    balance_after_cents integer not null,
    note text,
    created_at integer not null
  );
  create index if not exists idx_ledger_user on wallet_ledger(user_id, created_at);

  create table if not exists withdrawals (
    id text primary key,
    user_id text not null references users(id),
    amount_cents integer not null,
    fee_cents integer not null,
    address text not null,
    network text not null,
    status text not null default 'pending',        -- pending/approved/sent/rejected
    tx_hash text,
    reviewed_by text,
    created_at integer not null,
    reviewed_at integer
  );

  create table if not exists conversations (
    id text primary key,
    order_id text references orders(id),
    product_id text references products(id),
    buyer_id text not null references users(id),
    seller_id text not null references users(id),
    buyer_last_read_at integer not null default 0,
    seller_last_read_at integer not null default 0,
    last_message_at integer,
    created_at integer not null
  );
  create index if not exists idx_conv_buyer on conversations(buyer_id);
  create index if not exists idx_conv_seller on conversations(seller_id);

  create table if not exists messages (
    id text primary key,
    conversation_id text not null references conversations(id),
    sender_id text,                                -- null = system message
    body text not null,
    is_system integer not null default 0,
    is_flagged integer not null default 0,
    flag_reason text,
    moderated_at integer,
    moderated_by text,
    created_at integer not null
  );
  create index if not exists idx_msg_conv on messages(conversation_id, created_at);

  create table if not exists disputes (
    id text primary key,
    order_id text unique not null references orders(id),
    opened_by text not null,
    reason text not null,                          -- not_delivered/invalid_code/not_as_described/stopped_working/other
    description text,
    seller_response text,
    status text not null default 'open',           -- open/seller_responded/resolved
    resolution text,                               -- refund_full/refund_partial/release_seller
    resolution_cents integer,
    resolved_by text,
    created_at integer not null,
    resolved_at integer
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
    created_at integer not null
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
    read_at integer,
    created_at integer not null
  );
  create index if not exists idx_notif_user on notifications(user_id, created_at);

  create table if not exists audit_logs (
    id integer primary key autoincrement,
    actor_id text,
    action text not null,
    entity text,
    entity_id text,
    meta text,
    created_at integer not null
  );

  create table if not exists site_settings (
    id integer primary key check (id = 1),
    default_commission_pct real not null default 8,
    withdrawal_fee_cents integer not null default 100,
    min_withdrawal_cents integer not null default 1000,
    auto_confirm_hours integer not null default 48,
    payment_window_minutes integer not null default 30,
    maintenance_mode integer not null default 0
  );
  insert or ignore into site_settings (id) values (1);
  `);
}

export function resetDbForTests() {
  _db?.close();
  _db = null;
}
