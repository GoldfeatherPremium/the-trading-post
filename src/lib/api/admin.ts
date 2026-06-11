import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "../server/db.server";
import { appContext } from "../server/app.server";
import {
  audit,
  fail,
  getOrCreateOrderConversation,
  notify,
  now,
  systemMessage,
  uid,
} from "../server/core.server";
import { requireAdmin, requireStaff } from "../server/auth.server";
import { getOrderRow, refundOrder, releaseOrder, expireOrder } from "../server/lifecycle.server";
import { txAdjustment, txSetFreeze, txWithdrawalReversal } from "../server/money.server";

type Row = Record<string, string | number | null>;

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export const getAdminDashboard = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  requireStaff();
  const d = db();
  const t = now();
  const gmv = (since: number) =>
    d
      .prepare(
        `select coalesce(sum(total_cents),0) s, count(*) c from orders where paid_at > ? and status not in ('cancelled','expired')`,
      )
      .get(since) as { s: number; c: number };
  const revenue = (
    d
      .prepare(`select coalesce(sum(commission_cents),0) s from orders where status = 'released'`)
      .get() as { s: number }
  ).s;
  const ordersByStatus = d
    .prepare(`select status, count(*) c from orders group by status`)
    .all() as Array<{ status: string; c: number }>;
  const pending = {
    sellerApplications: (
      d.prepare(`select count(*) c from seller_applications where status = 'pending'`).get() as {
        c: number;
      }
    ).c,
    productReviews: (
      d.prepare(`select count(*) c from products where status = 'pending_review'`).get() as {
        c: number;
      }
    ).c,
    openDisputes: (
      d.prepare(`select count(*) c from disputes where status != 'resolved'`).get() as { c: number }
    ).c,
    withdrawals: (
      d.prepare(`select count(*) c from withdrawals where status = 'pending'`).get() as {
        c: number;
      }
    ).c,
    flaggedMessages: (
      d
        .prepare(`select count(*) c from messages where is_flagged = 1 and moderated_at is null`)
        .get() as { c: number }
    ).c,
  };
  const escrowHeld = (
    d.prepare(`select coalesce(sum(pending_cents),0) s from wallets`).get() as { s: number }
  ).s;
  const users = (d.prepare(`select count(*) c from users`).get() as { c: number }).c;
  const topSellers = d
    .prepare(
      `select u.username, count(*) c, coalesce(sum(o.total_cents),0) s from orders o join users u on u.id = o.seller_id
       where o.paid_at > ? group by o.seller_id order by s desc limit 5`,
    )
    .all(t - 30 * 86_400_000) as Array<{ username: string; c: number; s: number }>;
  return {
    gmvToday: gmv(t - 86_400_000),
    gmv30d: gmv(t - 30 * 86_400_000),
    revenue,
    ordersByStatus,
    pending,
    escrowHeld,
    users,
    topSellers,
  };
});

// ---------------------------------------------------------------------------
// Seller approvals
// ---------------------------------------------------------------------------
export const listSellerApplications = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  requireStaff();
  const applications = db()
    .prepare(
      `select a.*, u.username, u.email from seller_applications a join users u on u.id = a.user_id
       order by case a.status when 'pending' then 0 else 1 end, a.created_at desc limit 200`,
    )
    .all() as Array<Row>;
  return { applications };
});

