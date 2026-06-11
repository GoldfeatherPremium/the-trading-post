import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run } from "../server/db.server";
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
import {
  getOrderRow,
  refundOrder,
  releaseOrder,
  expireOrder,
  adminEscrowHold,
  adminEscrowUnhold,
  adminExtendWarranty,
} from "../server/lifecycle.server";
import { txAdjustment, txSetFreeze, txWithdrawalReversal } from "../server/money.server";

type Row = Record<string, string | number | null>;

const count = async (sql: string, params?: Array<string | number>) =>
  (await q1<{ c: number }>(sql, params))!.c;

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export const getAdminDashboard = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff();
  const t = now();
  const dayMs = 86_400_000;
  const gmv = (since: number) =>
    q1<{ s: number; c: number }>(
      `select coalesce(sum(total_cents),0) s, count(*) c from orders where paid_at > ? and status not in ('cancelled','expired')`,
      [since],
    );
  const [
    gmvToday,
    gmv30d,
    revenueRow,
    ordersByStatus,
    sellerApplications,
    productReviews,
    openDisputes,
    withdrawals,
    flaggedMessages,
    escrowRow,
    users,
    topSellers,
    paidOrders,
  ] = await Promise.all([
    gmv(t - dayMs),
    gmv(t - 30 * dayMs),
    q1<{ s: number }>(
      `select coalesce(sum(commission_cents),0) s from orders where status = 'released'`,
    ),
    q<{ status: string; c: number }>(`select status, count(*) c from orders group by status`),
    count(`select count(*) c from seller_applications where status = 'pending'`),
    count(`select count(*) c from products where status = 'pending_review'`),
    count(`select count(*) c from disputes where status != 'resolved'`),
    count(`select count(*) c from withdrawals where status = 'pending'`),
    count(`select count(*) c from messages where is_flagged = 1 and moderated_at is null`),
    q1<{ s: number }>(`select coalesce(sum(pending_cents),0) s from wallets`),
    count(`select count(*) c from users`),
    q<{ username: string; c: number; s: number }>(
      `select u.username, count(*) c, coalesce(sum(o.total_cents),0) s from orders o join users u on u.id = o.seller_id
       where o.paid_at > ? group by o.seller_id, u.username order by s desc limit 5`,
      [t - 30 * dayMs],
    ),
    q<{ paid_at: number; total_cents: number }>(
      `select paid_at, total_cents from orders where paid_at > ? and status not in ('cancelled','expired')`,
      [t - 13 * dayMs],
    ),
  ]);
  const daily: Array<{ day: string; gmv: number; orders: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(t - i * dayMs);
    daily.push({ day: `${d.getMonth() + 1}/${d.getDate()}`, gmv: 0, orders: 0 });
  }
  for (const o of paidOrders) {
    const idx = 13 - Math.min(13, Math.max(0, Math.floor((t - o.paid_at) / dayMs)));
    daily[idx].gmv += o.total_cents / 100;
    daily[idx].orders += 1;
  }
  return {
    daily,
    gmvToday: gmvToday!,
    gmv30d: gmv30d!,
    revenue: revenueRow!.s,
    ordersByStatus,
    pending: { sellerApplications, productReviews, openDisputes, withdrawals, flaggedMessages },
    escrowHeld: escrowRow!.s,
    users,
    topSellers,
  };
});

