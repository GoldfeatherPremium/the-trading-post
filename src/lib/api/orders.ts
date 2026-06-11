import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run, tx } from "../server/db.server";
import { appContext } from "../server/app.server";
import {
  audit,
  fail,
  getOrCreateOrderConversation,
  getSettings,
  makeOrderNo,
  makePayAddress,
  notify,
  now,
  systemMessage,
  uid,
} from "../server/core.server";
import { isStaff, requireSeller, requireUser } from "../server/auth.server";
import { validateCoupon } from "../server/coupons.server";
import {
  completeOrder,
  confirmPayment,
  expireOrder,
  getOrderRow,
  markManualDelivered,
  refundOrder,
  type OrderRow,
} from "../server/lifecycle.server";

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
export const createOrder = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      productId: z.string(),
      qty: z.number().int().min(1).max(1000),
      buyerInfo: z.string().max(2000).optional(),
      network: z.enum(["TRC20", "BEP20"]).default("TRC20"),
      couponCode: z.string().max(40).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const settings = await getSettings();

    const p = await q1<{
      id: string;
      seller_id: string;
      title: string;
      image_key: string | null;
      status: string;
      delivery_type: "auto" | "manual";
      delivery_sla_minutes: number;
      price_cents: number;
      min_qty: number;
      max_qty: number;
      stock_count: number;
      warranty_hours: number | null;
      cat_commission: number;
      default_warranty_hours: number;
      required_info: string | null;
    }>(
      `select p.*, c.commission_pct as cat_commission, c.default_warranty_hours, c.risk_tier
       from products p join categories c on c.id = p.category_id where p.id = ?`,
      [data.productId],
    );
    if (!p || p.status !== "active") fail("This product is not available.");
    if (p!.seller_id === user.id) fail("You can't buy your own product.");
    if (data.qty < p!.min_qty || data.qty > p!.max_qty)
      fail(`Quantity must be between ${p!.min_qty} and ${p!.max_qty}.`);
    if (p!.delivery_type === "manual" && p!.required_info && !data.buyerInfo?.trim())
      fail("This product requires delivery information at checkout.");

    const seller = (await q1<{ vacation_mode: number; is_banned: number }>(
      `select vacation_mode, is_banned from users where id = ?`,
      [p!.seller_id],
    ))!;
    if (seller.vacation_mode || seller.is_banned)
      fail("This seller is currently not accepting orders.");

    // velocity limit: max 5 open unpaid orders per buyer
    const openUnpaid = (await q1<{ c: number }>(
      `select count(*) c from orders where buyer_id = ? and status = 'awaiting_payment'`,
      [user.id],
    ))!.c;
    if (openUnpaid >= 5) fail("You have too many unpaid orders. Pay or cancel them first.");

    const orderId = uid();
    const t = now();
    await tx(async () => {
      if (p!.delivery_type === "auto") {
        const free = await q<{ id: string }>(
          `select id from stock_items where product_id = ? and status = 'available' limit ?`,
          [p!.id, data.qty],
        );
        if (free.length < data.qty) fail(`Only ${free.length} in stock.`);
        for (const s of free) {
          await run(`update stock_items set status = 'reserved', order_id = ? where id = ?`, [
            orderId,
            s.id,
          ]);
        }
        await run(
          `update products set stock_count = (select count(*) from stock_items where product_id = ? and status = 'available') where id = ?`,
          [p!.id, p!.id],
        );
      }
      const grossTotal = p!.price_cents * data.qty;
      let discount = 0;
      let couponCode: string | null = null;
      if (data.couponCode?.trim()) {
        const coupon = await validateCoupon(data.couponCode, grossTotal);
        discount = Math.round((grossTotal * coupon.pct_off) / 100);
        couponCode = coupon.code;
        await run(`update coupons set used_count = used_count + 1 where id = ?`, [coupon.id]);
      }
      const total = grossTotal - discount;
      const commissionPct = p!.cat_commission;
      const commission = Math.round((total * commissionPct) / 100);
      const expiresAt = t + settings.payment_window_minutes * 60_000;
      await run(
        `insert into orders (id, order_no, buyer_id, seller_id, product_id, product_title, image_key, qty,
          unit_price_cents, total_cents, commission_pct, commission_cents, seller_net_cents, status,
          delivery_type, delivery_sla_minutes, warranty_hours, buyer_info, expires_at, created_at,
          discount_cents, coupon_code)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?, 'awaiting_payment', ?,?,?,?,?,?,?,?)`,
        [
          orderId,
          makeOrderNo(),
          user.id,
          p!.seller_id,
          p!.id,
          p!.title,
          p!.image_key,
          data.qty,
          p!.price_cents,
          total,
          commissionPct,
          commission,
          total - commission,
          p!.delivery_type,
          p!.delivery_sla_minutes,
          p!.warranty_hours ?? p!.default_warranty_hours,
          data.buyerInfo ?? null,
          expiresAt,
          t,
          discount,
          couponCode,
        ],
      );
      await run(
        `insert into deposits (id, order_id, user_id, amount_cents, network, pay_address, status, expires_at, created_at)
         values (?,?,?,?,?,?, 'pending', ?, ?)`,
        [uid(), orderId, user.id, total, data.network, makePayAddress(data.network), expiresAt, t],
      );
    });
    await audit(user.id, "order.create", "order", orderId, { qty: data.qty, productId: p!.id });
    return { orderId };
  });