export const reviewSellerApplication = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      applicationId: z.string(),
      approve: z.boolean(),
      note: z.string().max(1000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const staff = requireAdmin();
    const d = db();
    const app = d
      .prepare(`select * from seller_applications where id = ?`)
      .get(data.applicationId) as { id: string; user_id: string; status: string } | undefined;
    if (!app || app.status !== "pending") fail("Application not found or already reviewed.");
    const status = data.approve ? "approved" : "rejected";
    d.prepare(
      `update seller_applications set status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = ? where id = ?`,
    ).run(status, data.note ?? null, staff.id, now(), data.applicationId);
    d.prepare(
      `update users set seller_status = ?, role = case when ? then 'seller' else role end where id = ?`,
    ).run(status, data.approve ? 1 : 0, app!.user_id);
    notify(
      app!.user_id,
      "seller_application",
      data.approve ? "Seller application approved 🎉" : "Seller application rejected",
      data.note ?? (data.approve ? "You can now list products." : "See admin note."),
      data.approve ? "/seller" : "/sell",
    );
    audit(staff.id, `seller_application.${status}`, "seller_application", data.applicationId, {
      note: data.note,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Product approvals
// ---------------------------------------------------------------------------
export const listProductReviewQueue = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  requireStaff();
  const products = db()
    .prepare(
      `select p.*, u.username as seller_name, c.name as category_name, c.risk_tier
       from products p join users u on u.id = p.seller_id join categories c on c.id = p.category_id
       order by case p.status when 'pending_review' then 0 else 1 end, p.created_at desc limit 300`,
    )
    .all() as Array<Row>;
  return { products };
});

export const reviewProduct = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      productId: z.string(),
      approve: z.boolean(),
      reason: z.string().max(1000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const staff = requireAdmin();
    const d = db();
    const p = d
      .prepare(
        `select id, seller_id, title, status, delivery_type, stock_count from products where id = ?`,
      )
      .get(data.productId) as
      | {
          id: string;
          seller_id: string;
          title: string;
          status: string;
          delivery_type: string;
          stock_count: number;
        }
      | undefined;
    if (!p) fail("Product not found.");
    if (p!.status !== "pending_review") fail("Product is not awaiting review.");
    if (data.approve) {
      const next = p!.delivery_type === "auto" && p!.stock_count === 0 ? "out_of_stock" : "active";
      d.prepare(`update products set status = ?, reject_reason = null where id = ?`).run(
        next,
        data.productId,
      );
    } else {
      if (!data.reason) fail("A rejection reason is required.");
      d.prepare(`update products set status = 'rejected', reject_reason = ? where id = ?`).run(
        data.reason,
        data.productId,
      );
    }
    notify(
      p!.seller_id,
      "product_review",
      data.approve ? "Product approved" : "Product rejected",
      `${p!.title}${data.reason ? ` — ${data.reason}` : ""}`,
      "/seller/products",
    );
    audit(staff.id, `product.${data.approve ? "approve" : "reject"}`, "product", data.productId, {
      reason: data.reason,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Orders (global)
// ---------------------------------------------------------------------------
export const adminListOrders = createServerFn({ method: "GET" })
  .inputValidator(z.object({ q: z.string().max(80).optional(), status: z.string().optional() }))
  .handler(async ({ data }) => {
    appContext();
    requireStaff();
    const where: string[] = ["1=1"];
    const params: Record<string, unknown> = {};
    if (data.q) {
      where.push(
        `(o.order_no like @q or o.product_title like @q or ub.username like @q or us.username like @q)`,
      );
      params.q = `%${data.q}%`;
    }
    if (data.status) {
      where.push(`o.status = @status`);
      params.status = data.status;
    }
    const orders = db()
      .prepare(
        `select o.*, ub.username as buyer_name, us.username as seller_name
         from orders o join users ub on ub.id = o.buyer_id join users us on us.id = o.seller_id
         where ${where.join(" and ")} order by o.created_at desc limit 200`,
      )
      .all(params) as Array<Row>;
    return { orders };
  });

export const adminForceOrderAction = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      orderId: z.string(),
      action: z.enum(["refund", "release", "cancel"]),
      note: z.string().min(5).max(1000),
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const staff = requireAdmin();
    const o = getOrderRow(data.orderId);
    if (!o) fail("Order not found.");
    if (data.action === "cancel") {
      if (o!.status !== "awaiting_payment") fail("Only unpaid orders can be cancelled.");
      expireOrder(data.orderId, `Admin: ${data.note}`, "cancelled");
    } else if (data.action === "refund") {
      if (!["paid", "delivering", "delivered", "completed", "disputed"].includes(o!.status))
        fail("This order can't be refunded.");
      refundOrder(data.orderId, o!.total_cents, `Admin: ${data.note}`);
    } else {
      if (!["delivered", "completed", "disputed"].includes(o!.status))
        fail("This order can't be released.");
      releaseOrder(data.orderId, `Released by staff: ${data.note}`);
    }
    audit(staff.id, `order.force_${data.action}`, "order", data.orderId, { note: data.note });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Disputes center
// ---------------------------------------------------------------------------
export const listDisputes = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  requireStaff();
  const disputes = db()
    .prepare(
      `select dd.*, o.order_no, o.product_title, o.total_cents, o.status as order_status, o.delivery_type,
              ub.username as buyer_name, us.username as seller_name, o.buyer_id, o.seller_id
       from disputes dd join orders o on o.id = dd.order_id
       join users ub on ub.id = o.buyer_id join users us on us.id = o.seller_id
       order by case dd.status when 'resolved' then 1 else 0 end, dd.created_at desc limit 200`,
    )
    .all() as Array<Row>;
  return { disputes };
});

export const resolveDispute = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      disputeId: z.string(),
      resolution: z.enum(["refund_full", "refund_partial", "release_seller"]),
      partialRefundUsdt: z.number().min(0).optional(),
      note: z.string().min(5).max(2000),
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const staff = requireStaff(["support", "admin"]);
    const d = db();
    const dd = d.prepare(`select * from disputes where id = ?`).get(data.disputeId) as
      | { id: string; order_id: string; status: string }
      | undefined;
    if (!dd || dd.status === "resolved") fail("Dispute not found or already resolved.");
    const o = getOrderRow(dd!.order_id)!;
    let resolutionCents = 0;
    if (data.resolution === "refund_full") {
      resolutionCents = o.total_cents;
      refundOrder(o.id, o.total_cents, `Dispute resolved: full refund. ${data.note}`);
    } else if (data.resolution === "refund_partial") {
      resolutionCents = Math.round((data.partialRefundUsdt ?? 0) * 100);
      if (resolutionCents <= 0 || resolutionCents >= o.total_cents)
        fail("Partial refund must be between 0 and the order total.");
      refundOrder(o.id, resolutionCents, `Dispute resolved: partial refund. ${data.note}`);
    } else {
      releaseOrder(o.id, `Dispute resolved in seller's favour: ${data.note}`);
    }
    d.prepare(
      `update disputes set status = 'resolved', resolution = ?, resolution_cents = ?, resolved_by = ?, resolved_at = ? where id = ?`,
    ).run(data.resolution, resolutionCents, staff.id, now(), data.disputeId);
    const convId = getOrCreateOrderConversation(o.id);
    systemMessage(
      convId,
      `Dispute resolved (${data.resolution.replaceAll("_", " ")}): ${data.note}`,
    );
    notify(
      o.buyer_id,
      "dispute_resolved",
      "Dispute resolved",
      `${o.order_no}: ${data.resolution.replaceAll("_", " ")}`,
      `/orders/${o.id}`,
    );
    notify(
      o.seller_id,
      "dispute_resolved",
      "Dispute resolved",
      `${o.order_no}: ${data.resolution.replaceAll("_", " ")}`,
      `/orders/${o.id}`,
    );
    audit(staff.id, "dispute.resolve", "dispute", data.disputeId, {
      resolution: data.resolution,
      note: data.note,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Finance: withdrawals + deposits + adjustments
// ---------------------------------------------------------------------------
export const listWithdrawalQueue = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  requireStaff(["finance", "admin"]);
  const withdrawals = db()
    .prepare(
      `select w.*, u.username, u.email, u.seller_level,
              (select available_cents from wallets where user_id = w.user_id) as wallet_available
       from withdrawals w join users u on u.id = w.user_id
       order by case w.status when 'pending' then 0 else 1 end, w.created_at desc limit 200`,
    )
    .all() as Array<Row>;
  return { withdrawals };
});

export const reviewWithdrawal = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      withdrawalId: z.string(),
      action: z.enum(["approve", "reject", "mark_sent"]),
      txHash: z.string().max(120).optional(),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const staff = requireStaff(["finance", "admin"]);
    const d = db();
    const w = d.prepare(`select * from withdrawals where id = ?`).get(data.withdrawalId) as
      | { id: string; user_id: string; amount_cents: number; fee_cents: number; status: string }
      | undefined;
    if (!w) fail("Withdrawal not found.");
    if (data.action === "approve") {
      if (w!.status !== "pending") fail("Only pending withdrawals can be approved.");
      d.prepare(
        `update withdrawals set status = 'approved', reviewed_by = ?, reviewed_at = ? where id = ?`,
      ).run(staff.id, now(), w!.id);
      notify(
        w!.user_id,
        "withdrawal",
        "Withdrawal approved",
        "Payout is being processed.",
        "/seller/wallet",
      );
    } else if (data.action === "mark_sent") {
      if (!["pending", "approved"].includes(w!.status)) fail("Withdrawal is not awaiting payout.");
      if (!data.txHash) fail("Transaction hash is required.");
      d.prepare(
        `update withdrawals set status = 'sent', tx_hash = ?, reviewed_by = ?, reviewed_at = ? where id = ?`,
      ).run(data.txHash, staff.id, now(), w!.id);
      notify(
        w!.user_id,
        "withdrawal",
        "Withdrawal sent",
        `${(w!.amount_cents / 100).toFixed(2)} USDT sent — tx ${data.txHash!.slice(0, 18)}…`,
        "/seller/wallet",
      );
    } else {
      if (!["pending", "approved"].includes(w!.status)) fail("Withdrawal can't be rejected now.");
      txWithdrawalReversal(w!.user_id, w!.amount_cents, w!.fee_cents, w!.id);
      d.prepare(
        `update withdrawals set status = 'rejected', reviewed_by = ?, reviewed_at = ? where id = ?`,
      ).run(staff.id, now(), w!.id);
      notify(
        w!.user_id,
        "withdrawal",
        "Withdrawal rejected",
        data.note ?? "Funds returned to your wallet.",
        "/seller/wallet",
      );
    }
    audit(staff.id, `withdrawal.${data.action}`, "withdrawal", data.withdrawalId, {
      note: data.note,
      txHash: data.txHash,
    });
    return { ok: true };
  });