// ---------------------------------------------------------------------------
// Seller approvals
// ---------------------------------------------------------------------------
export const listSellerApplications = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff();
  const applications = await q<Row>(
    `select a.*, u.username, u.email from seller_applications a join users u on u.id = a.user_id
     order by case a.status when 'pending' then 0 else 1 end, a.created_at desc limit 200`,
  );
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
    await appContext();
    const staff = await requireAdmin();
    const app = await q1<{ id: string; user_id: string; status: string }>(
      `select * from seller_applications where id = ?`,
      [data.applicationId],
    );
    if (!app || app.status !== "pending") fail("Application not found or already reviewed.");
    const status = data.approve ? "approved" : "rejected";
    await run(
      `update seller_applications set status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = ? where id = ?`,
      [status, data.note ?? null, staff.id, now(), data.applicationId],
    );
    if (data.approve) {
      await run(`update users set seller_status = 'approved', role = 'seller' where id = ?`, [
        app!.user_id,
      ]);
      const { recomputeSellerTrust } = await import("../server/trust.server");
      await recomputeSellerTrust(app!.user_id);
    } else {
      await run(`update users set seller_status = 'rejected' where id = ?`, [app!.user_id]);
    }
    await notify(
      app!.user_id,
      "seller_application",
      data.approve ? "Seller application approved 🎉" : "Seller application rejected",
      data.note ?? (data.approve ? "You can now list products." : "See admin note."),
      data.approve ? "/seller" : "/sell",
    );
    await audit(
      staff.id,
      `seller_application.${status}`,
      "seller_application",
      data.applicationId,
      { note: data.note },
    );
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Product approvals
// ---------------------------------------------------------------------------
export const listProductReviewQueue = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff();
  const products = await q<Row>(
    `select p.*, u.username as seller_name, c.name as category_name, c.risk_tier
     from products p join users u on u.id = p.seller_id join categories c on c.id = p.category_id
     order by case p.status when 'pending_review' then 0 else 1 end, p.created_at desc limit 300`,
  );
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
    await appContext();
    const staff = await requireAdmin();
    const p = await q1<{
      id: string;
      seller_id: string;
      title: string;
      status: string;
      delivery_type: string;
      stock_count: number;
    }>(
      `select id, seller_id, title, status, delivery_type, stock_count from products where id = ?`,
      [data.productId],
    );
    if (!p) fail("Product not found.");
    if (p!.status !== "pending_review") fail("Product is not awaiting review.");
    if (data.approve) {
      const next = p!.delivery_type === "auto" && p!.stock_count === 0 ? "out_of_stock" : "active";
      await run(`update products set status = ?, reject_reason = null where id = ?`, [
        next,
        data.productId,
      ]);
    } else {
      if (!data.reason) fail("A rejection reason is required.");
      await run(`update products set status = 'rejected', reject_reason = ? where id = ?`, [
        data.reason!,
        data.productId,
      ]);
    }
    await notify(
      p!.seller_id,
      "product_review",
      data.approve ? "Product approved" : "Product rejected",
      `${p!.title}${data.reason ? ` — ${data.reason}` : ""}`,
      "/seller/products",
    );
    await audit(
      staff.id,
      `product.${data.approve ? "approve" : "reject"}`,
      "product",
      data.productId,
      {
        reason: data.reason,
      },
    );
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Orders (global)
// ---------------------------------------------------------------------------
export const adminListOrders = createServerFn({ method: "GET" })
  .inputValidator(z.object({ q: z.string().max(80).optional(), status: z.string().optional() }))
  .handler(async ({ data }) => {
    await appContext();
    await requireStaff();
    const where: string[] = ["1=1"];
    const params: Array<string | number> = [];
    if (data.q) {
      const like = `%${data.q.toLowerCase()}%`;
      where.push(
        `(lower(o.order_no) like ? or lower(o.product_title) like ? or lower(ub.username) like ? or lower(us.username) like ?)`,
      );
      params.push(like, like, like, like);
    }
    if (data.status) {
      where.push(`o.status = ?`);
      params.push(data.status);
    }
    const orders = await q<Row>(
      `select o.*, ub.username as buyer_name, us.username as seller_name
       from orders o join users ub on ub.id = o.buyer_id join users us on us.id = o.seller_id
       where ${where.join(" and ")} order by o.created_at desc limit 200`,
      params,
    );
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
    await appContext();
    const staff = await requireAdmin();
    const o = await getOrderRow(data.orderId);
    if (!o) fail("Order not found.");
    if (data.action === "cancel") {
      if (o!.status !== "awaiting_payment") fail("Only unpaid orders can be cancelled.");
      await expireOrder(data.orderId, `Admin: ${data.note}`, "cancelled");
    } else if (data.action === "refund") {
      if (!["paid", "delivering", "delivered", "completed", "disputed"].includes(o!.status))
        fail("This order can't be refunded.");
      await refundOrder(data.orderId, o!.total_cents, `Admin: ${data.note}`);
    } else {
      if (!["delivered", "completed", "disputed"].includes(o!.status))
        fail("This order can't be released.");
      await releaseOrder(data.orderId, `Released by staff: ${data.note}`);
    }
    await audit(staff.id, `order.force_${data.action}`, "order", data.orderId, { note: data.note });
    return { ok: true };
  });

