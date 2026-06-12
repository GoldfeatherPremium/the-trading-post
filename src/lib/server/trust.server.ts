/**
 * Seller Trust System
 *
 * Computes a 0-100 trust score and an automatic level (Bronze → Diamond)
 * derived from real marketplace performance. Verification tier is a separate,
 * admin-approved attribute.
 *
 * Scoring (weights sum to 100):
 *   - Sales volume         25  (log scale, saturates at ~5000 lifetime sales)
 *   - Completion rate      15  (% of paid orders not cancelled/refunded)
 *   - Rating quality       20  (avg rating * review count weight)
 *   - Refund rate          15  (lower = better)
 *   - Dispute rate         15  (lower = better)
 *   - Delivery speed       10  (faster than category SLA = better)
 * Verification tier adds a bonus on top (capped at 100):
 *   verified +5, business +10, premium +15
 */

import { q1, run } from "./db.server";

export type VerificationTier = "unverified" | "verified" | "business" | "premium";
export type SellerLevel = 1 | 2 | 3 | 4 | 5;

export const TIER_META: Record<
  VerificationTier,
  { label: string; bonus: number; cls: string }
> = {
  unverified: { label: "Unverified", bonus: 0, cls: "bg-muted text-muted-foreground" },
  verified: { label: "Verified", bonus: 5, cls: "bg-blue-500/15 text-blue-400 border-blue-500/40" },
  business: {
    label: "Business",
    bonus: 10,
    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  },
  premium: {
    label: "Premium",
    bonus: 15,
    cls: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  },
};

export const LEVEL_META: Record<
  SellerLevel,
  { label: string; cls: string; minScore: number; minSales: number }
> = {
  1: { label: "Bronze", cls: "bg-orange-700/20 text-orange-400", minScore: 0, minSales: 0 },
  2: { label: "Silver", cls: "bg-slate-400/20 text-slate-300", minScore: 55, minSales: 25 },
  3: { label: "Gold", cls: "bg-yellow-500/20 text-yellow-400", minScore: 70, minSales: 150 },
  4: { label: "Platinum", cls: "bg-cyan-400/20 text-cyan-300", minScore: 82, minSales: 750 },
  5: { label: "Diamond", cls: "bg-fuchsia-500/20 text-fuchsia-300", minScore: 92, minSales: 2500 },
};

export function levelFromScore(score: number, totalSales: number): SellerLevel {
  for (const lvl of [5, 4, 3, 2] as const) {
    const m = LEVEL_META[lvl];
    if (score >= m.minScore && totalSales >= m.minSales) return lvl;
  }
  return 1;
}

interface SellerAggregates {
  total_sales: number;
  rating: number;
  rating_count: number;
  completion_rate: number;
  refund_count: number;
  dispute_count: number;
  avg_delivery_minutes: number;
  verification_tier: VerificationTier;
}

export function scoreFromAggregates(a: SellerAggregates): number {
  // Sales: log scale, saturates near 5000
  const sales = Math.min(25, (Math.log10(a.total_sales + 1) / Math.log10(5001)) * 25);

  // Completion: 100% → 15, 90% → 10, 70% → 0
  const completion = Math.max(0, Math.min(15, ((a.completion_rate - 70) / 30) * 15));

  // Rating: rating/5 * weight, scaled by review confidence (saturates at ~50 reviews)
  const conf = a.rating_count / (a.rating_count + 25);
  const rating = (a.rating / 5) * 20 * conf;

  // Refund rate: refunds vs total_sales. 0% → 15, 5% → 7.5, 10%+ → 0
  const refundRate = a.total_sales > 0 ? a.refund_count / a.total_sales : 0;
  const refund = Math.max(0, 15 - refundRate * 150);

  // Dispute rate: 0% → 15, 2% → 7.5, 4%+ → 0
  const disputeRate = a.total_sales > 0 ? a.dispute_count / a.total_sales : 0;
  const dispute = Math.max(0, 15 - disputeRate * 375);

  // Delivery: faster than 60min average → full 10. 240min → 0.
  const delivery =
    a.avg_delivery_minutes === 0
      ? 5
      : Math.max(0, Math.min(10, 10 - ((a.avg_delivery_minutes - 60) / 180) * 10));

  const base = sales + completion + rating + refund + dispute + delivery;
  const tierBonus = TIER_META[a.verification_tier].bonus;
  return Math.max(0, Math.min(100, Math.round((base + tierBonus) * 10) / 10));
}