export const listDeposits = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  requireStaff(["finance", "admin"]);
  const deposits = db()
    .prepare(
      `select dp.*, u.username, o.order_no from deposits dp
       join users u on u.id = dp.user_id left join orders o on o.id = dp.order_id
       order by dp.created_at desc limit 200`,
    )
    .all() as Array<Row>;
  return { deposits };
});

export const adminAdjustWallet = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ userId: z.string(), amountUsdt: z.number(), note: z.string().min(5).max(500) }),
  )
  .handler(async ({ data }) => {
    appContext();
    const staff = requireAdmin();
    txAdjustment(data.userId, Math.round(data.amountUsdt * 100), `Admin adjustment: ${data.note}`);
    audit(staff.id, "wallet.adjust", "user", data.userId, {
      amountUsdt: data.amountUsdt,
      note: data.note,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const adminListUsers = createServerFn({ method: "GET" })
  .inputValidator(z.object({ q: z.string().max(80).optional() }))
  .handler(async ({ data }) => {
    appContext();
    requireStaff();
    const where = data.q ? `where u.username like @q or u.email like @q` : "";
    const users = db()
      .prepare(
        `select u.id, u.email, u.username, u.role, u.seller_status, u.seller_level, u.rating, u.total_sales,
                u.is_banned, u.wallet_frozen, u.created_at,
                coalesce(w.available_cents,0) available_cents, coalesce(w.pending_cents,0) pending_cents,
                coalesce(w.frozen_cents,0) frozen_cents
         from users u left join wallets w on w.user_id = u.id ${where} order by u.created_at desc limit 200`,
      )
      .all(data.q ? { q: `%${data.q}%` } : {}) as Array<Row>;
    return { users };
  });

export const adminUserAction = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      userId: z.string(),
      action: z.enum([
        "ban",
        "unban",
        "freeze_wallet",
        "unfreeze_wallet",
        "set_role",
        "set_seller_level",
      ]),
      role: z.enum(["buyer", "seller", "support", "finance", "admin"]).optional(),
      level: z.number().int().min(1).max(5).optional(),
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const staff = requireAdmin();
    const d = db();
    if (data.userId === staff.id && (data.action === "ban" || data.action === "set_role"))
      fail("You can't do that to your own account.");
    const target = d.prepare(`select id from users where id = ?`).get(data.userId);
    if (!target) fail("User not found.");
    switch (data.action) {
      case "ban":
        d.prepare(`update users set is_banned = 1 where id = ?`).run(data.userId);
        d.prepare(`delete from sessions where user_id = ?`).run(data.userId);
        break;
      case "unban":
        d.prepare(`update users set is_banned = 0 where id = ?`).run(data.userId);
        break;
      case "freeze_wallet":
        txSetFreeze(data.userId, true);
        break;
      case "unfreeze_wallet":
        txSetFreeze(data.userId, false);
        break;
      case "set_role":
        if (!data.role) fail("Role required.");
        d.prepare(`update users set role = ? where id = ?`).run(data.role, data.userId);
        break;
      case "set_seller_level":
        if (!data.level) fail("Level required.");
        d.prepare(`update users set seller_level = ? where id = ?`).run(data.level, data.userId);
        break;
    }
    audit(staff.id, `user.${data.action}`, "user", data.userId, {
      role: data.role,
      level: data.level,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Catalog management
// ---------------------------------------------------------------------------
export const adminListCategories = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  requireStaff();
  const categories = db()
    .prepare(
      `select c.*, (select count(*) from products p where p.category_id = c.id and p.status = 'active') product_count
       from categories c order by c.sort`,
    )
    .all() as Array<Row>;
  return { categories };
});

export const adminSaveCategory = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      categoryId: z.string().optional(),
      name: z.string().min(2).max(60),
      slug: z
        .string()
        .min(2)
        .max(60)
        .regex(/^[a-z0-9-]+$/),
      icon: z.string().max(8).optional(),
      defaultWarrantyHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 90),
      commissionPct: z.number().min(0).max(50),
      riskTier: z.enum(["normal", "high"]),
      isActive: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const staff = requireAdmin();
    const d = db();
    if (data.categoryId) {
      d.prepare(
        `update categories set name = ?, slug = ?, icon = ?, default_warranty_hours = ?, commission_pct = ?, risk_tier = ?, is_active = ? where id = ?`,
      ).run(
        data.name,
        data.slug,
        data.icon ?? null,
        data.defaultWarrantyHours,
        data.commissionPct,
        data.riskTier,
        data.isActive ? 1 : 0,
        data.categoryId,
      );
    } else {
      if (d.prepare(`select 1 from categories where slug = ?`).get(data.slug))
        fail("Slug already exists.");
      d.prepare(
        `insert into categories (id, name, slug, icon, sort, default_warranty_hours, commission_pct, risk_tier, is_active)
         values (?,?,?,?, (select coalesce(max(sort),0)+1 from categories), ?,?,?,?)`,
      ).run(
        uid(),
        data.name,
        data.slug,
        data.icon ?? null,
        data.defaultWarrantyHours,
        data.commissionPct,
        data.riskTier,
        data.isActive ? 1 : 0,
      );
    }
    audit(staff.id, "category.save", "category", data.categoryId ?? data.slug);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Settings + audit + moderation
// ---------------------------------------------------------------------------
export const getAdminSettings = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  requireStaff();
  return { settings: db().prepare(`select * from site_settings where id = 1`).get() as Row };
});

export const updateAdminSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      defaultCommissionPct: z.number().min(0).max(50),
      withdrawalFeeUsdt: z.number().min(0).max(100),
      minWithdrawalUsdt: z.number().min(0).max(10_000),
      autoConfirmHours: z.number().int().min(1).max(720),
      paymentWindowMinutes: z.number().int().min(5).max(1440),
      maintenanceMode: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const staff = requireAdmin();
    db()
      .prepare(
        `update site_settings set default_commission_pct = ?, withdrawal_fee_cents = ?, min_withdrawal_cents = ?,
           auto_confirm_hours = ?, payment_window_minutes = ?, maintenance_mode = ? where id = 1`,
      )
      .run(
        data.defaultCommissionPct,
        Math.round(data.withdrawalFeeUsdt * 100),
        Math.round(data.minWithdrawalUsdt * 100),
        data.autoConfirmHours,
        data.paymentWindowMinutes,
        data.maintenanceMode ? 1 : 0,
      );
    audit(staff.id, "settings.update", "site_settings", "1", data);
    return { ok: true };
  });

