import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { requireSeller, requireUser } from "../server/auth.server";
import {
  audit,
  decryptStock,
  encryptStock,
  fail,
  getOrCreateOrderConversation,
  notify,
  now,
  systemMessage,
  uid,
} from "../server/core.server";

type SlotRow = {
  id: string;
  product_id: string;
  seller_id: string;
  label: string;
  credentials_encrypted: string;
  status: string;
  buyer_id: string | null;
  order_id: string | null;
  started_at: number | null;
  expires_at: number | null;
  created_at: number;
};

type SlotPublic = Omit<SlotRow, "credentials_encrypted"> & {
  product_title: string;
  buyer_username?: string | null;
  credentials?: string;
};

// ---------------------------------------------------------------------------
// Seller — slot inventory management
// ---------------------------------------------------------------------------
export const sellerListSlots = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireSeller();
  const rows = await q<SlotRow & { product_title: string; buyer_username: string | null }>(
    `select s.*, p.title as product_title, u.username as buyer_username
     from subscription_slots s
     join products p on p.id = s.product_id
     left join users u on u.id = s.buyer_id
     where s.seller_id = ?
     order by s.product_id, s.created_at desc`,
    [user.id],
  );
  const products = await q<{ id: string; title: string; subscription_cycle_days: number; subscription_seats_total: number; product_kind: string }>(
    `select id, title, subscription_cycle_days, subscription_seats_total, product_kind
     from products where seller_id = ? and product_kind = 'subscription_slot'
     order by created_at desc`,
    [user.id],
  );
  const slots: SlotPublic[] = rows.map((r) => {
    const { credentials_encrypted: _enc, ...rest } = r;
    return rest;
  });
  return { slots, products };
});

export const sellerCreateSlot = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      productId: z.string(),
      label: z.string().min(1).max(40),
      credentials: z.string().min(2).max(2000),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const p = await q1<{ seller_id: string; product_kind: string; subscription_seats_total: number }>(
      `select seller_id, product_kind, subscription_seats_total from products where id = ?`,
      [data.productId],
    );
    if (!p || p.seller_id !== user.id) fail("Product not found.");
    if (p!.product_kind !== "subscription_slot")
      fail("This product is not a subscription slot listing.");
    const existing = (await q1<{ c: number }>(
      `select count(*) c from subscription_slots where product_id = ? and status != 'disabled'`,
      [data.productId],
    ))!.c;
    if (existing >= p!.subscription_seats_total)
      fail(
        `Slot capacity reached (${p!.subscription_seats_total}). Increase seats on the listing first.`,
      );
    const t = now();
    await run(
      `insert into subscription_slots (id, product_id, seller_id, label, credentials_encrypted, status, created_at)
       values (?,?,?,?,?, 'available', ?)`,
      [uid(), data.productId, user.id, data.label, encryptStock(data.credentials), t],
    );
    await audit(user.id, "subscription.slot.create", "product", data.productId);
    return { ok: true };
  });

