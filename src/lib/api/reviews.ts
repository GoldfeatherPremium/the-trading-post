import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q1, run, tx } from "../server/db.server";
import { appContext } from "../server/app.server";
import { fail, notify, now, uid } from "../server/core.server";
import { requireUser } from "../server/auth.server";

export const leaveReview = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      orderId: z.string(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(2000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const o = await q1<{
      id: string;
      order_no: string;
      buyer_id: string;
      seller_id: string;
      product_id: string;
      status: string;
    }>(`select id, order_no, buyer_id, seller_id, product_id, status from orders where id = ?`, [
      data.orderId,
    ]);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (!["completed", "released"].includes(o!.status))
      fail("You can review an order after confirming delivery.");
    if (await q1(`select 1 as x from reviews where order_id = ?`, [data.orderId]))
      fail("You already reviewed this order.");

    await tx(async () => {
      await run(
        `insert into reviews (id, order_id, buyer_id, seller_id, product_id, rating, comment, created_at) values (?,?,?,?,?,?,?,?)`,
        [
          uid(),
          data.orderId,
          user.id,
          o!.seller_id,
          o!.product_id,
          data.rating,
          data.comment ?? null,
          now(),
        ],
      );
      // recompute seller rating
      const agg = (await q1<{ a: number; c: number }>(
        `select avg(rating) a, count(*) c from reviews where seller_id = ?`,
        [o!.seller_id],
      ))!;
      await run(`update users set rating = ?, rating_count = ? where id = ?`, [
        Math.round(Number(agg.a) * 100) / 100,
        agg.c,
        o!.seller_id,
      ]);
    });
    await notify(
      o!.seller_id,
      "review",
      "New review received",
      `${data.rating}★ on ${o!.order_no}`,
      `/seller/reviews`,
    );
    return { ok: true };
  });
