import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run, tx } from "../server/db.server";
import { appContext } from "../server/app.server";
import { audit, fail, now, uid } from "../server/core.server";
import { requireUser } from "../server/auth.server";
import { getWallet } from "../server/money.server";
import { confirmPayment, getOrderRow } from "../server/lifecycle.server";
import { validateCoupon } from "../server/coupons.server";

// ---------------------------------------------------------------------------
// Favorites / wishlist
// ---------------------------------------------------------------------------
export const listFavoriteIds = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireUser();
  const rows = await q<{ product_id: string }>(
    `select product_id from favorites where user_id = ?`,
    [user.id],
  );
  return { ids: rows.map((r) => r.product_id) };
});

export const toggleFavorite = createServerFn({ method: "POST" })
  .inputValidator(z.object({ productId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const existing = await q1(`select 1 as x from favorites where user_id = ? and product_id = ?`, [
      user.id,
      data.productId,
    ]);
    if (existing) {
      await run(`delete from favorites where user_id = ? and product_id = ?`, [
        user.id,
        data.productId,
      ]);
      return { favorited: false };
    }
    if (!(await q1(`select 1 as x from products where id = ?`, [data.productId])))
      fail("Product not found.");
    await run(`insert into favorites (user_id, product_id, created_at) values (?,?,?)`, [
      user.id,
      data.productId,
      now(),
    ]);
    return { favorited: true };
  });

export const listFavoriteProducts = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireUser();
  const products = await q<Record<string, string | number | null>>(
    `select p.id, p.title, p.slug, p.image_key, p.delivery_type, p.price_cents, p.stock_count, p.status,
            p.sold_count, c.name as category_name, u.username as seller_name, u.rating as seller_rating,
            f.created_at as favorited_at
     from favorites f
     join products p on p.id = f.product_id
     join categories c on c.id = p.category_id
     join users u on u.id = p.seller_id
     where f.user_id = ? order by f.created_at desc limit 100`,
    [user.id],
  );
  return { products };
});

// ---------------------------------------------------------------------------
// Coupons (buyer-side check; admin CRUD lives in admin.ts)
// ---------------------------------------------------------------------------
export const checkCoupon = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: z.string().min(2).max(40), totalUsdt: z.number().min(0) }))
  .handler(async ({ data }) => {
    await appContext();
    await requireUser();
    const c = await validateCoupon(data.code, Math.round(data.totalUsdt * 100));
    return { code: c.code, pctOff: c.pct_off };
  });

// ---------------------------------------------------------------------------
// Pay with wallet balance (refund credits become instantly spendable)
// ---------------------------------------------------------------------------
export const payWithWallet = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    if (user.wallet_frozen) fail("Your wallet is frozen. Contact support.");
    const o = await getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (o!.status !== "awaiting_payment") fail("This order is not awaiting payment.");
    if (o!.expires_at && o!.expires_at < now())
      fail("The payment window for this order has expired.");

    await tx(async () => {
      const w = await getWallet(user.id);
      if (w.available_cents < o!.total_cents)
        fail(
          `Insufficient balance: ${(w.available_cents / 100).toFixed(2)} USDT available, ${(o!.total_cents / 100).toFixed(2)} needed.`,
        );
      await run(`update wallets set available_cents = available_cents - ? where user_id = ?`, [
        o!.total_cents,
        user.id,
      ]);
      const after = await getWallet(user.id);
      await run(
        `insert into wallet_ledger (user_id, order_id, type, amount_cents, balance_after_cents, note, created_at)
         values (?,?,?,?,?,?,?)`,
        [
          user.id,
          o!.id,
          "purchase",
          -o!.total_cents,
          after.available_cents + after.pending_cents,
          `Wallet payment for ${o!.order_no}`,
          now(),
        ],
      );
      await run(`update deposits set status = 'confirmed', tx_hash = ? where order_id = ?`, [
        `wallet:${uid().slice(0, 18)}`,
        data.orderId,
      ]);
    });
    await confirmPayment(data.orderId);
    await audit(user.id, "order.wallet_pay", "order", data.orderId);
    return { ok: true };
  });