export const adminEscrowAction = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      orderId: z.string(),
      action: z.enum(["hold", "unhold", "extend"]),
      hours: z.number().int().min(1).max(720).optional(),
      reason: z.string().min(5).max(500),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const staff = await requireAdmin();
    const o = await getOrderRow(data.orderId);
    if (!o) fail("Order not found.");
    if (data.action === "hold") {
      await adminEscrowHold(data.orderId, staff.id, data.reason);
    } else if (data.action === "unhold") {
      await adminEscrowUnhold(data.orderId, staff.id);
    } else {
      if (!data.hours) fail("Hours required for warranty extension.");
      await adminExtendWarranty(data.orderId, data.hours!, data.reason);
    }
    await audit(staff.id, `escrow.${data.action}`, "order", data.orderId, {
      reason: data.reason,
      hours: data.hours,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Disputes center
// ---------------------------------------------------------------------------
export const listDisputes = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff();
  const disputes = await q<Row>(
    `select dd.*, o.order_no, o.product_title, o.total_cents, o.status as order_status, o.delivery_type,
            ub.username as buyer_name, us.username as seller_name, o.buyer_id, o.seller_id
     from disputes dd join orders o on o.id = dd.order_id
     join users ub on ub.id = o.buyer_id join users us on us.id = o.seller_id
     order by case dd.status when 'resolved' then 1 else 0 end, dd.created_at desc limit 200`,
  );
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
    await appContext();
    const staff = await requireStaff(["support", "admin"]);
    const dd = await q1<{ id: string; order_id: string; status: string }>(
      `select * from disputes where id = ?`,
      [data.disputeId],
    );
    if (!dd || dd.status === "resolved") fail("Dispute not found or already resolved.");
    const o = (await getOrderRow(dd!.order_id))!;
    let resolutionCents = 0;
    if (data.resolution === "refund_full") {
      resolutionCents = o.total_cents;
      await refundOrder(o.id, o.total_cents, `Dispute resolved: full refund. ${data.note}`);
    } else if (data.resolution === "refund_partial") {
      resolutionCents = Math.round((data.partialRefundUsdt ?? 0) * 100);
      if (resolutionCents <= 0 || resolutionCents >= o.total_cents)
        fail("Partial refund must be between 0 and the order total.");
      await refundOrder(o.id, resolutionCents, `Dispute resolved: partial refund. ${data.note}`);
    } else {
      await releaseOrder(o.id, `Dispute resolved in seller's favour: ${data.note}`);
    }
    await run(
      `update disputes set status = 'resolved', resolution = ?, resolution_cents = ?, resolved_by = ?, resolved_at = ? where id = ?`,
      [data.resolution, resolutionCents, staff.id, now(), data.disputeId],
    );
    const convId = await getOrCreateOrderConversation(o.id);
    await systemMessage(
      convId,
      `Dispute resolved (${data.resolution.replaceAll("_", " ")}): ${data.note}`,
    );
    await notify(
      o.buyer_id,
      "dispute_resolved",
      "Dispute resolved",
      `${o.order_no}: ${data.resolution.replaceAll("_", " ")}`,
      `/orders/${o.id}`,
    );
    await notify(
      o.seller_id,
      "dispute_resolved",
      "Dispute resolved",
      `${o.order_no}: ${data.resolution.replaceAll("_", " ")}`,
      `/orders/${o.id}`,
    );
    await audit(staff.id, "dispute.resolve", "dispute", data.disputeId, {
      resolution: data.resolution,
      note: data.note,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Finance: withdrawals + deposits + adjustments
// ---------------------------------------------------------------------------
export const listWithdrawalQueue = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff(["finance", "admin"]);
  const withdrawals = await q<Row>(
    `select w.*, u.username, u.email, u.seller_level,
            (select available_cents from wallets where user_id = w.user_id) as wallet_available
     from withdrawals w join users u on u.id = w.user_id
     order by case w.status when 'pending' then 0 else 1 end, w.created_at desc limit 200`,
  );
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
    await appContext();
    const staff = await requireStaff(["finance", "admin"]);
    const w = await q1<{
      id: string;
      user_id: string;
      amount_cents: number;
      fee_cents: number;
      status: string;
    }>(`select * from withdrawals where id = ?`, [data.withdrawalId]);
    if (!w) fail("Withdrawal not found.");
    if (data.action === "approve") {
      if (w!.status !== "pending") fail("Only pending withdrawals can be approved.");
      await run(
        `update withdrawals set status = 'approved', reviewed_by = ?, reviewed_at = ? where id = ?`,
        [staff.id, now(), w!.id],
      );
      await notify(
        w!.user_id,
        "withdrawal",
        "Withdrawal approved",
        "Payout is being processed.",
        "/seller/wallet",
      );
    } else if (data.action === "mark_sent") {
      if (!["pending", "approved"].includes(w!.status)) fail("Withdrawal is not awaiting payout.");
      if (!data.txHash) fail("Transaction hash is required.");
      await run(
        `update withdrawals set status = 'sent', tx_hash = ?, reviewed_by = ?, reviewed_at = ? where id = ?`,
        [data.txHash!, staff.id, now(), w!.id],
      );
      await notify(
        w!.user_id,
        "withdrawal",
        "Withdrawal sent",
        `${(w!.amount_cents / 100).toFixed(2)} USDT sent — tx ${data.txHash!.slice(0, 18)}…`,
        "/seller/wallet",
      );
    } else {
      if (!["pending", "approved"].includes(w!.status)) fail("Withdrawal can't be rejected now.");
      await txWithdrawalReversal(w!.user_id, w!.amount_cents, w!.fee_cents, w!.id);
      await run(
        `update withdrawals set status = 'rejected', reviewed_by = ?, reviewed_at = ? where id = ?`,
        [staff.id, now(), w!.id],
      );
      await notify(
        w!.user_id,
        "withdrawal",
        "Withdrawal rejected",
        data.note ?? "Funds returned to your wallet.",
        "/seller/wallet",
      );
    }
    await audit(staff.id, `withdrawal.${data.action}`, "withdrawal", data.withdrawalId, {
      note: data.note,
      txHash: data.txHash,
    });
    return { ok: true };
  });

export const listDeposits = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff(["finance", "admin"]);
  const deposits = await q<Row>(
    `select dp.*, u.username, o.order_no from deposits dp
     join users u on u.id = dp.user_id left join orders o on o.id = dp.order_id
     order by dp.created_at desc limit 200`,
  );
  return { deposits };
});

