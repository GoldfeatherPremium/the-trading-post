import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "../server/db.server";
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
    appContext();
    const user = requireUser();
    const d = db();
    const o = d
      .prepare(
        `select id, order_no, buyer_id, seller_id, product_id, status from orders where id = ?`,
      )
      .get(data.orderId) as
      | {
          id: string;
          order_no: string;
          buyer_id: string;
          seller_id: string;
          product_id: string;
          status: string;
        }
      | undefined;
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (!["completed", "released"].includes(o!.status))
      fail("You can review an order after confirming delivery.");
    if (d.prepare(`select 1 from reviews where order_id = ?`).get(data.orderId))
      fail("You already reviewed this order.");

    d.transaction(() => {
      d.prepare(
        `insert into reviews (id, order_id, buyer_id, seller_id, product_id, rating, comment, created_at) values (?,?,?,?,?,?,?,?)`,
      ).run(
        uid(),
        data.orderId,
        user.id,
        o!.seller_id,
        o!.product_id,
        data.rating,
        data.comment ?? null,
        now(),
      );
      // recompute seller rating
      const agg = d
        .prepare(`select avg(rating) a, count(*) c from reviews where seller_id = ?`)
        .get(o!.seller_id) as { a: number; c: number };
      d.prepare(`update users set rating = ?, rating_count = ? where id = ?`).run(
        Math.round(agg.a * 100) / 100,
        agg.c,
        o!.seller_id,
      );
    })();
    notify(
      o!.seller_id,
      "review",
      "New review received",
      `${data.rating}★ on ${o!.order_no}`,
      `/seller/reviews`,
    );
    return { ok: true };
  });
