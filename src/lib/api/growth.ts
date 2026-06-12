import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { requireUser } from "../server/auth.server";
import { fail, now, uid } from "../server/core.server";
import { txAdjustment } from "../server/money.server";

// ---------------------------------------------------------------------------
// Affiliate / Referrals
// ---------------------------------------------------------------------------

function genCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export const getMyReferral = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireUser();
  let r = await q1<{
    id: string;
    code: string;
    commission_pct: number;
    click_count: number;
    signup_count: number;
    purchase_count: number;
    earnings_cents: number;
    created_at: number;
  }>(`select id, code, commission_pct, click_count, signup_count, purchase_count, earnings_cents, created_at
        from referrals where owner_user_id = ?`, [user.id]);
  if (!r) {
    const id = uid();
    let code = genCode();
    // ensure uniqueness (tiny corpus, very rare collision)
    for (let i = 0; i < 5; i++) {
      const exists = await q1<{ id: string }>(`select id from referrals where code = ?`, [code]);
      if (!exists) break;
      code = genCode();
    }
    const setting = await q1<{ default_commission: string }>(
      `select value as default_commission from site_settings where key = 'affiliate_pct'`,
    ).catch(() => undefined);
    const pct = setting ? Number(setting.default_commission) : 5;
    await run(
      `insert into referrals (id, owner_user_id, code, commission_pct, created_at) values (?,?,?,?,?)`,
      [id, user.id, code, pct, now()],
    );
    r = {
      id,
      code,
      commission_pct: pct,
      click_count: 0,
      signup_count: 0,
      purchase_count: 0,
      earnings_cents: 0,
      created_at: now(),
    };
  }
  const recentClicks = await q<{ created_at: number; country: string | null }>(
    `select created_at, country from referral_clicks where referral_id = ? order by created_at desc limit 50`,
    [r.id],
  );
  return { referral: r, recentClicks };
});

/** Attribute the currently-signed-in user to a referral code (signup hook). */
export const attributeReferral = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: z.string().trim().min(3).max(16) }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const r = await q1<{ id: string; owner_user_id: string }>(
      `select id, owner_user_id from referrals where code = ?`,
      [data.code.toUpperCase()],
    );
    if (!r) return { ok: false };
    if (r.owner_user_id === user.id) return { ok: false };
    const existing = await q1(`select user_id from referral_attributions where user_id = ?`, [
      user.id,
    ]);
    if (existing) return { ok: false };
    await run(
      `insert into referral_attributions (user_id, referral_id, attributed_at) values (?,?,?)`,
      [user.id, r.id, now()],
    );
    await run(`update referrals set signup_count = signup_count + 1 where id = ?`, [r.id]);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Buyer Loyalty — tier derived from lifetime spend + orders + referrals
// ---------------------------------------------------------------------------
const LOYALTY_TIERS = [
  { id: "bronze", label: "Bronze", min_spend_cents: 0, perk: "Welcome bonus on first purchase" },
  { id: "silver", label: "Silver", min_spend_cents: 50_000, perk: "5% off coupon every month" },
  { id: "gold", label: "Gold", min_spend_cents: 250_000, perk: "Priority support + 7% off" },
  { id: "platinum", label: "Platinum", min_spend_cents: 1_000_000, perk: "Dedicated support + 10% off" },
] as const;

export const getMyLoyalty = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireUser();
  const stats = await q1<{ spend: number; orders: number }>(
    `select coalesce(sum(total_cents),0) as spend, count(*) as orders
       from orders where buyer_id = ? and status in ('released','completed','delivered')`,
    [user.id],
  );
  const refs = await q1<{ c: number }>(
    `select count(*) c from referral_attributions a join referrals r on r.id = a.referral_id
       where r.owner_user_id = ?`,
    [user.id],
  );
  const spend = stats?.spend ?? 0;
  let tierIdx = 0;
  for (let i = 0; i < LOYALTY_TIERS.length; i++) {
    if (spend >= LOYALTY_TIERS[i].min_spend_cents) tierIdx = i;
  }
  const tier = LOYALTY_TIERS[Math.max(0, tierIdx)];
  const next = LOYALTY_TIERS[Math.max(0, tierIdx) + 1] ?? null;
  return {
    tier,
    nextTier: next,
    spend_cents: spend,
    orders: stats?.orders ?? 0,
    referrals: refs?.c ?? 0,
    progressToNext: next
      ? Math.min(1, (spend - tier.min_spend_cents) / (next.min_spend_cents - tier.min_spend_cents))
      : 1,
    allTiers: LOYALTY_TIERS,
  };
});