// ---------------------------------------------------------------------------
// Payment (simulated USDT gateway — same state transitions a real
// NOWPayments/Cryptomus webhook would drive via confirmPayment()).
// ---------------------------------------------------------------------------
export const getPayment = createServerFn({ method: "GET" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const o = await getOrderRow(data.orderId);
    if (!o || (o.buyer_id !== user.id && !isStaff(user))) fail("Order not found.");
    const deposit = (await q1<{
      id: string;
      amount_cents: number;
      network: string;
      pay_address: string;
      status: string;
      expires_at: number;
      tx_hash: string | null;
    }>(`select * from deposits where order_id = ? order by created_at desc limit 1`, [
      data.orderId,
    ]))!;
    return { order: o!, deposit };
  });

export const simulatePaymentSent = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const o = await getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (o!.status !== "awaiting_payment") fail("This order is not awaiting payment.");
    if (o!.expires_at && o!.expires_at < now()) {
      await expireOrder(o!.id, "Payment window expired", "expired");
      fail("The payment window for this order has expired.");
    }
    // Demo gateway: a production build replaces this with the provider
    // webhook calling confirmPayment().
    await run(`update deposits set status = 'confirming', tx_hash = ? where order_id = ?`, [
      `0x${uid().replaceAll("-", "")}`,
      data.orderId,
    ]);
    await confirmPayment(data.orderId);
    return { ok: true };
  });

export const cancelUnpaidOrder = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const o = await getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (o!.status !== "awaiting_payment") fail("Only unpaid orders can be cancelled.");
    await expireOrder(o!.id, "Cancelled by buyer", "cancelled");
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Order views
// ---------------------------------------------------------------------------
export const listMyOrders = createServerFn({ method: "GET" })
  .inputValidator(z.object({ role: z.enum(["buyer", "seller"]).default("buyer") }))
  .handler(async ({ data }) => {
    await appContext();
    const user = data.role === "seller" ? await requireSeller() : await requireUser();
    const col = data.role === "seller" ? "seller_id" : "buyer_id";
    const orders = await q<OrderRow & { counterparty: string }>(
      `select o.*, u.username as counterparty from orders o
       join users u on u.id = case when o.buyer_id = ? then o.seller_id else o.buyer_id end
       where o.${col} = ? order by o.created_at desc limit 200`,
      [user.id, user.id],
    );
    return { orders };
  });

export const getOrder = createServerFn({ method: "GET" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const o = await getOrderRow(data.orderId);
    if (!o || (o.buyer_id !== user.id && o.seller_id !== user.id && !isStaff(user)))
      fail("Order not found.");
    const isBuyer = o!.buyer_id === user.id;
    const [deliveries, dispute, review, buyer, seller, conversationId, settings] =
      await Promise.all([
        q<{
          id: string;
          type: string;
          payload: string | null;
          note: string | null;
          created_at: number;
        }>(
          `select id, type, payload, note, created_at from order_deliveries where order_id = ? order by created_at`,
          [data.orderId],
        ),
        q1<{
          id: string;
          reason: string;
          description: string | null;
          seller_response: string | null;
          status: string;
          resolution: string | null;
          resolution_cents: number | null;
          created_at: number;
          resolved_at: number | null;
          opened_by: string;
        }>(`select * from disputes where order_id = ?`, [data.orderId]),
        q1<{
          rating: number;
          comment: string | null;
          seller_reply: string | null;
          created_at: number;
        }>(`select rating, comment, seller_reply, created_at from reviews where order_id = ?`, [
          data.orderId,
        ]),
        q1<{ username: string }>(`select username from users where id = ?`, [o!.buyer_id]),
        q1<{ username: string }>(`select username from users where id = ?`, [o!.seller_id]),
        getOrCreateOrderConversation(data.orderId),
        getSettings(),
      ]);
    // codes are only revealed to the buyer (and staff for disputes)
    const safeDeliveries = deliveries.map((del) => ({
      ...del,
      payload:
        isBuyer || isStaff(user) ? del.payload : del.payload ? "•••• (visible to buyer)" : null,
    }));
    return {
      order: o!,
      deliveries: safeDeliveries,
      dispute: dispute ?? null,
      review: review ?? null,
      buyerName: buyer!.username,
      sellerName: seller!.username,
      conversationId,
      viewerIsBuyer: isBuyer,
      viewerIsSeller: o!.seller_id === user.id,
      autoConfirmHours: settings.auto_confirm_hours,
    };
  });