/**
 * Recompute and persist all derived trust metrics for a seller.
 * Safe to call anywhere after order/review state changes.
 */
export async function recomputeSellerTrust(userId: string): Promise<void> {
  const stats = await q1<{
    total_sales: number;
    refund_count: number;
    dispute_count: number;
    avg_delivery: number | null;
    completed: number;
    total_paid: number;
    rating: number;
    rating_count: number;
    verification_tier: VerificationTier;
  }>(
    `select
       (select count(*) from orders where seller_id = ? and status in ('completed','released')) as total_sales,
       (select count(*) from orders where seller_id = ? and status = 'refunded') as refund_count,
       (select count(*) from disputes d join orders o on o.id = d.order_id where o.seller_id = ?) as dispute_count,
       (select avg(case when delivered_at is not null and paid_at is not null
                        then (delivered_at - paid_at) / 60000.0 end)
          from orders where seller_id = ? and delivered_at is not null) as avg_delivery,
       (select count(*) from orders where seller_id = ? and status in ('completed','released','delivered')) as completed,
       (select count(*) from orders where seller_id = ? and status in ('paid','delivering','delivered','completed','released','refunded','cancelled')) as total_paid,
       coalesce((select avg(rating) from reviews where seller_id = ?), 0) as rating,
       (select count(*) from reviews where seller_id = ?) as rating_count,
       (select verification_tier from users where id = ?) as verification_tier
    `,
    [userId, userId, userId, userId, userId, userId, userId, userId, userId],
  );
  if (!stats) return;

  const completionRate =
    stats.total_paid > 0 ? Math.round((stats.completed / stats.total_paid) * 1000) / 10 : 100;
  const avgDelivery = stats.avg_delivery == null ? 0 : Math.round(Number(stats.avg_delivery));
  const ratingAvg = Math.round(Number(stats.rating) * 100) / 100;

  const score = scoreFromAggregates({
    total_sales: stats.total_sales,
    rating: ratingAvg,
    rating_count: stats.rating_count,
    completion_rate: completionRate,
    refund_count: stats.refund_count,
    dispute_count: stats.dispute_count,
    avg_delivery_minutes: avgDelivery,
    verification_tier: stats.verification_tier ?? "unverified",
  });

  const level = levelFromScore(score, stats.total_sales);

  await run(
    `update users set
       total_sales = ?, rating = ?, rating_count = ?, completion_rate = ?,
       refund_count = ?, dispute_count = ?, avg_delivery_minutes = ?,
       trust_score = ?, seller_level = ?
     where id = ?`,
    [
      stats.total_sales,
      ratingAvg,
      stats.rating_count,
      completionRate,
      stats.refund_count,
      stats.dispute_count,
      avgDelivery,
      score,
      level,
      userId,
    ],
  );

  // Append a history snapshot at most once per UTC day, and only when the
  // score actually moved. Cheap, safe, and powers the trust trend sparkline.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const sinceMidnight = dayStart.getTime();
  const last = await q1<{ score: number; captured_at: number }>(
    `select score, captured_at from seller_trust_history where user_id = ? order by captured_at desc limit 1`,
    [userId],
  );
  const changed = !last || Math.abs(Number(last.score) - score) >= 0.1;
  const newDay = !last || Number(last.captured_at) < sinceMidnight;
  if (changed || newDay) {
    await run(
      `insert into seller_trust_history (user_id, score, seller_level, total_sales, captured_at) values (?,?,?,?,?)`,
      [userId, score, level, stats.total_sales, Date.now()],
    ).catch(() => {});
  }
}

/** Return up to `days` of recent trust score samples (oldest first). */
export async function getTrustHistory(userId: string, days = 30) {
  const since = Date.now() - days * 86_400_000;
  const { q } = await import("./db.server");
  const items = await q<{ score: number; captured_at: number; seller_level: number }>(
    `select score, captured_at, seller_level from seller_trust_history
       where user_id = ? and captured_at >= ?
       order by captured_at asc limit 200`,
    [userId, since],
  );
  return items.map((r) => ({
    score: Number(r.score),
    level: Number(r.seller_level),
    at: Number(r.captured_at),
  }));
}