export const sellerUpdateSlot = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      slotId: z.string(),
      credentials: z.string().min(2).max(2000).optional(),
      action: z.enum(["disable", "enable", "reclaim"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const s = await q1<SlotRow>(`select * from subscription_slots where id = ?`, [data.slotId]);
    if (!s || s.seller_id !== user.id) fail("Slot not found.");
    if (data.credentials) {
      await run(`update subscription_slots set credentials_encrypted = ? where id = ?`, [
        encryptStock(data.credentials),
        data.slotId,
      ]);
      if (s!.buyer_id) {
        await notify(
          s!.buyer_id,
          "subscription_update",
          "Subscription credentials updated",
          "Your seller refreshed the access details.",
          `/account/subscriptions`,
        );
      }
    }
    if (data.action === "disable") {
      await run(`update subscription_slots set status = 'disabled' where id = ?`, [data.slotId]);
    } else if (data.action === "enable") {
      const status = s!.buyer_id && s!.expires_at && s!.expires_at > now() ? "active" : "available";
      await run(`update subscription_slots set status = ? where id = ?`, [status, data.slotId]);
    } else if (data.action === "reclaim") {
      // free the seat from an inactive buyer
      if (s!.buyer_id) {
        await notify(
          s!.buyer_id,
          "subscription_update",
          "Subscription seat reclaimed",
          "Your seller reclaimed this seat. Contact them for a renewal.",
          `/account/subscriptions`,
        );
      }
      await run(
        `update subscription_slots set status = 'available', buyer_id = null, order_id = null, started_at = null, expires_at = null where id = ?`,
        [data.slotId],
      );
    }
    await audit(user.id, "subscription.slot.update", "slot", data.slotId, {
      action: data.action,
      credentialsChanged: !!data.credentials,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Seller — assign a paid order to a seat
// ---------------------------------------------------------------------------
export const sellerAssignSlot = createServerFn({ method: "POST" })
  .inputValidator(z.object({ slotId: z.string(), orderId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const s = await q1<SlotRow>(`select * from subscription_slots where id = ?`, [data.slotId]);
    if (!s || s.seller_id !== user.id) fail("Slot not found.");
    if (s!.status === "active") fail("Slot is already active. Reclaim it first.");
    if (s!.status === "disabled") fail("Slot is disabled.");
    const o = await q1<{
      id: string;
      buyer_id: string;
      seller_id: string;
      product_id: string;
      order_no: string;
      status: string;
    }>(`select id, buyer_id, seller_id, product_id, order_no, status from orders where id = ?`, [
      data.orderId,
    ]);
    if (!o || o.seller_id !== user.id) fail("Order not found.");
    if (o!.product_id !== s!.product_id) fail("Order is for a different product.");
    if (!["paid", "delivering"].includes(o!.status))
      fail("Only paid / delivering orders can be assigned.");
    const p = await q1<{ subscription_cycle_days: number }>(
      `select subscription_cycle_days from products where id = ?`,
      [s!.product_id],
    );
    const t = now();
    const expires = t + (p!.subscription_cycle_days || 30) * 86_400_000;
    await run(
      `update subscription_slots set status = 'active', buyer_id = ?, order_id = ?, started_at = ?, expires_at = ? where id = ?`,
      [o!.buyer_id, o!.id, t, expires, data.slotId],
    );
    const creds = decryptStock(s!.credentials_encrypted);
    await run(
      `insert into order_deliveries (id, order_id, type, payload, note, delivered_by, created_at) values (?,?, 'subscription_slot', ?, ?, ?, ?)`,
      [
        uid(),
        o!.id,
        creds,
        `Slot ${s!.label} · expires ${new Date(expires).toISOString()}`,
        user.id,
        t,
      ],
    );
    await run(
      `update orders set status = 'delivered', delivered_at = ?, auto_confirm_at = ? where id = ?`,
      [t, t + 72 * 3600_000, o!.id],
    );
    const convId = await getOrCreateOrderConversation(o!.id);
    await systemMessage(
      convId,
      `Seller assigned subscription slot "${s!.label}". Cycle ends ${new Date(expires).toUTCString()}.`,
    );
    await notify(
      o!.buyer_id,
      "order_delivered",
      "Subscription slot assigned",
      `${o!.order_no} — credentials are on the order page.`,
      `/orders/${o!.id}`,
    );
    await audit(user.id, "subscription.slot.assign", "slot", data.slotId, { orderId: o!.id });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Buyer — my active subscription slots
// ---------------------------------------------------------------------------
export const buyerListSubscriptions = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireUser();
  const rows = await q<SlotRow & { product_title: string; seller_username: string }>(
    `select s.*, p.title as product_title, u.username as seller_username
     from subscription_slots s
     join products p on p.id = s.product_id
     join users u on u.id = s.seller_id
     where s.buyer_id = ?
     order by case when s.status = 'active' then 0 else 1 end, s.expires_at desc`,
    [user.id],
  );
  const t = now();
  const slots = rows.map((r) => {
    const expired = r.expires_at != null && r.expires_at < t;
    const active = r.status === "active" && !expired;
    return {
      id: r.id,
      productId: r.product_id,
      productTitle: r.product_title,
      sellerUsername: r.seller_username,
      label: r.label,
      status: expired ? "expired" : r.status,
      orderId: r.order_id,
      startedAt: r.started_at,
      expiresAt: r.expires_at,
      // only reveal credentials while active
      credentials: active ? decryptStock(r.credentials_encrypted) : null,
    };
  });
  return { slots };
});