// ---------------------------------------------------------------------------
// Delivery + confirmation
// ---------------------------------------------------------------------------
export const sellerMarkDelivered = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      orderId: z.string(),
      proofNote: z.string().min(5).max(2000),
      payload: z.string().max(5000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const o = await getOrderRow(data.orderId);
    if (!o || o.seller_id !== user.id) fail("Order not found.");
    if (!["paid", "delivering"].includes(o!.status)) fail("This order can't be marked delivered.");
    await markManualDelivered(data.orderId, user.id, data.proofNote, data.payload);
    await audit(user.id, "order.mark_delivered", "order", data.orderId);
    return { ok: true };
  });

export const buyerConfirmReceived = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const o = await getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (o!.status !== "delivered") fail("This order is not awaiting confirmation.");
    await completeOrder(data.orderId, false);
    await audit(user.id, "order.confirm_received", "order", data.orderId);
    return { ok: true };
  });

export const buyerCancelSlaBreach = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const o = await getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (o!.status !== "delivering" && o!.status !== "paid") fail("This order can't be cancelled.");
    const slaDeadline = (o!.paid_at ?? o!.created_at) + o!.delivery_sla_minutes * 60_000;
    if (now() < slaDeadline) fail("The seller's delivery window hasn't expired yet.");
    await refundOrder(
      data.orderId,
      o!.total_cents,
      "Seller missed the delivery SLA — cancelled by buyer.",
    );
    // ding seller completion rate (portable greatest(0, x))
    await run(
      `update users set completion_rate = case when completion_rate - 1 < 0 then 0 else completion_rate - 1 end where id = ?`,
      [o!.seller_id],
    );
    await audit(user.id, "order.cancel_sla", "order", data.orderId);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------
export const openDispute = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      orderId: z.string(),
      reason: z.enum([
        "not_delivered",
        "invalid_code",
        "not_as_described",
        "stopped_working",
        "other",
      ]),
      description: z.string().min(10).max(3000),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const o = await getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (!["delivered", "completed", "delivering", "paid"].includes(o!.status))
      fail("A dispute can't be opened for this order status.");
    if (o!.warranty_ends_at && now() > o!.warranty_ends_at)
      fail("The warranty period for this order has ended.");
    if (await q1(`select 1 as x from disputes where order_id = ?`, [data.orderId]))
      fail("A dispute already exists for this order.");
    // velocity: max 5 disputes per buyer per 30 days
    const recent = (await q1<{ c: number }>(
      `select count(*) c from disputes where opened_by = ? and created_at > ?`,
      [user.id, now() - 30 * 86_400_000],
    ))!.c;
    if (recent >= 5) fail("Dispute limit reached — contact support directly.");

    await run(
      `insert into disputes (id, order_id, opened_by, reason, description, created_at) values (?,?,?,?,?,?)`,
      [uid(), data.orderId, user.id, data.reason, data.description, now()],
    );
    await run(`update orders set status = 'disputed' where id = ?`, [data.orderId]);
    const convId = await getOrCreateOrderConversation(data.orderId);
    await systemMessage(
      convId,
      `Dispute opened: ${data.reason.replaceAll("_", " ")}. Escrow is frozen until staff resolve it.`,
    );
    await notify(
      o!.seller_id,
      "dispute_opened",
      "Dispute opened",
      `${o!.order_no} — respond with your evidence.`,
      `/orders/${data.orderId}`,
    );
    await audit(user.id, "dispute.open", "order", data.orderId, { reason: data.reason });
    return { ok: true };
  });

export const sellerRespondDispute = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string(), response: z.string().min(10).max(3000) }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const o = await getOrderRow(data.orderId);
    if (!o || o.seller_id !== user.id) fail("Order not found.");
    const dispute = await q1<{ id: string; status: string }>(
      `select id, status from disputes where order_id = ?`,
      [data.orderId],
    );
    if (!dispute || dispute.status === "resolved") fail("No open dispute on this order.");
    await run(`update disputes set seller_response = ?, status = 'seller_responded' where id = ?`, [
      data.response,
      dispute!.id,
    ]);
    await notify(
      o!.buyer_id,
      "dispute_update",
      "Seller responded to your dispute",
      o!.order_no,
      `/orders/${data.orderId}`,
    );
    return { ok: true };
  });
