import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "../server/db.server";
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
import { currentUser, isStaff, requireSeller, requireUser } from "../server/auth.server";
import {
  completeOrder,
  confirmPayment,
  expireOrder,
  getOrderRow,
  markManualDelivered,
  refundOrder,
  sweepLifecycle,
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
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const user = requireUser();
    const d = db();
    const settings = getSettings();

    const p = d
      .prepare(
        `select p.*, c.commission_pct as cat_commission, c.default_warranty_hours, c.risk_tier
         from products p join categories c on c.id = p.category_id where p.id = ?`,
      )
      .get(data.productId) as
      | {
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
        }
      | undefined;
    if (!p || p.status !== "active") fail("This product is not available.");
    if (p!.seller_id === user.id) fail("You can't buy your own product.");
    if (data.qty < p!.min_qty || data.qty > p!.max_qty)
      fail(`Quantity must be between ${p!.min_qty} and ${p!.max_qty}.`);
    if (p!.delivery_type === "manual" && p!.required_info && !data.buyerInfo?.trim())
      fail("This product requires delivery information at checkout.");

    const seller = d
      .prepare(`select vacation_mode, is_banned from users where id = ?`)
      .get(p!.seller_id) as {
      vacation_mode: number;
      is_banned: number;
    };
    if (seller.vacation_mode || seller.is_banned)
      fail("This seller is currently not accepting orders.");

    // velocity limit: max 5 open unpaid orders per buyer
    const openUnpaid = (
      d
        .prepare(`select count(*) c from orders where buyer_id = ? and status = 'awaiting_payment'`)
        .get(user.id) as { c: number }
    ).c;
    if (openUnpaid >= 5) fail("You have too many unpaid orders. Pay or cancel them first.");

    const orderId = uid();
    const t = now();
    let result: { orderId: string } | undefined;
    d.transaction(() => {
      if (p!.delivery_type === "auto") {
        const free = d
          .prepare(
            `select id from stock_items where product_id = ? and status = 'available' limit ?`,
          )
          .all(p!.id, data.qty) as Array<{ id: string }>;
        if (free.length < data.qty) fail(`Only ${free.length} in stock.`);
        for (const s of free) {
          d.prepare(`update stock_items set status = 'reserved', order_id = ? where id = ?`).run(
            orderId,
            s.id,
          );
        }
        d.prepare(
          `update products set stock_count = (select count(*) from stock_items where product_id = ? and status = 'available') where id = ?`,
        ).run(p!.id, p!.id);
      }
      const total = p!.price_cents * data.qty;
      const commissionPct = p!.cat_commission;
      const commission = Math.round((total * commissionPct) / 100);
      const expiresAt = t + settings.payment_window_minutes * 60_000;
      d.prepare(
        `insert into orders (id, order_no, buyer_id, seller_id, product_id, product_title, image_key, qty,
          unit_price_cents, total_cents, commission_pct, commission_cents, seller_net_cents, status,
          delivery_type, delivery_sla_minutes, warranty_hours, buyer_info, expires_at, created_at)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?, 'awaiting_payment', ?,?,?,?,?,?)`,
      ).run(
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
      );
      d.prepare(
        `insert into deposits (id, order_id, user_id, amount_cents, network, pay_address, status, expires_at, created_at)
         values (?,?,?,?,?,?, 'pending', ?, ?)`,
      ).run(
        uid(),
        orderId,
        user.id,
        total,
        data.network,
        makePayAddress(data.network),
        expiresAt,
        t,
      );
      result = { orderId };
    })();
    audit(user.id, "order.create", "order", orderId, { qty: data.qty, productId: p!.id });
    return result!;
  });