export const adminAdjustWallet = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ userId: z.string(), amountUsdt: z.number(), note: z.string().min(5).max(500) }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const staff = await requireAdmin();
    await txAdjustment(
      data.userId,
      Math.round(data.amountUsdt * 100),
      `Admin adjustment: ${data.note}`,
    );
    await audit(staff.id, "wallet.adjust", "user", data.userId, {
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
    await appContext();
    await requireStaff();
    const where = data.q ? `where lower(u.username) like ? or lower(u.email) like ?` : "";
    const like = `%${(data.q ?? "").toLowerCase()}%`;
    const users = await q<Row>(
      `select u.id, u.email, u.username, u.role, u.seller_status, u.seller_level, u.rating, u.total_sales,
              u.is_banned, u.wallet_frozen, u.created_at,
              coalesce(w.available_cents,0) available_cents, coalesce(w.pending_cents,0) pending_cents,
              coalesce(w.frozen_cents,0) frozen_cents
       from users u left join wallets w on w.user_id = u.id ${where} order by u.created_at desc limit 200`,
      data.q ? [like, like] : [],
    );
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
    await appContext();
    const staff = await requireAdmin();
    if (data.userId === staff.id && (data.action === "ban" || data.action === "set_role"))
      fail("You can't do that to your own account.");
    const target = await q1(`select id from users where id = ?`, [data.userId]);
    if (!target) fail("User not found.");
    switch (data.action) {
      case "ban":
        await run(`update users set is_banned = 1 where id = ?`, [data.userId]);
        await run(`delete from sessions where user_id = ?`, [data.userId]);
        break;
      case "unban":
        await run(`update users set is_banned = 0 where id = ?`, [data.userId]);
        break;
      case "freeze_wallet":
        await txSetFreeze(data.userId, true);
        break;
      case "unfreeze_wallet":
        await txSetFreeze(data.userId, false);
        break;
      case "set_role":
        if (!data.role) fail("Role required.");
        await run(`update users set role = ? where id = ?`, [data.role!, data.userId]);
        break;
      case "set_seller_level":
        if (!data.level) fail("Level required.");
        await run(`update users set seller_level = ? where id = ?`, [data.level!, data.userId]);
        break;
    }
    await audit(staff.id, `user.${data.action}`, "user", data.userId, {
      role: data.role,
      level: data.level,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Catalog management
// ---------------------------------------------------------------------------
export const adminListCategories = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff();
  const categories = await q<Row>(
    `select c.*, (select count(*) from products p where p.category_id = c.id and p.status = 'active') product_count
     from categories c order by c.sort`,
  );
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
    await appContext();
    const staff = await requireAdmin();
    if (data.categoryId) {
      await run(
        `update categories set name = ?, slug = ?, icon = ?, default_warranty_hours = ?, commission_pct = ?, risk_tier = ?, is_active = ? where id = ?`,
        [
          data.name,
          data.slug,
          data.icon ?? null,
          data.defaultWarrantyHours,
          data.commissionPct,
          data.riskTier,
          data.isActive ? 1 : 0,
          data.categoryId,
        ],
      );
    } else {
      if (await q1(`select 1 as x from categories where slug = ?`, [data.slug]))
        fail("Slug already exists.");
      await run(
        `insert into categories (id, name, slug, icon, sort, default_warranty_hours, commission_pct, risk_tier, is_active)
         values (?,?,?,?, (select coalesce(max(sort),0)+1 from categories), ?,?,?,?)`,
        [
          uid(),
          data.name,
          data.slug,
          data.icon ?? null,
          data.defaultWarrantyHours,
          data.commissionPct,
          data.riskTier,
          data.isActive ? 1 : 0,
        ],
      );
    }
    await audit(staff.id, "category.save", "category", data.categoryId ?? data.slug);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Settings + audit + moderation
// ---------------------------------------------------------------------------
export const getAdminSettings = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff();
  return { settings: (await q1<Row>(`select * from site_settings where id = 1`))! };
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
      announcement: z.string().max(300).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const staff = await requireAdmin();
    await run(
      `update site_settings set default_commission_pct = ?, withdrawal_fee_cents = ?, min_withdrawal_cents = ?,
         auto_confirm_hours = ?, payment_window_minutes = ?, maintenance_mode = ?, announcement = ? where id = 1`,
      [
        data.defaultCommissionPct,
        Math.round(data.withdrawalFeeUsdt * 100),
        Math.round(data.minWithdrawalUsdt * 100),
        data.autoConfirmHours,
        data.paymentWindowMinutes,
        data.maintenanceMode ? 1 : 0,
        data.announcement?.trim() || null,
      ],
    );
    await audit(staff.id, "settings.update", "site_settings", "1", data);
    return { ok: true };
  });

export const listAuditLogs = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireAdmin();
  const logs = await q<Row>(
    `select a.*, u.username as actor_name from audit_logs a left join users u on u.id = a.actor_id
     order by a.id desc limit 300`,
  );
  return { logs };
});

