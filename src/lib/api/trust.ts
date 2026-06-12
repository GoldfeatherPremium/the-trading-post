import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { audit, fail, notify, now, uid } from "../server/core.server";
import { requireSeller, requireStaff, requireUser } from "../server/auth.server";
import {
  LEVEL_META,
  TIER_META,
  getTrustHistory,
  recomputeSellerTrust,
  type VerificationTier,
} from "../server/trust.server";

export interface SellerVerification {
  id: string;
  user_id: string;
  username?: string;
  tier_requested: VerificationTier;
  legal_name: string;
  country: string;
  business_name: string | null;
  business_registration: string | null;
  id_doc_ref: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  admin_note: string | null;
  created_at: number;
  reviewed_at: number | null;
}

export const trustMetadata = createServerFn({ method: "GET" }).handler(async () => {
  return { tiers: TIER_META, levels: LEVEL_META };
});

export const applyForVerification = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      tierRequested: z.enum(["verified", "business", "premium"]),
      legalName: z.string().trim().min(2).max(120),
      country: z.string().trim().min(2).max(80),
      businessName: z.string().trim().max(160).optional(),
      businessRegistration: z.string().trim().max(120).optional(),
      idDocRef: z.string().trim().max(200).optional(),
      notes: z.string().trim().max(2000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const open = await q1<{ id: string }>(
      `select id from seller_verifications where user_id = ? and status = 'pending'`,
      [user.id],
    );
    if (open) fail("You already have a pending verification application.");
    if (
      (data.tierRequested === "business" || data.tierRequested === "premium") &&
      !data.businessName
    ) {
      fail("Business name is required for business / premium verification.");
    }
    const id = uid();
    await run(
      `insert into seller_verifications
         (id, user_id, tier_requested, legal_name, country, business_name, business_registration, id_doc_ref, notes, created_at)
       values (?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        user.id,
        data.tierRequested,
        data.legalName,
        data.country,
        data.businessName ?? null,
        data.businessRegistration ?? null,
        data.idDocRef ?? null,
        data.notes ?? null,
        now(),
      ],
    );
    await audit(user.id, "verification.apply", "seller_verification", id);
    return { ok: true, id };
  });

export const getMyVerification = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireUser();
  const latest = await q1<SellerVerification>(
    `select * from seller_verifications where user_id = ? order by created_at desc limit 1`,
    [user.id],
  );
  return {
    tier: user.role === "buyer" ? "unverified" : undefined,
    application: latest ?? null,
  };
});

export const listVerifications = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    await requireStaff(["admin", "support"]);
    const rows = await q<SellerVerification>(
      `select v.*, u.username from seller_verifications v
         join users u on u.id = v.user_id
         ${data.status === "all" ? "" : "where v.status = ?"}
         order by v.created_at desc limit 200`,
      data.status === "all" ? [] : [data.status],
    );
    return { rows };
  });

export const reviewVerification = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string(),
      decision: z.enum(["approved", "rejected"]),
      adminNote: z.string().trim().max(1000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const staff = await requireStaff(["admin", "support"]);
    const app = await q1<SellerVerification>(
      `select * from seller_verifications where id = ?`,
      [data.id],
    );
    if (!app) fail("Application not found.");
    if (app!.status !== "pending") fail("This application was already reviewed.");

    await run(
      `update seller_verifications set status = ?, reviewed_by = ?, admin_note = ?, reviewed_at = ? where id = ?`,
      [data.decision, staff.id, data.adminNote ?? null, now(), data.id],
    );

    if (data.decision === "approved") {
      await run(`update users set verification_tier = ? where id = ?`, [
        app!.tier_requested,
        app!.user_id,
      ]);
      await recomputeSellerTrust(app!.user_id);
      await notify(
        app!.user_id,
        "verification_approved",
        "Verification approved",
        `You are now ${TIER_META[app!.tier_requested].label.toLowerCase()} on X-VAULT.`,
        `/seller/verification`,
      );
    } else {
      await notify(
        app!.user_id,
        "verification_rejected",
        "Verification not approved",
        data.adminNote ?? "Please review feedback and reapply.",
        `/seller/verification`,
      );
    }
    await audit(staff.id, `verification.${data.decision}`, "seller_verification", data.id);
    return { ok: true };
  });

/**
 * Public, lightweight trust info for a seller by id — used by product pages
 * that don't already join the trust columns.
 */
export const getSellerTrust = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const u = await q1<{
      verification_tier: VerificationTier;
      trust_score: number;
      seller_level: number;
      rating: number;
      rating_count: number;
      total_sales: number;
      completion_rate: number;
    }>(
      `select verification_tier, trust_score, seller_level, rating, rating_count, total_sales, completion_rate
         from users where id = ?`,
      [data.userId],
    );
    return { trust: u ?? null };
  });

/** Public trust score history for a seller — powers the storefront sparkline. */
export const getSellerTrustHistory = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string(), days: z.number().int().min(7).max(180).default(30) }))
  .handler(async ({ data }) => {
    await appContext();
    const points = await getTrustHistory(data.userId, data.days);
    return { points };
  });
