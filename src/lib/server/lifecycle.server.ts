import { db } from "./db.server";
import {
  decryptStock,
  getOrCreateOrderConversation,
  getSettings,
  notify,
  now,
  systemMessage,
  uid,
} from "./core.server";
import { txEscrowHold, txEscrowRelease, txRefund } from "./money.server";

export interface OrderRow {
  id: string;
  order_no: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  product_title: string;
  image_key: string | null;
  qty: number;
  unit_price_cents: number;
  total_cents: number;
  commission_pct: number;
  commission_cents: number;
  seller_net_cents: number;
  status: string;
  delivery_type: "auto" | "manual";
  delivery_sla_minutes: number;
  warranty_hours: number;
  buyer_info: string | null;
  cancel_reason: string | null;
  paid_at: number | null;
  delivered_at: number | null;
  completed_at: number | null;
  warranty_ends_at: number | null;
  released_at: number | null;
  auto_confirm_at: number | null;
  expires_at: number | null;
  created_at: number;
}

export const getOrderRow = (id: string) =>
  db().prepare(`select * from orders where id = ?`).get(id) as OrderRow | undefined;

function refreshStockCount(productId: string) {
  db()
    .prepare(
      `update products set stock_count = (select count(*) from stock_items where product_id = ? and status = 'available')
       where id = ?`,
    )
    .run(productId, productId);
  db()
    .prepare(
      `update products set status = case
         when status = 'active' and delivery_type = 'auto' and stock_count = 0 then 'out_of_stock'
         when status = 'out_of_stock' and stock_count > 0 then 'active'
         else status end
       where id = ?`,
    )
    .run(productId);
}

/** Payment confirmed (gateway webhook / simulated payment). Idempotent. */
export function confirmPayment(orderId: string): void {
  const d = db();
  d.transaction(() => {
    const o = getOrderRow(orderId);
    if (!o || o.status !== "awaiting_payment") return;
    const t = now();
    d.prepare(`update orders set status = 'paid', paid_at = ? where id = ?`).run(t, orderId);
    d.prepare(
      `update deposits set status = 'confirmed', confirmations = 20 where order_id = ?`,
    ).run(orderId);
    txEscrowHold(orderId, o.seller_id, o.seller_net_cents, o.order_no);

    const convId = getOrCreateOrderConversation(orderId);
    systemMessage(
      convId,
      `Payment of ${(o.total_cents / 100).toFixed(2)} USDT confirmed for ${o.order_no}.`,
    );
    notify(
      o.seller_id,
      "order_paid",
      "New paid order",
      `${o.order_no} — ${o.product_title}`,
      `/seller/orders`,
    );
    notify(
      o.buyer_id,
      "payment_confirmed",
      "Payment confirmed",
      `Your payment for ${o.order_no} was confirmed.`,
      `/orders/${orderId}`,
    );

    if (o.delivery_type === "auto") {
      deliverAutoStock(orderId);
    } else {
      d.prepare(`update orders set status = 'delivering' where id = ?`).run(orderId);
      systemMessage(convId, `Seller has ${o.delivery_sla_minutes} minutes to deliver this order.`);
    }
  })();
}

