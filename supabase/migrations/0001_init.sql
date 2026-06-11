-- X-VAULT marketplace schema.
-- The app applies this automatically on first boot when DATABASE_URL is set,
-- so running it manually in the Supabase SQL editor is optional.


create table if not exists users (
  id text primary key,
  email text unique not null,
  username text unique not null,
  password_hash text not null,
  role text not null default 'buyer',
  seller_status text not null default 'none',
  seller_level integer not null default 1,
  rating double precision not null default 0,
  rating_count integer not null default 0,
  total_sales integer not null default 0,
  completion_rate double precision not null default 100,
  is_banned integer not null default 0,
  wallet_frozen integer not null default 0,
  vacation_mode integer not null default 0,
  created_at bigint not null
);

create table if not exists sessions (
  token text primary key,
  user_id text not null references users(id),
  expires_at bigint not null,
  created_at bigint not null
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
  created_at bigint not null,
  reviewed_at bigint
);

create table if not exists categories (
  id text primary key,
  name text not null,
  slug text unique not null,
  icon text,
  sort integer not null default 0,
  default_warranty_hours integer not null default 72,
  commission_pct double precision not null default 8,
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
  price_cents bigint not null,
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
  created_at bigint not null
);

create table if not exists stock_items (
  id text primary key,
  product_id text not null references products(id),
  content_encrypted text not null,
  content_hash text not null,
  status text not null default 'available',
  order_id text,
  delivered_at bigint,
  created_at bigint not null
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
  unit_price_cents bigint not null,
  total_cents bigint not null,
  commission_pct double precision not null,
  commission_cents bigint not null,
  seller_net_cents bigint not null,
  status text not null default 'awaiting_payment',
  delivery_type text not null,
  delivery_sla_minutes integer not null default 60,
  warranty_hours integer not null,
  buyer_info text,
  cancel_reason text,
  paid_at bigint,
  delivered_at bigint,
  completed_at bigint,
  warranty_ends_at bigint,
  released_at bigint,
  auto_confirm_at bigint,
  expires_at bigint,
  created_at bigint not null
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
  created_at bigint not null
);

create table if not exists deposits (
  id text primary key,
  order_id text references orders(id),
  user_id text not null references users(id),
  amount_cents bigint not null,
  network text not null,
  pay_address text not null,
  tx_hash text,
  confirmations integer not null default 0,
  status text not null default 'pending',
  expires_at bigint,
  created_at bigint not null
);

create table if not exists wallets (
  user_id text primary key references users(id),
  available_cents bigint not null default 0,
  pending_cents bigint not null default 0,
  frozen_cents bigint not null default 0
);

create table if not exists wallet_ledger (
  id bigint generated always as identity primary key,
  user_id text not null,
  order_id text,
  type text not null,
  amount_cents bigint not null,
  balance_after_cents bigint not null,
  note text,
  created_at bigint not null
);
create index if not exists idx_ledger_user on wallet_ledger(user_id, created_at);

create table if not exists withdrawals (
  id text primary key,
  user_id text not null references users(id),
  amount_cents bigint not null,
  fee_cents bigint not null,
  address text not null,
  network text not null,
  status text not null default 'pending',
  tx_hash text,
  reviewed_by text,
  created_at bigint not null,
  reviewed_at bigint
);

create table if not exists conversations (
  id text primary key,
  order_id text references orders(id),
  product_id text references products(id),
  buyer_id text not null references users(id),
  seller_id text not null references users(id),
  buyer_last_read_at bigint not null default 0,
  seller_last_read_at bigint not null default 0,
  last_message_at bigint,
  created_at bigint not null
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
  moderated_at bigint,
  moderated_by text,
  created_at bigint not null
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
  resolution_cents bigint,
  resolved_by text,
  created_at bigint not null,
  resolved_at bigint
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
  created_at bigint not null
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
  read_at bigint,
  created_at bigint not null
);
create index if not exists idx_notif_user on notifications(user_id, created_at);

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  actor_id text,
  action text not null,
  entity text,
  entity_id text,
  meta text,
  created_at bigint not null
);

create table if not exists site_settings (
  id integer primary key check (id = 1),
  default_commission_pct double precision not null default 8,
  withdrawal_fee_cents bigint not null default 100,
  min_withdrawal_cents bigint not null default 1000,
  auto_confirm_hours integer not null default 48,
  payment_window_minutes integer not null default 30,
  maintenance_mode integer not null default 0
);
insert into site_settings (id) values (1) on conflict (id) do nothing;

create table if not exists favorites (
  user_id text not null references users(id),
  product_id text not null references products(id),
  created_at bigint not null,
  primary key (user_id, product_id)
);

create index if not exists idx_products_status on products(status, sold_count);
create index if not exists idx_products_seller on products(seller_id, status);
create index if not exists idx_deposits_order on deposits(order_id);
create index if not exists idx_conv_order on conversations(order_id);
create index if not exists idx_disputes_status on disputes(status);
create index if not exists idx_withdrawals_status on withdrawals(status, created_at);

create table if not exists coupons (
  id text primary key,
  code text unique not null,
  pct_off double precision not null,
  min_total_cents bigint not null default 0,
  max_uses integer not null default 0,
  used_count integer not null default 0,
  expires_at bigint,
  is_active integer not null default 1,
  created_at bigint not null
);

-- additive columns applied by the app on boot
alter table orders add column if not exists discount_cents bigint not null default 0;
alter table orders add column if not exists coupon_code text;
alter table site_settings add column if not exists announcement text;