export const listAuditLogs = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  requireAdmin();
  const logs = db()
    .prepare(
      `select a.*, u.username as actor_name from audit_logs a left join users u on u.id = a.actor_id
       order by a.id desc limit 300`,
    )
    .all() as Array<Row>;
  return { logs };
});

export const listFlaggedMessages = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  requireStaff();
  const messages = db()
    .prepare(
      `select m.id, m.body, m.flag_reason, m.created_at, m.moderated_at, u.username as sender_name, m.conversation_id
       from messages m left join users u on u.id = m.sender_id
       where m.is_flagged = 1 order by case when m.moderated_at is null then 0 else 1 end, m.created_at desc limit 200`,
    )
    .all() as Array<Row>;
  return { messages };
});

export const moderateMessage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ messageId: z.string(), action: z.enum(["dismiss", "remove"]) }))
  .handler(async ({ data }) => {
    appContext();
    const staff = requireStaff();
    const d = db();
    if (data.action === "remove") {
      d.prepare(
        `update messages set body = '[removed by moderator]', moderated_at = ?, moderated_by = ? where id = ?`,
      ).run(now(), staff.id, data.messageId);
    } else {
      d.prepare(
        `update messages set is_flagged = 0, moderated_at = ?, moderated_by = ? where id = ?`,
      ).run(now(), staff.id, data.messageId);
    }
    audit(staff.id, `message.${data.action}`, "message", data.messageId);
    return { ok: true };
  });
