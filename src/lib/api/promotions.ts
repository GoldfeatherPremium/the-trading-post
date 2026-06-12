import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { audit, fail, now, uid } from "../server/core.server";
import { requireSeller } from "../server/auth.server";

type Row = Record<string, string | number | null>;

// ---------------------------------------------------------------------------
// Coupons owned by this seller
// ---------------------------------------------------------------------------
export const listMyPromotions = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireSeller();
  const [coupons, sales, recentRedemptions] = await Promise.all([
    q<Row>(
      `select c.*, p.title as product_title from coupons c
       left join products p on p.id = c.product_id
       where c.seller_id = ? order by c.created_at desc limit 100`,
      [user.id],
    ),
    q<Row>(
      `select id, title, price_cents, sale_price_cents, sale_ends_at, status
       from products where seller_id = ? and sale_price_cents is not null and sale_price_cents > 0
       order by sale_ends_at asc nulls last`,
      [user.id],
    ),
    q<{
      coupon_code: string;
      orders: number;
      gross: number;
      discount: number;
    }>(
      `select coupon_code, count(*) orders, coalesce(sum(total_cents),0) gross,
              coalesce(sum(discount_cents),0) discount
       from orders where seller_id = ? and coupon_code is not null and paid_at > ?
       group by coupon_code order by orders desc limit 20`,
      [user.id, now() - 90 * 86_400_000],
    ),
  ]);
  return { coupons, sales, recentRedemptions };
});

const couponInput = z.object({
  couponId: z.string().optional(),
  code: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[A-Z0-9_-]+$/i, "Letters, numbers, dash and underscore only."),
  pctOff: z.number().min(1).max(80),
  minTotalUsdt: z.number().min(0).max(100_000).default(0),
  maxUses: z.number().int().min(0).max(100_000).default(0),
  expiresInDays: z.number().int().min(0).max(365).default(0),
  productId: z.string().optional(),
  label: z.string().max(80).optional(),
  isActive: z.boolean().default(true),
});

export const saveMyCoupon = createServerFn({ method: "POST" })
  .inputValidator(couponInput)
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();

    // Reserved scope: a seller can only manage their own coupons
    if (data.productId) {
      const owned = await q1(
        `select 1 as x from products where id = ? and seller_id = ?`,
        [data.productId, user.id],
      );
      if (!owned) fail("Product not found.");
    }

    const expiresAt = data.expiresInDays > 0 ? now() + data.expiresInDays * 86_400_000 : null;

    if (data.couponId) {
      const existing = await q1<{ seller_id: string | null }>(
        `select seller_id from coupons where id = ?`,
        [data.couponId],
      );
      if (!existing || existing.seller_id !== user.id) fail("Coupon not found.");
      await run(
        `update coupons set code = ?, pct_off = ?, min_total_cents = ?, max_uses = ?, expires_at = ?,
           is_active = ?, product_id = ?, label = ? where id = ?`,
        [
          data.code.toUpperCase(),
          data.pctOff,
          Math.round(data.minTotalUsdt * 100),
          data.maxUses,
          expiresAt,
          data.isActive ? 1 : 0,
          data.productId ?? null,
          data.label ?? null,
          data.couponId,
        ],
      );
      await audit(user.id, "promo.coupon.update", "coupon", data.couponId);
      return { ok: true };
    }

    const clash = await q1(`select 1 as x from coupons where lower(code) = lower(?)`, [data.code]);
    if (clash) fail("That code is already taken — try another.");
    const id = uid();
    await run(
      `insert into coupons (id, code, pct_off, min_total_cents, max_uses, expires_at, is_active,
         seller_id, product_id, label, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        data.code.toUpperCase(),
        data.pctOff,
        Math.round(data.minTotalUsdt * 100),
        data.maxUses,
        expiresAt,
        data.isActive ? 1 : 0,
        user.id,
        data.productId ?? null,
        data.label ?? null,
        now(),
      ],
    );
    await audit(user.id, "promo.coupon.create", "coupon", id);
    return { ok: true, couponId: id };
  });

export const deleteMyCoupon = createServerFn({ method: "POST" })
  .inputValidator(z.object({ couponId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const existing = await q1<{ seller_id: string | null }>(
      `select seller_id from coupons where id = ?`,
      [data.couponId],
    );
    if (!existing || existing.seller_id !== user.id) fail("Coupon not found.");
    await run(`delete from coupons where id = ?`, [data.couponId]);
    await audit(user.id, "promo.coupon.delete", "coupon", data.couponId);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Per-product flash sale price
// ---------------------------------------------------------------------------
export const setProductSale = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      productId: z.string(),
      salePriceUsdt: z.number().min(0.5).max(100_000).nullable(),
      endsInDays: z.number().int().min(0).max(60).default(7),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const p = await q1<{ seller_id: string; price_cents: number }>(
      `select seller_id, price_cents from products where id = ?`,
      [data.productId],
    );
    if (!p || p.seller_id !== user.id) fail("Product not found.");
    if (data.salePriceUsdt === null) {
      await run(
        `update products set sale_price_cents = null, sale_ends_at = null where id = ?`,
        [data.productId],
      );
      await audit(user.id, "promo.sale.clear", "product", data.productId);
      return { ok: true };
    }
    const saleCents = Math.round(data.salePriceUsdt * 100);
    if (saleCents >= p!.price_cents)
      fail("Sale price must be lower than the regular price.");
    const endsAt = data.endsInDays > 0 ? now() + data.endsInDays * 86_400_000 : null;
    await run(
      `update products set sale_price_cents = ?, sale_ends_at = ? where id = ?`,
      [saleCents, endsAt, data.productId],
    );
    await audit(user.id, "promo.sale.set", "product", data.productId, {
      saleCents,
      endsAt,
    });
    return { ok: true };
  });

export const listMyProductsForPromo = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireSeller();
  const products = await q<{ id: string; title: string; price_cents: number; status: string }>(
    `select id, title, price_cents, status from products where seller_id = ?
     and status in ('active','out_of_stock','paused') order by title`,
    [user.id],
  );
  return { products };
});