export const listFlaggedMessages = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff();
  const messages = await q<Row>(
    `select m.id, m.body, m.flag_reason, m.created_at, m.moderated_at, u.username as sender_name, m.conversation_id
     from messages m left join users u on u.id = m.sender_id
     where m.is_flagged = 1 order by case when m.moderated_at is null then 0 else 1 end, m.created_at desc limit 200`,
  );
  return { messages };
});

export const moderateMessage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ messageId: z.string(), action: z.enum(["dismiss", "remove"]) }))
  .handler(async ({ data }) => {
    await appContext();
    const staff = await requireStaff();
    if (data.action === "remove") {
      await run(
        `update messages set body = '[removed by moderator]', moderated_at = ?, moderated_by = ? where id = ?`,
        [now(), staff.id, data.messageId],
      );
    } else {
      await run(
        `update messages set is_flagged = 0, moderated_at = ?, moderated_by = ? where id = ?`,
        [now(), staff.id, data.messageId],
      );
    }
    await audit(staff.id, `message.${data.action}`, "message", data.messageId);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------
export const adminListCoupons = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff();
  const coupons = await q<Row>(`select * from coupons order by created_at desc limit 200`);
  return { coupons };
});

export const adminSaveCoupon = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      couponId: z.string().optional(),
      code: z
        .string()
        .min(2)
        .max(40)
        .regex(/^[A-Za-z0-9_-]+$/),
      pctOff: z.number().min(1).max(100),
      minTotalUsdt: z.number().min(0).max(100_000).default(0),
      maxUses: z.number().int().min(0).max(1_000_000).default(0),
      expiresInDays: z.number().int().min(0).max(365).default(0),
      isActive: z.boolean().default(true),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const staff = await requireAdmin();
    const expiresAt = data.expiresInDays > 0 ? now() + data.expiresInDays * 86_400_000 : null;
    if (data.couponId) {
      await run(
        `update coupons set code = ?, pct_off = ?, min_total_cents = ?, max_uses = ?, expires_at = ?, is_active = ? where id = ?`,
        [
          data.code.toUpperCase(),
          data.pctOff,
          Math.round(data.minTotalUsdt * 100),
          data.maxUses,
          expiresAt,
          data.isActive ? 1 : 0,
          data.couponId,
        ],
      );
    } else {
      if (await q1(`select 1 as x from coupons where lower(code) = lower(?)`, [data.code]))
        fail("A coupon with that code already exists.");
      await run(
        `insert into coupons (id, code, pct_off, min_total_cents, max_uses, expires_at, is_active, created_at)
         values (?,?,?,?,?,?,?,?)`,
        [
          uid(),
          data.code.toUpperCase(),
          data.pctOff,
          Math.round(data.minTotalUsdt * 100),
          data.maxUses,
          expiresAt,
          data.isActive ? 1 : 0,
          now(),
        ],
      );
    }
    await audit(staff.id, "coupon.save", "coupon", data.couponId ?? data.code);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Catalog items (games / brands / services) + seller suggestions
