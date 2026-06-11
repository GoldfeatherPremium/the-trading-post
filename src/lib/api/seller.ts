import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "../server/db.server";
import { appContext } from "../server/app.server";
import {
  audit,
  encryptStock,
  fail,
  getSettings,
  now,
  sha256,
  slugify,
  uid,
} from "../server/core.server";
import { requireSeller, requireUser } from "../server/auth.server";
import { getWallet, txWithdrawalHold } from "../server/money.server";

type Row = Record<string, string | number | null>;

// ---------------------------------------------------------------------------
// Seller application
// ---------------------------------------------------------------------------
export const applyForSeller = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      fullName: z.string().min(2).max(100),
      country: z.string().min(2).max(60),
      experience: z.string().min(10).max(2000),
      usdtPayoutAddress: z.string().min(20).max(120),
      usdtNetwork: z.enum(["TRC20", "BEP20", "ERC20"]),
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const user = requireUser();
    const d = db();
    if (user.seller_status === "approved") fail("You are already an approved seller.");
    if (user.seller_status === "pending") fail("Your application is already under review.");
    d.prepare(
      `insert into seller_applications (id, user_id, full_name, country, experience, usdt_payout_address, usdt_network, created_at)
       values (?,?,?,?,?,?,?,?)`,
    ).run(
      uid(),
      user.id,
      data.fullName,
      data.country,
      data.experience,
      data.usdtPayoutAddress,
      data.usdtNetwork,
      now(),
    );
    d.prepare(`update users set seller_status = 'pending' where id = ?`).run(user.id);
    audit(user.id, "seller.apply", "user", user.id);
    return { ok: true };
  });

export const getMyApplication = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  const user = requireUser();
  const app = db()
    .prepare(`select * from seller_applications where user_id = ? order by created_at desc limit 1`)
    .get(user.id) as
    | {
        status: string;
        admin_note: string | null;
        usdt_payout_address: string;
        usdt_network: string;
        created_at: number;
      }
    | undefined;
  return { application: app ?? null, sellerStatus: user.seller_status };
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
const productInput = z.object({
  categoryId: z.string(),
  title: z.string().min(8).max(120),
  description: z.string().min(30).max(5000),
  imageKey: z.string().max(40).optional(),
  deliveryType: z.enum(["auto", "manual"]),
  deliverySlaMinutes: z.number().int().min(5).max(14_400),
  warrantyHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .nullable(),
  priceUsdt: z.number().min(0.5).max(100_000),
  minQty: z.number().int().min(1).max(1000),
  maxQty: z.number().int().min(1).max(1000),
  region: z.string().max(40).optional(),
  platform: z.string().max(40).optional(),
  requiredInfo: z.string().max(500).optional(),
});

const MAX_ACTIVE_LISTINGS: Record<number, number> = { 1: 10, 2: 25, 3: 60, 4: 150, 5: 100_000 };

