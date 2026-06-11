import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { requireUser } from "../server/auth.server";
import { audit, fail, notify, now, uid } from "../server/core.server";
import { getOrderRow } from "../server/lifecycle.server";

type StaffRole = "admin" | "support" | "finance";
const STAFF_ROLES: StaffRole[] = ["admin", "support", "finance"];

type DisputeRow = {
  id: string;
  order_id: string;
  opened_by: string;
  reason: string;
  description: string | null;
  seller_response: string | null;
  status: string;
  resolution: string | null;
  resolution_cents: number | null;
  resolved_by: string | null;
  created_at: number;
  resolved_at: number | null;
  priority: string;
  staff_owner: string | null;
  last_activity_at: number;
};

type OrderLite = {
  id: string;
  order_no: string;
  product_title: string;
  buyer_id: string;
  seller_id: string;
  total_cents: number;
  status: string;
  escrow_status: string;
  escrow_hold_reason: string | null;
  warranty_ends_at: number | null;
  paid_at: number | null;
};

async function loadDispute(orderId: string) {
  const o = await q1<OrderLite>(
    `select id, order_no, product_title, buyer_id, seller_id, total_cents, status,
            escrow_status, escrow_hold_reason, warranty_ends_at, paid_at
     from orders where id = ?`,
    [orderId],
  );
  if (!o) fail("Order not found.");
  const d = await q1<DisputeRow>(`select * from disputes where order_id = ?`, [orderId]);
  return { o: o!, d };
}

function roleFor(user: { id: string; role: string }, o: OrderLite): "buyer" | "seller" | "staff" {
  if ((STAFF_ROLES as string[]).includes(user.role)) return "staff";
  if (user.id === o.buyer_id) return "buyer";
  if (user.id === o.seller_id) return "seller";
  fail("You don't have access to this dispute.");
  return "buyer";
}

export const getDisputeThread = createServerFn({ method: "GET" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const { o, d } = await loadDispute(data.orderId);
    const role = roleFor(user, o);
    if (!d) {
      return {
        myRole: role,
        order: o,
        dispute: null as DisputeRow | null,
        evidence: [] as Array<Record<string, string | number | null>>,
        messages: [] as Array<Record<string, string | number | null>>,
      };
    }
    const [ev, msgs] = await Promise.all([
      q<Record<string, string | number | null>>(
        `select e.*, u.username as author_name from dispute_evidence e
         join users u on u.id = e.author_id where dispute_id = ? order by created_at asc`,
        [d.id],
      ),
      q<Record<string, string | number | null>>(
        `select m.*, u.username as author_name from dispute_messages m
         join users u on u.id = m.author_id where dispute_id = ? order by created_at asc`,
        [d.id],
      ),
    ]);
    const messages = role === "staff" ? msgs : msgs.filter((m) => Number(m.is_internal) === 0);
    return { myRole: role, order: o, dispute: d, evidence: ev, messages };
  });

export const addDisputeEvidence = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      orderId: z.string(),
      kind: z.enum(["screenshot", "log", "delivery_proof", "chat_excerpt", "other"]),
      title: z.string().min(2).max(120),
      body: z.string().max(4000).optional(),
      url: z.string().url().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const { o, d } = await loadDispute(data.orderId);
    if (!d) fail("No dispute exists for this order yet.");
    if (d!.status === "resolved") fail("Dispute is already resolved.");
    const role = roleFor(user, o);
    const t = now();
    await run(
      `insert into dispute_evidence (id, dispute_id, author_id, author_role, kind, title, body, url, created_at)
       values (?,?,?,?,?,?,?,?,?)`,
      [
        uid(),
        d!.id,
        user.id,
        role,
        data.kind,
        data.title,
        data.body ?? null,
        data.url ?? null,
        t,
      ],
    );
    await run(`update disputes set last_activity_at = ? where id = ?`, [t, d!.id]);
    // notify counterparties
    const targets =
      role === "buyer" ? [o.seller_id] : role === "seller" ? [o.buyer_id] : [o.buyer_id, o.seller_id];
    for (const uid_ of targets) {
      await notify(
        uid_,
        "dispute_update",
        "New evidence on dispute",
        `${o.order_no}: ${data.title}`,
        `/disputes/${o.id}`,
      );
    }
    await audit(user.id, "dispute.evidence", "dispute", d!.id, { kind: data.kind });
    return { ok: true };
  });

export const postDisputeMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      orderId: z.string(),
      body: z.string().min(2).max(2000),
      internal: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const { o, d } = await loadDispute(data.orderId);
    if (!d) fail("No dispute exists for this order yet.");
    const role = roleFor(user, o);
    const isInternal = data.internal && role === "staff" ? 1 : 0;
    const t = now();
    await run(
      `insert into dispute_messages (id, dispute_id, author_id, author_role, body, is_internal, created_at)
       values (?,?,?,?,?,?,?)`,
      [uid(), d!.id, user.id, role, data.body, isInternal, t],
    );
    await run(`update disputes set last_activity_at = ? where id = ?`, [t, d!.id]);
    if (!isInternal) {
      const targets =
        role === "buyer"
          ? [o.seller_id]
          : role === "seller"
            ? [o.buyer_id]
            : [o.buyer_id, o.seller_id];
      for (const uid_ of targets) {
        await notify(
          uid_,
          "dispute_update",
          "New message on dispute",
          o.order_no,
          `/disputes/${o.id}`,
        );
      }
    }
    return { ok: true };
  });

export const staffSetDisputeStatus = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      orderId: z.string(),
      status: z.enum(["open", "seller_responded", "under_review", "awaiting_buyer"]),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      claim: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    if (!(STAFF_ROLES as string[]).includes(user.role)) fail("Staff only.");
    const { d } = await loadDispute(data.orderId);
    if (!d) fail("Dispute not found.");
    if (d!.status === "resolved") fail("Dispute already resolved.");
    const t = now();
    await run(
      `update disputes set status = ?, priority = coalesce(?, priority), staff_owner = case when ? then ? else staff_owner end, last_activity_at = ? where id = ?`,
      [data.status, data.priority ?? null, data.claim ? 1 : 0, user.id, t, d!.id],
    );
    await audit(user.id, "dispute.status", "dispute", d!.id, {
      status: data.status,
      priority: data.priority,
      claim: data.claim,
    });
    return { ok: true };
  });