// ---------------------------------------------------------------------------
// Payment (simulated USDT gateway — same state transitions a real
// NOWPayments/Cryptomus webhook would drive via confirmPayment()).
// ---------------------------------------------------------------------------
export const getPayment = createServerFn({ method: "GET" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireUser();
    const o = getOrderRow(data.orderId);
    if (!o || (o.buyer_id !== user.id && !isStaff(user))) fail("Order not found.");
    const deposit = db()
      .prepare(`select * from deposits where order_id = ? order by created_at desc limit 1`)
      .get(data.orderId) as {
      id: string;
      amount_cents: number;
      network: string;
      pay_address: string;
      status: string;
      expires_at: number;
      tx_hash: string | null;
    };
    return { order: publicOrder(o!), deposit };
  });

export const simulatePaymentSent = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireUser();
    const o = getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (o!.status !== "awaiting_payment") fail("This order is not awaiting payment.");
    if (o!.expires_at && o!.expires_at < now()) {
      expireOrder(o!.id, "Payment window expired", "expired");
      fail("The payment window for this order has expired.");
    }
    // Demo gateway: short "confirming" pause then confirm. A production build
    // replaces this with the provider webhook calling confirmPayment().
    db()
      .prepare(`update deposits set status = 'confirming', tx_hash = ? where order_id = ?`)
      .run(`0x${uid().replaceAll("-", "")}`, data.orderId);
    confirmPayment(data.orderId);
    return { ok: true };
  });

export const cancelUnpaidOrder = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireUser();
    const o = getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (o!.status !== "awaiting_payment") fail("Only unpaid orders can be cancelled.");
    expireOrder(o!.id, "Cancelled by buyer", "cancelled");
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Order views
// ---------------------------------------------------------------------------
function publicOrder(o: OrderRow) {
  return o;
}

export const listMyOrders = createServerFn({ method: "GET" })
  .inputValidator(z.object({ role: z.enum(["buyer", "seller"]).default("buyer") }))
  .handler(async ({ data }) => {
    appContext();
    const user = data.role === "seller" ? requireSeller() : requireUser();
    sweepLifecycle();
    const col = data.role === "seller" ? "seller_id" : "buyer_id";
    const orders = db()
      .prepare(
        `select o.*, u.username as counterparty from orders o
         join users u on u.id = case when o.buyer_id = @id then o.seller_id else o.buyer_id end
         where o.${col} = @id order by o.created_at desc limit 200`,
      )
      .all({ id: user.id }) as Array<OrderRow & { counterparty: string }>;
    return { orders };
  });

export const getOrder = createServerFn({ method: "GET" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireUser();
    sweepLifecycle();
    const d = db();
    const o = getOrderRow(data.orderId);
    if (!o || (o.buyer_id !== user.id && o.seller_id !== user.id && !isStaff(user)))
      fail("Order not found.");
    const isBuyer = o!.buyer_id === user.id;
    const deliveries = d
      .prepare(
        `select id, type, payload, note, created_at from order_deliveries where order_id = ? order by created_at`,
      )
      .all(data.orderId) as Array<{
      id: string;
      type: string;
      payload: string | null;
      note: string | null;
      created_at: number;
    }>;
    // codes are only revealed to the buyer (and staff for disputes)
    const safeDeliveries = deliveries.map((del) => ({
      ...del,
      payload:
        isBuyer || isStaff(user) ? del.payload : del.payload ? "•••• (visible to buyer)" : null,
    }));
    const dispute = d.prepare(`select * from disputes where order_id = ?`).get(data.orderId) as
      | {
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
        }
      | undefined;
    const review = d
      .prepare(`select rating, comment, seller_reply, created_at from reviews where order_id = ?`)
      .get(data.orderId) as
      | { rating: number; comment: string | null; seller_reply: string | null; created_at: number }
      | undefined;
    const buyer = d.prepare(`select username from users where id = ?`).get(o!.buyer_id) as {
      username: string;
    };
    const seller = d.prepare(`select username from users where id = ?`).get(o!.seller_id) as {
      username: string;
    };
    const conversationId = getOrCreateOrderConversation(data.orderId);
    const settings = getSettings();
    return {
      order: publicOrder(o!),
      deliveries: safeDeliveries,
      dispute: dispute ?? null,
      review: review ?? null,
      buyerName: buyer.username,
      sellerName: seller.username,
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
    appContext();
    const user = requireSeller();
    const o = getOrderRow(data.orderId);
    if (!o || o.seller_id !== user.id) fail("Order not found.");
    if (!["paid", "delivering"].includes(o!.status)) fail("This order can't be marked delivered.");
    markManualDelivered(data.orderId, user.id, data.proofNote, data.payload);
    audit(user.id, "order.mark_delivered", "order", data.orderId);
    return { ok: true };
  });

export const buyerConfirmReceived = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireUser();
    const o = getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (o!.status !== "delivered") fail("This order is not awaiting confirmation.");
    completeOrder(data.orderId, false);
    audit(user.id, "order.confirm_received", "order", data.orderId);
    return { ok: true };
  });

