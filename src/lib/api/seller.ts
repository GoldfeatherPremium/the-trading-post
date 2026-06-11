import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run, tx } from "../server/db.server";
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
    await appContext();
    const user = await requireUser();
    if (user.seller_status === "approved") fail("You are already an approved seller.");
    if (user.seller_status === "pending") fail("Your application is already under review.");
    await run(
      `insert into seller_applications (id, user_id, full_name, country, experience, usdt_payout_address, usdt_network, created_at)
       values (?,?,?,?,?,?,?,?)`,
      [
        uid(),
        user.id,
        data.fullName,
        data.country,
        data.experience,
        data.usdtPayoutAddress,
        data.usdtNetwork,
        now(),
      ],
    );
    await run(`update users set seller_status = 'pending' where id = ?`, [user.id]);
    await audit(user.id, "seller.apply", "user", user.id);
    return { ok: true };
  });

export const getMyApplication = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireUser();
  const app = await q1<{
    status: string;
    admin_note: string | null;
    usdt_payout_address: string;
    usdt_network: string;
    created_at: number;
  }>(`select * from seller_applications where user_id = ? order by created_at desc limit 1`, [
    user.id,
  ]);
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
    await appContext();
    const user = await requireSeller();
    if (data.minQty > data.maxQty) fail("Min quantity can't exceed max quantity.");
    const cat = await q1(`select id from categories where id = ? and is_active = 1`, [
      data.categoryId,
    ]);
    if (!cat) fail("Invalid category.");

    if (data.productId) {
      const p = await q1<{ seller_id: string; delivery_type: string }>(
        `select seller_id, delivery_type from products where id = ?`,
        [data.productId],
      );
      if (!p || p.seller_id !== user.id) fail("Product not found.");
      // edits go back through review
      await run(
        `update products set category_id = ?, title = ?, description = ?, image_key = ?, delivery_sla_minutes = ?,
           warranty_hours = ?, price_cents = ?, min_qty = ?, max_qty = ?, region = ?, platform = ?, required_info = ?,
           status = 'pending_review', reject_reason = null
         where id = ?`,
        [
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
        ],
      );
      await audit(user.id, "product.update", "product", data.productId);
      return { productId: data.productId };
    }

    const activeCount = (await q1<{ c: number }>(
      `select count(*) c from products where seller_id = ? and status in ('active','pending_review','out_of_stock')`,
      [user.id],
    ))!.c;
    const cap = MAX_ACTIVE_LISTINGS[user.seller_level] ?? 10;
    if (activeCount >= cap)
      fail(`Seller level ${user.seller_level} allows at most ${cap} listings.`);

    const id = uid();
    await run(
      `insert into products (id, seller_id, category_id, title, slug, description, image_key, delivery_type,
         delivery_sla_minutes, warranty_hours, price_cents, min_qty, max_qty, region, platform, required_info,
         status, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending_review', ?)`,
      [
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
      ],
    );
    await audit(user.id, "product.create", "product", id);
    return { productId: id };
  });

export const listMyProducts = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireSeller();
  const products = await q<Row>(
    `select p.*, c.name as category_name from products p join categories c on c.id = p.category_id
     where p.seller_id = ? order by p.created_at desc`,
    [user.id],
  );
  return { products };
});