// ---------------------------------------------------------------------------
export const adminListItems = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff();
  const [items, maps, suggestions] = await Promise.all([
    q<{
      id: string;
      name: string;
      slug: string;
      is_active: number;
      sort: number;
      created_at: number;
    }>(`select * from catalog_items order by sort, name`),
    q<{ item_id: string; category_id: string }>(
      `select item_id, category_id from catalog_item_categories`,
    ),
    q<Row>(
      `select s.*, u.username from item_suggestions s join users u on u.id = s.user_id
       order by case s.status when 'pending' then 0 else 1 end, s.created_at desc limit 100`,
    ),
  ]);
  const byItem: Record<string, string[]> = {};
  for (const m of maps) (byItem[m.item_id] ??= []).push(m.category_id);
  return {
    items: items.map((i) => ({ ...i, categoryIds: byItem[i.id] ?? [] })),
    suggestions,
  };
});

export const adminSaveItem = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      itemId: z.string().optional(),
      name: z.string().min(2).max(80),
      isActive: z.boolean().default(true),
      categoryIds: z.array(z.string()).default([]),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const staff = await requireAdmin();
    const slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    let id = data.itemId;
    if (id) {
      await run(`update catalog_items set name = ?, is_active = ? where id = ?`, [
        data.name,
        data.isActive ? 1 : 0,
        id,
      ]);
      await run(`delete from catalog_item_categories where item_id = ?`, [id]);
    } else {
      if (await q1(`select 1 as x from catalog_items where slug = ?`, [slug]))
        fail("An item with that name already exists.");
      id = uid();
      await run(
        `insert into catalog_items (id, name, slug, is_active, sort, created_at)
         values (?,?,?,?, (select coalesce(max(sort),0)+1 from catalog_items), ?)`,
        [id, data.name, slug, data.isActive ? 1 : 0, now()],
      );
    }
    for (const catId of data.categoryIds) {
      await run(
        `insert into catalog_item_categories (item_id, category_id) values (?,?) on conflict (item_id, category_id) do nothing`,
        [id!, catId],
      );
    }
    await audit(staff.id, "catalog_item.save", "catalog_item", id);
    return { itemId: id };
  });

export const reviewItemSuggestion = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      suggestionId: z.string(),
      approve: z.boolean(),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const staff = await requireAdmin();
    const s = await q1<{ id: string; user_id: string; name: string; status: string }>(
      `select * from item_suggestions where id = ?`,
      [data.suggestionId],
    );
    if (!s || s.status !== "pending") fail("Suggestion not found or already reviewed.");
    const status = data.approve ? "approved" : "rejected";
    await run(
      `update item_suggestions set status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = ? where id = ?`,
      [status, data.note ?? null, staff.id, now(), data.suggestionId],
    );
    if (data.approve) {
      const slug = s!.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      if (!(await q1(`select 1 as x from catalog_items where slug = ?`, [slug]))) {
        await run(
          `insert into catalog_items (id, name, slug, sort, created_at)
           values (?,?,?, (select coalesce(max(sort),0)+1 from catalog_items), ?)`,
          [uid(), s!.name, slug, now()],
        );
      }
    }
    await notify(
      s!.user_id,
      "item_suggestion",
      data.approve
        ? `"${s!.name}" was added to the catalog 🎉`
        : `Suggestion "${s!.name}" rejected`,
      data.note ?? (data.approve ? "You can now list products under it." : ""),
      "/seller/new-product",
    );
    await audit(staff.id, `item_suggestion.${status}`, "item_suggestion", data.suggestionId);
    return { ok: true };
  });