export const buyerCancelSlaBreach = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireUser();
    const o = getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (o!.status !== "delivering" && o!.status !== "paid") fail("This order can't be cancelled.");
    const slaDeadline = (o!.paid_at ?? o!.created_at) + o!.delivery_sla_minutes * 60_000;
    if (now() < slaDeadline) fail("The seller's delivery window hasn't expired yet.");
    refundOrder(
      data.orderId,
      o!.total_cents,
      "Seller missed the delivery SLA — cancelled by buyer.",
    );
    // ding seller completion rate
    db()
      .prepare(`update users set completion_rate = max(0, completion_rate - 1) where id = ?`)
      .run(o!.seller_id);
    audit(user.id, "order.cancel_sla", "order", data.orderId);
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
    appContext();
    const user = requireUser();
    const d = db();
    const o = getOrderRow(data.orderId);
    if (!o || o.buyer_id !== user.id) fail("Order not found.");
    if (!["delivered", "completed", "delivering", "paid"].includes(o!.status))
      fail("A dispute can't be opened for this order status.");
    if (o!.warranty_ends_at && now() > o!.warranty_ends_at)
      fail("The warranty period for this order has ended.");
    if (d.prepare(`select 1 from disputes where order_id = ?`).get(data.orderId))
      fail("A dispute already exists for this order.");
    // velocity: max 5 disputes per buyer per 30 days
    const recent = (
      d
        .prepare(`select count(*) c from disputes where opened_by = ? and created_at > ?`)
        .get(user.id, now() - 30 * 86_400_000) as { c: number }
    ).c;
    if (recent >= 5) fail("Dispute limit reached — contact support directly.");

    d.prepare(
      `insert into disputes (id, order_id, opened_by, reason, description, created_at) values (?,?,?,?,?,?)`,
    ).run(uid(), data.orderId, user.id, data.reason, data.description, now());
    d.prepare(`update orders set status = 'disputed' where id = ?`).run(data.orderId);
    const convId = getOrCreateOrderConversation(data.orderId);
    systemMessage(
      convId,
      `Dispute opened: ${data.reason.replaceAll("_", " ")}. Escrow is frozen until staff resolve it.`,
    );
    notify(
      o!.seller_id,
      "dispute_opened",
      "Dispute opened",
      `${o!.order_no} — respond with your evidence.`,
      `/orders/${data.orderId}`,
    );
    audit(user.id, "dispute.open", "order", data.orderId, { reason: data.reason });
    return { ok: true };
  });

export const sellerRespondDispute = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string(), response: z.string().min(10).max(3000) }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireSeller();
    const d = db();
    const o = getOrderRow(data.orderId);
    if (!o || o.seller_id !== user.id) fail("Order not found.");
    const dispute = d
      .prepare(`select id, status from disputes where order_id = ?`)
      .get(data.orderId) as { id: string; status: string } | undefined;
    if (!dispute || dispute.status === "resolved") fail("No open dispute on this order.");
    d.prepare(
      `update disputes set seller_response = ?, status = 'seller_responded' where id = ?`,
    ).run(data.response, dispute!.id);
    notify(
      o!.buyer_id,
      "dispute_update",
      "Seller responded to your dispute",
      o!.order_no,
      `/orders/${data.orderId}`,
    );
    return { ok: true };
  });