/** Reveal reserved codes to the buyer; order → delivered. Runs inside confirmPayment's tx. */
function deliverAutoStock(orderId: string): void {
  const d = db();
  const o = getOrderRow(orderId)!;
  const reserved = d
    .prepare(
      `select id, content_encrypted from stock_items where order_id = ? and status = 'reserved'`,
    )
    .all(orderId) as Array<{ id: string; content_encrypted: string }>;
  const codes = reserved.map((r) => decryptStock(r.content_encrypted));
  const t = now();
  for (const r of reserved) {
    d.prepare(`update stock_items set status = 'delivered', delivered_at = ? where id = ?`).run(
      t,
      r.id,
    );
  }
  d.prepare(
    `insert into order_deliveries (id, order_id, type, payload, delivered_by, created_at) values (?,?, 'auto', ?, null, ?)`,
  ).run(uid(), orderId, codes.join("\n"), t);

  const settings = getSettings();
  const autoConfirmAt = t + settings.auto_confirm_hours * 3600_000;
  d.prepare(
    `update orders set status = 'delivered', delivered_at = ?, auto_confirm_at = ? where id = ?`,
  ).run(t, autoConfirmAt, orderId);
  d.prepare(`update products set sold_count = sold_count + ? where id = ?`).run(
    o.qty,
    o.product_id,
  );
  refreshStockCount(o.product_id);

  const convId = getOrCreateOrderConversation(orderId);
  systemMessage(convId, `Order delivered automatically — codes are visible on the order page.`);
  notify(
    o.buyer_id,
    "order_delivered",
    "Order delivered",
    `${o.order_no} — your items are ready.`,
    `/orders/${orderId}`,
  );
}

/** Seller marks a manual order delivered. */
export function markManualDelivered(
  orderId: string,
  deliveredBy: string,
  proofNote: string,
  payload?: string,
): void {
  const d = db();
  d.transaction(() => {
    const o = getOrderRow(orderId)!;
    const t = now();
    d.prepare(
      `insert into order_deliveries (id, order_id, type, payload, note, delivered_by, created_at) values (?,?, 'manual', ?, ?, ?, ?)`,
    ).run(uid(), orderId, payload ?? null, proofNote, deliveredBy, t);
    const settings = getSettings();
    d.prepare(
      `update orders set status = 'delivered', delivered_at = ?, auto_confirm_at = ? where id = ?`,
    ).run(t, t + settings.auto_confirm_hours * 3600_000, orderId);
    d.prepare(`update products set sold_count = sold_count + ? where id = ?`).run(
      o.qty,
      o.product_id,
    );
    const convId = getOrCreateOrderConversation(orderId);
    systemMessage(
      convId,
      `Seller marked the order as delivered. Please confirm receipt or open a dispute.`,
    );
    notify(
      o.buyer_id,
      "order_delivered",
      "Order delivered",
      `${o.order_no} — please confirm receipt.`,
      `/orders/${orderId}`,
    );
  })();
}

/** Buyer confirms receipt (or auto-confirm). Warranty countdown starts. */
export function completeOrder(orderId: string, auto: boolean): void {
  const d = db();
  d.transaction(() => {
    const o = getOrderRow(orderId);
    if (!o || o.status !== "delivered") return;
    const t = now();
    const warrantyEndsAt = t + o.warranty_hours * 3600_000;
    d.prepare(
      `update orders set status = 'completed', completed_at = ?, warranty_ends_at = ? where id = ?`,
    ).run(t, warrantyEndsAt, orderId);
    d.prepare(`update users set total_sales = total_sales + 1 where id = ?`).run(o.seller_id);
    const convId = getOrCreateOrderConversation(orderId);
    systemMessage(
      convId,
      auto
        ? `Order auto-confirmed after the confirmation window. Warranty runs for ${o.warranty_hours}h.`
        : `Buyer confirmed receipt. Warranty runs for ${o.warranty_hours}h.`,
    );
    notify(
      o.seller_id,
      "order_completed",
      "Order completed",
      `${o.order_no} confirmed — escrow releases after warranty.`,
      `/seller/orders`,
    );
  })();
}

/** Cancel an unpaid order and unreserve stock. */
export function expireOrder(
  orderId: string,
  reason: string,
  finalStatus: "expired" | "cancelled",
): void {
  const d = db();
  d.transaction(() => {
    const o = getOrderRow(orderId);
    if (!o || o.status !== "awaiting_payment") return;
    d.prepare(`update orders set status = ?, cancel_reason = ? where id = ?`).run(
      finalStatus,
      reason,
      orderId,
    );
    d.prepare(
      `update deposits set status = 'expired' where order_id = ? and status = 'pending'`,
    ).run(orderId);
    d.prepare(
      `update stock_items set status = 'available', order_id = null where order_id = ? and status = 'reserved'`,
    ).run(orderId);
    refreshStockCount(o.product_id);
  })();
}