export const saveProduct = createServerFn({ method: "POST" })
  .inputValidator(productInput.extend({ productId: z.string().optional() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireSeller();
    const d = db();
    if (data.minQty > data.maxQty) fail("Min quantity can't exceed max quantity.");
    const cat = d
      .prepare(`select id from categories where id = ? and is_active = 1`)
      .get(data.categoryId);
    if (!cat) fail("Invalid category.");

    if (data.productId) {
      const p = d
        .prepare(`select seller_id, delivery_type from products where id = ?`)
        .get(data.productId) as { seller_id: string; delivery_type: string } | undefined;
      if (!p || p.seller_id !== user.id) fail("Product not found.");
      // edits go back through review
      d.prepare(
        `update products set category_id = ?, title = ?, description = ?, image_key = ?, delivery_sla_minutes = ?,
           warranty_hours = ?, price_cents = ?, min_qty = ?, max_qty = ?, region = ?, platform = ?, required_info = ?,
           status = 'pending_review', reject_reason = null
         where id = ?`,
      ).run(
        data.categoryId,
        data.title,
        data.description,
        data.imageKey ?? null,
        data.deliverySlaMinutes,
        data.warrantyHours,
        Math.round(data.priceUsdt * 100),
        data.minQty,
        data.maxQty,
        data.region ?? null,
        data.platform ?? null,
        data.requiredInfo ?? null,
        data.productId,
      );
      audit(user.id, "product.update", "product", data.productId);
      return { productId: data.productId };
    }

    const activeCount = (
      d
        .prepare(
          `select count(*) c from products where seller_id = ? and status in ('active','pending_review','out_of_stock')`,
        )
        .get(user.id) as { c: number }
    ).c;
    const cap = MAX_ACTIVE_LISTINGS[user.seller_level] ?? 10;
    if (activeCount >= cap)
      fail(`Seller level ${user.seller_level} allows at most ${cap} listings.`);

    const id = uid();
    d.prepare(
      `insert into products (id, seller_id, category_id, title, slug, description, image_key, delivery_type,
         delivery_sla_minutes, warranty_hours, price_cents, min_qty, max_qty, region, platform, required_info,
         status, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending_review', ?)`,
    ).run(
      id,
      user.id,
      data.categoryId,
      data.title,
      slugify(data.title),
      data.description,
      data.imageKey ?? null,
      data.deliveryType,
      data.deliverySlaMinutes,
      data.warrantyHours,
      Math.round(data.priceUsdt * 100),
      data.minQty,
      data.maxQty,
      data.region ?? null,
      data.platform ?? null,
      data.requiredInfo ?? null,
      now(),
    );
    audit(user.id, "product.create", "product", id);
    return { productId: id };
  });

export const listMyProducts = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  const user = requireSeller();
  const products = db()
    .prepare(
      `select p.*, c.name as category_name from products p join categories c on c.id = p.category_id
       where p.seller_id = ? order by p.created_at desc`,
    )
    .all(user.id) as Array<Row>;
  return { products };
});