export const setProductPaused = createServerFn({ method: "POST" })
  .inputValidator(z.object({ productId: z.string(), paused: z.boolean() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const p = await q1<{
      seller_id: string;
      status: string;
      stock_count: number;
      delivery_type: string;
    }>(`select seller_id, status, stock_count, delivery_type from products where id = ?`, [
      data.productId,
    ]);
    if (!p || p.seller_id !== user.id) fail("Product not found.");
    if (data.paused) {
      if (p!.status !== "active" && p!.status !== "out_of_stock")
        fail("Only live products can be paused.");
      await run(`update products set status = 'paused' where id = ?`, [data.productId]);
    } else {
      if (p!.status !== "paused") fail("Product is not paused.");
      const next = p!.delivery_type === "auto" && p!.stock_count === 0 ? "out_of_stock" : "active";
      await run(`update products set status = ? where id = ?`, [next, data.productId]);
    }
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Stock manager (auto-delivery codes)
// ---------------------------------------------------------------------------
export const getProductStock = createServerFn({ method: "GET" })
  .inputValidator(z.object({ productId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const p = await q1<{
      id: string;
      seller_id: string;
      title: string;
      delivery_type: string;
      stock_count: number;
    }>(`select id, seller_id, title, delivery_type, stock_count from products where id = ?`, [
      data.productId,
    ]);
    if (!p || p.seller_id !== user.id) fail("Product not found.");
    const counts = await q<{ status: string; c: number }>(
      `select status, count(*) c from stock_items where product_id = ? group by status`,
      [data.productId],
    );
    // codes themselves are never returned — encrypted at rest, revealed only to buyers on delivery
    const items = await q<{
      id: string;
      status: string;
      created_at: number;
      delivered_at: number | null;
    }>(
      `select id, status, created_at, delivered_at from stock_items where product_id = ? order by created_at desc limit 500`,
      [data.productId],
    );
    return { product: p!, counts, items };
  });

export const uploadStock = createServerFn({ method: "POST" })
  .inputValidator(z.object({ productId: z.string(), codes: z.string().min(1).max(200_000) }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const p = await q1<{ id: string; seller_id: string; delivery_type: string }>(
      `select id, seller_id, delivery_type from products where id = ?`,
      [data.productId],
    );
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
        await q<{ content_hash: string }>(
          `select s.content_hash from stock_items s join products pp on pp.id = s.product_id
           where pp.seller_id = ? and s.status in ('available','reserved','delivered')`,
          [user.id],
        )
      ).map((r) => r.content_hash),
    );
    let added = 0;
    let duplicates = inPayloadDuplicates;
    await tx(async () => {
      for (const code of lines) {
        const hash = sha256(code);
        if (existing.has(hash)) {
          duplicates++;
          continue;
        }
        existing.add(hash);
        await run(
          `insert into stock_items (id, product_id, content_encrypted, content_hash, created_at) values (?,?,?,?,?)`,
          [uid(), data.productId, encryptStock(code), hash, now()],
        );
        added++;
      }
      await run(
        `update products set stock_count = (select count(*) from stock_items where product_id = ? and status = 'available'),
           status = case when status = 'out_of_stock' then 'active' else status end
         where id = ?`,
        [data.productId, data.productId],
      );
    });
    await audit(user.id, "stock.upload", "product", data.productId, { added, duplicates });
    return { added, duplicates };
  });

export const removeStockItem = createServerFn({ method: "POST" })
  .inputValidator(z.object({ stockItemId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const s = await q1<{ id: string; status: string; product_id: string; seller_id: string }>(
      `select s.id, s.status, s.product_id, p.seller_id from stock_items s join products p on p.id = s.product_id where s.id = ?`,
      [data.stockItemId],
    );
    if (!s || s.seller_id !== user.id) fail("Stock item not found.");
    if (s!.status !== "available") fail("Only unsold codes can be removed.");
    await run(`update stock_items set status = 'invalid' where id = ?`, [data.stockItemId]);
    await run(
      `update products set stock_count = (select count(*) from stock_items where product_id = ? and status = 'available') where id = ?`,
      [s!.product_id, s!.product_id],
    );
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Dashboard overview + wallet
// ---------------------------------------------------------------------------
export const getSellerOverview = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireSeller();
  const t = now();
  const sales = async (period: number) =>
    (await q1<{ c: number; s: number }>(
      `select count(*) c, coalesce(sum(seller_net_cents),0) s from orders
       where seller_id = ? and paid_at > ? and status not in ('refunded','cancelled','expired')`,
      [user.id, t - period],
    ))!;
  const wallet = await getWallet(user.id);
  const needsDelivery = (await q1<{ c: number }>(
    `select count(*) c from orders where seller_id = ? and status in ('paid','delivering')`,
    [user.id],
  ))!.c;
  const openDisputes = (await q1<{ c: number }>(
    `select count(*) c from disputes dd join orders o on o.id = dd.order_id where o.seller_id = ? and dd.status != 'resolved'`,
    [user.id],
  ))!.c;
  const lowStock = await q<{ id: string; title: string; stock_count: number }>(
    `select id, title, stock_count from products where seller_id = ? and delivery_type = 'auto'
     and status in ('active','out_of_stock') and stock_count <= 5 order by stock_count`,
    [user.id],
  );
  return {
    today: await sales(86_400_000),
    week: await sales(7 * 86_400_000),
    month: await sales(30 * 86_400_000),
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
  await appContext();
  const user = await requireUser();
  const wallet = await getWallet(user.id);
  const ledger = await q<{
    id: number;
    order_id: string | null;
    type: string;
    amount_cents: number;
    balance_after_cents: number;
    note: string | null;
    created_at: number;
  }>(`select * from wallet_ledger where user_id = ? order by id desc limit 200`, [user.id]);
  const withdrawals = await q<{
    id: string;
    amount_cents: number;
    fee_cents: number;
    address: string;
    network: string;
    status: string;
    tx_hash: string | null;
    created_at: number;
  }>(`select * from withdrawals where user_id = ? order by created_at desc limit 50`, [user.id]);
  const settings = await getSettings();
  const app = await q1<{ usdt_payout_address: string; usdt_network: string }>(
    `select usdt_payout_address, usdt_network from seller_applications where user_id = ? and status = 'approved' order by created_at desc limit 1`,
    [user.id],
  );
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
    await appContext();
    const user = await requireUser();
    if (user.wallet_frozen) fail("Your wallet is frozen. Contact support.");
    const settings = await getSettings();
    const amountCents = Math.round(data.amountUsdt * 100);
    if (amountCents < settings.min_withdrawal_cents)
      fail(`Minimum withdrawal is ${(settings.min_withdrawal_cents / 100).toFixed(2)} USDT.`);
    const weekly = (await q1<{ s: number }>(
      `select coalesce(sum(amount_cents),0) s from withdrawals where user_id = ? and created_at > ? and status != 'rejected'`,
      [user.id, now() - 7 * 86_400_000],
    ))!.s;
    const cap = WEEKLY_WITHDRAWAL_CAP_CENTS[user.seller_level] ?? WEEKLY_WITHDRAWAL_CAP_CENTS[1];
    if (weekly + amountCents > cap)
      fail(
        `Seller level ${user.seller_level} weekly withdrawal cap is ${(cap / 100).toFixed(0)} USDT.`,
      );
    const id = uid();
    await txWithdrawalHold(user.id, amountCents, settings.withdrawal_fee_cents, id);
    await run(
      `insert into withdrawals (id, user_id, amount_cents, fee_cents, address, network, created_at) values (?,?,?,?,?,?,?)`,
      [id, user.id, amountCents, settings.withdrawal_fee_cents, data.address, data.network, now()],
    );
    await audit(user.id, "withdrawal.request", "withdrawal", id, { amountCents });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Reviews (seller reply)
// ---------------------------------------------------------------------------
export const listSellerReviews = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireSeller();
  const reviews = await q<{
    id: string;
    rating: number;
    comment: string | null;
    seller_reply: string | null;
    created_at: number;
    buyer: string;
    product_title: string;
    order_no: string;
  }>(
    `select r.id, r.rating, r.comment, r.seller_reply, r.created_at, u.username as buyer, o.product_title, o.order_no
     from reviews r join users u on u.id = r.buyer_id join orders o on o.id = r.order_id
     where r.seller_id = ? order by r.created_at desc limit 100`,
    [user.id],
  );
  return { reviews };
});

export const replyToReview = createServerFn({ method: "POST" })
  .inputValidator(z.object({ reviewId: z.string(), reply: z.string().min(2).max(1000) }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const r = await q1<{ seller_id: string }>(`select seller_id from reviews where id = ?`, [
      data.reviewId,
    ]);
    if (!r || r.seller_id !== user.id) fail("Review not found.");
    await run(`update reviews set seller_reply = ? where id = ?`, [data.reply, data.reviewId]);
    return { ok: true };
  });