/** Refund a paid order (SLA breach cancel, dispute resolution, admin force). */
export function refundOrder(orderId: string, refundCents: number, note: string): void {
  const d = db();
  d.transaction(() => {
    const o = getOrderRow(orderId)!;
    const sellerKeepGross = o.total_cents - refundCents;
    const sellerKeepNet =
      sellerKeepGross > 0
        ? sellerKeepGross - Math.round((sellerKeepGross * o.commission_pct) / 100)
        : 0;
    txRefund(
      orderId,
      o.seller_id,
      o.buyer_id,
      refundCents,
      o.seller_net_cents,
      sellerKeepNet,
      o.order_no,
    );
    d.prepare(`update orders set status = 'refunded', cancel_reason = ? where id = ?`).run(
      note,
      orderId,
    );
    const convId = getOrCreateOrderConversation(orderId);
    systemMessage(
      convId,
      `Order refunded: ${(refundCents / 100).toFixed(2)} USDT returned to buyer wallet. ${note}`,
    );
    notify(
      o.buyer_id,
      "refund",
      "Refund issued",
      `${(refundCents / 100).toFixed(2)} USDT credited to your wallet for ${o.order_no}.`,
      `/orders/${orderId}`,
    );
    notify(
      o.seller_id,
      "refund",
      "Order refunded",
      `${o.order_no} was refunded. ${note}`,
      `/seller/orders`,
    );
  })();
}

/** Warranty over, no dispute: release escrow to seller. */
export function releaseOrder(orderId: string, note?: string): void {
  const d = db();
  d.transaction(() => {
    const o = getOrderRow(orderId);
    if (!o || !["completed", "disputed", "delivered"].includes(o.status)) return;
    txEscrowRelease(orderId, o.seller_id, o.seller_net_cents, o.commission_cents, o.order_no);
    d.prepare(`update orders set status = 'released', released_at = ? where id = ?`).run(
      now(),
      orderId,
    );
    const convId = getOrCreateOrderConversation(orderId);
    systemMessage(convId, note ?? `Warranty ended — escrow released to seller.`);
    notify(
      o.seller_id,
      "escrow_released",
      "Escrow released",
      `${(o.seller_net_cents / 100).toFixed(2)} USDT from ${o.order_no} is now available.`,
      `/seller/wallet`,
    );
  })();
}

// ---------------------------------------------------------------------------
// Background sweeps — the spec's VPS cron workers (escrow-release,
// order-expirer, auto-confirmer) run lazily in-process: any request that
// touches orders triggers a sweep, throttled to once per interval.
// ---------------------------------------------------------------------------
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 15_000;

export function sweepLifecycle(force = false): void {
  const t = now();
  if (!force && t - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = t;
  const d = db();

  // 1. order-expirer: unpaid orders past the payment window
  const expired = d
    .prepare(`select id from orders where status = 'awaiting_payment' and expires_at < ?`)
    .all(t) as Array<{ id: string }>;
  for (const row of expired) expireOrder(row.id, "Payment window expired", "expired");

  // 2. auto-confirmer: delivered orders past the confirmation window
  const toConfirm = d
    .prepare(`select id from orders where status = 'delivered' and auto_confirm_at < ?`)
    .all(t) as Array<{ id: string }>;
  for (const row of toConfirm) completeOrder(row.id, true);

  // 3. escrow-release: completed orders past warranty with no open dispute
  const toRelease = d
    .prepare(
      `select o.id from orders o
       where o.status = 'completed' and o.warranty_ends_at < ?
         and not exists (select 1 from disputes dd where dd.order_id = o.id and dd.status != 'resolved')`,
    )
    .all(t) as Array<{ id: string }>;
  for (const row of toRelease) releaseOrder(row.id);
}