export const setProductPaused = createServerFn({ method: "POST" })
  .inputValidator(z.object({ productId: z.string(), paused: z.boolean() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireSeller();
    const d = db();
    const p = d
      .prepare(`select seller_id, status, stock_count, delivery_type from products where id = ?`)
      .get(data.productId) as
      | { seller_id: string; status: string; stock_count: number; delivery_type: string }
      | undefined;
    if (!p || p.seller_id !== user.id) fail("Product not found.");
    if (data.paused) {
      if (p!.status !== "active" && p!.status !== "out_of_stock")
        fail("Only live products can be paused.");
      d.prepare(`update products set status = 'paused' where id = ?`).run(data.productId);
    } else {
      if (p!.status !== "paused") fail("Product is not paused.");
      const next = p!.delivery_type === "auto" && p!.stock_count === 0 ? "out_of_stock" : "active";
      d.prepare(`update products set status = ? where id = ?`).run(next, data.productId);
    }
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Stock manager (auto-delivery codes)
// ---------------------------------------------------------------------------
export const getProductStock = createServerFn({ method: "GET" })
  .inputValidator(z.object({ productId: z.string() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireSeller();
    const d = db();
    const p = d
      .prepare(`select id, seller_id, title, delivery_type, stock_count from products where id = ?`)
      .get(data.productId) as
      | { id: string; seller_id: string; title: string; delivery_type: string; stock_count: number }
      | undefined;
    if (!p || p.seller_id !== user.id) fail("Product not found.");
    const counts = d
      .prepare(`select status, count(*) c from stock_items where product_id = ? group by status`)
      .all(data.productId) as Array<{ status: string; c: number }>;
    // codes themselves are never returned — encrypted at rest, revealed only to buyers on delivery
    const items = d
      .prepare(
        `select id, status, created_at, delivered_at from stock_items where product_id = ? order by created_at desc limit 500`,
      )
      .all(data.productId) as Array<{
      id: string;
      status: string;
      created_at: number;
      delivered_at: number | null;
    }>;
    return { product: p!, counts, items };
  });

export const uploadStock = createServerFn({ method: "POST" })
  .inputValidator(z.object({ productId: z.string(), codes: z.string().min(1).max(200_000) }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireSeller();
    const d = db();
    const p = d
      .prepare(`select id, seller_id, delivery_type from products where id = ?`)
      .get(data.productId) as { id: string; seller_id: string; delivery_type: string } | undefined;
    if (!p || p.seller_id !== user.id) fail("Product not found.");
    if (p!.delivery_type !== "auto") fail("Stock codes only apply to auto-delivery products.");

    const rawLines = data.codes
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const lines = [...new Set(rawLines)];
    const inPayloadDuplicates = rawLines.length - lines.length;
    if (lines.length === 0) fail("No codes found.");
    if (lines.length > 5000) fail("Max 5000 codes per upload.");

    // duplicate detection across this seller's entire inventory
    const existing = new Set(
      (
        d
          .prepare(
            `select s.content_hash from stock_items s join products pp on pp.id = s.product_id
           where pp.seller_id = ? and s.status in ('available','reserved','delivered')`,
          )
          .all(user.id) as Array<{ content_hash: string }>
      ).map((r) => r.content_hash),
    );
    let added = 0;
    let duplicates = inPayloadDuplicates;
    d.transaction(() => {
      for (const code of lines) {
        const hash = sha256(code);
        if (existing.has(hash)) {
          duplicates++;
          continue;
        }
        existing.add(hash);
        d.prepare(
          `insert into stock_items (id, product_id, content_encrypted, content_hash, created_at) values (?,?,?,?,?)`,
        ).run(uid(), data.productId, encryptStock(code), hash, now());
        added++;
      }
      d.prepare(
        `update products set stock_count = (select count(*) from stock_items where product_id = ? and status = 'available'),
           status = case when status = 'out_of_stock' then 'active' else status end
         where id = ?`,
      ).run(data.productId, data.productId);
    })();
    audit(user.id, "stock.upload", "product", data.productId, { added, duplicates });
    return { added, duplicates };
  });

export const removeStockItem = createServerFn({ method: "POST" })
  .inputValidator(z.object({ stockItemId: z.string() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireSeller();
    const d = db();
    const s = d
      .prepare(
        `select s.id, s.status, s.product_id, p.seller_id from stock_items s join products p on p.id = s.product_id where s.id = ?`,
      )
      .get(data.stockItemId) as
      | { id: string; status: string; product_id: string; seller_id: string }
      | undefined;
    if (!s || s.seller_id !== user.id) fail("Stock item not found.");
    if (s!.status !== "available") fail("Only unsold codes can be removed.");
    d.prepare(`update stock_items set status = 'invalid' where id = ?`).run(data.stockItemId);
    d.prepare(
      `update products set stock_count = (select count(*) from stock_items where product_id = ? and status = 'available') where id = ?`,
    ).run(s!.product_id, s!.product_id);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Dashboard overview + wallet
// ---------------------------------------------------------------------------
export const getSellerOverview = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  const user = requireSeller();
  const d = db();
  const t = now();
  const sales = (period: number) =>
    d
      .prepare(
        `select count(*) c, coalesce(sum(seller_net_cents),0) s from orders
         where seller_id = ? and paid_at > ? and status not in ('refunded','cancelled','expired')`,
      )
      .get(user.id, t - period) as { c: number; s: number };
  const wallet = getWallet(user.id);
  const needsDelivery = (
    d
      .prepare(
        `select count(*) c from orders where seller_id = ? and status in ('paid','delivering')`,
      )
      .get(user.id) as { c: number }
  ).c;
  const openDisputes = (
    d
      .prepare(
        `select count(*) c from disputes dd join orders o on o.id = dd.order_id where o.seller_id = ? and dd.status != 'resolved'`,
      )
      .get(user.id) as { c: number }
  ).c;
  const lowStock = d
    .prepare(
      `select id, title, stock_count from products where seller_id = ? and delivery_type = 'auto'
       and status in ('active','out_of_stock') and stock_count <= 5 order by stock_count`,
    )
    .all(user.id) as Array<{ id: string; title: string; stock_count: number }>;
  return {
    today: sales(86_400_000),
    week: sales(7 * 86_400_000),
    month: sales(30 * 86_400_000),
    wallet,
    needsDelivery,
    openDisputes,
    lowStock,
    profile: {
      level: user.seller_level,
      rating: user.rating,
      ratingCount: user.rating_count,
      totalSales: user.total_sales,
      completionRate: user.completion_rate,
    },
  };
});

export const getWalletData = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  const user = requireUser();
  const wallet = getWallet(user.id);
  const ledger = db()
    .prepare(`select * from wallet_ledger where user_id = ? order by id desc limit 200`)
    .all(user.id) as Array<{
    id: number;
    order_id: string | null;
    type: string;
    amount_cents: number;
    balance_after_cents: number;
    note: string | null;
    created_at: number;
  }>;
  const withdrawals = db()
    .prepare(`select * from withdrawals where user_id = ? order by created_at desc limit 50`)
    .all(user.id) as Array<{
    id: string;
    amount_cents: number;
    fee_cents: number;
    address: string;
    network: string;
    status: string;
    tx_hash: string | null;
    created_at: number;
  }>;
  const settings = getSettings();
  const app = db()
    .prepare(
      `select usdt_payout_address, usdt_network from seller_applications where user_id = ? and status = 'approved' order by created_at desc limit 1`,
    )
    .get(user.id) as { usdt_payout_address: string; usdt_network: string } | undefined;
  return {
    wallet,
    ledger,
    withdrawals,
    fees: {
      withdrawalFeeCents: settings.withdrawal_fee_cents,
      minWithdrawalCents: settings.min_withdrawal_cents,
    },
    payoutDefaults: app ?? null,
    walletFrozen: !!user.wallet_frozen,
  };
});

const WEEKLY_WITHDRAWAL_CAP_CENTS: Record<number, number> = {
  1: 50_000,
  2: 200_000,
  3: 1_000_000,
  4: 5_000_000,
  5: Number.MAX_SAFE_INTEGER,
};

export const requestWithdrawal = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      amountUsdt: z.number().min(1),
      address: z.string().min(20).max(120),
      network: z.enum(["TRC20", "BEP20", "ERC20"]),
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const user = requireUser();
    if (user.wallet_frozen) fail("Your wallet is frozen. Contact support.");
    const d = db();
    const settings = getSettings();
    const amountCents = Math.round(data.amountUsdt * 100);
    if (amountCents < settings.min_withdrawal_cents)
      fail(`Minimum withdrawal is ${(settings.min_withdrawal_cents / 100).toFixed(2)} USDT.`);
    const weekly = (
      d
        .prepare(
          `select coalesce(sum(amount_cents),0) s from withdrawals where user_id = ? and created_at > ? and status != 'rejected'`,
        )
        .get(user.id, now() - 7 * 86_400_000) as { s: number }
    ).s;
    const cap = WEEKLY_WITHDRAWAL_CAP_CENTS[user.seller_level] ?? WEEKLY_WITHDRAWAL_CAP_CENTS[1];
    if (weekly + amountCents > cap)
      fail(
        `Seller level ${user.seller_level} weekly withdrawal cap is ${(cap / 100).toFixed(0)} USDT.`,
      );
    const id = uid();
    txWithdrawalHold(user.id, amountCents, settings.withdrawal_fee_cents, id);
    d.prepare(
      `insert into withdrawals (id, user_id, amount_cents, fee_cents, address, network, created_at) values (?,?,?,?,?,?,?)`,
    ).run(
      id,
      user.id,
      amountCents,
      settings.withdrawal_fee_cents,
      data.address,
      data.network,
      now(),
    );
    audit(user.id, "withdrawal.request", "withdrawal", id, { amountCents });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Reviews (seller reply)
// ---------------------------------------------------------------------------
export const listSellerReviews = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  const user = requireSeller();
  const reviews = db()
    .prepare(
      `select r.id, r.rating, r.comment, r.seller_reply, r.created_at, u.username as buyer, o.product_title, o.order_no
       from reviews r join users u on u.id = r.buyer_id join orders o on o.id = r.order_id
       where r.seller_id = ? order by r.created_at desc limit 100`,
    )
    .all(user.id) as Array<{
    id: string;
    rating: number;
    comment: string | null;
    seller_reply: string | null;
    created_at: number;
    buyer: string;
    product_title: string;
    order_no: string;
  }>;
  return { reviews };
});

export const replyToReview = createServerFn({ method: "POST" })
  .inputValidator(z.object({ reviewId: z.string(), reply: z.string().min(2).max(1000) }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireSeller();
    const d = db();
    const r = d.prepare(`select seller_id from reviews where id = ?`).get(data.reviewId) as
      | { seller_id: string }
      | undefined;
    if (!r || r.seller_id !== user.id) fail("Review not found.");
    d.prepare(`update reviews set seller_reply = ? where id = ?`).run(data.reply, data.reviewId);
    return { ok: true };
  });
