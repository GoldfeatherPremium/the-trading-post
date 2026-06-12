/**
 * Deterministic fraud-rules engine. Runs on every payment to score order risk
 * from velocity / refund / dispute / account-age signals. High-risk orders are
 * auto-held (escrow_status = 'on_hold') so staff can review before release.
 *
 * Complementary to aiRiskScoreUser (qualitative, on-demand) — this is fast,
 * predictable, and runs in the payment hot path.
 */
import { q1, run } from "./db.server";
import { now } from "./core.server";

export type RiskBand = "low" | "medium" | "high";

export interface RiskAssessment {
  score: number;
  band: RiskBand;
  reasons: string[];
  action: "allow" | "hold";
}

const HOLD_THRESHOLD = 70;

interface BuyerContext {
  buyerId: string;
  sellerId: string;
  totalCents: number;
}

export async function assessOrderRisk(ctx: BuyerContext): Promise<RiskAssessment> {
  const reasons: string[] = [];
  let score = 0;
  const t = now();
  const h24 = t - 24 * 3_600_000;
  const h1 = t - 3_600_000;
  const d30 = t - 30 * 86_400_000;

  const buyer = await q1<{ created_at: number; is_banned: number; trust_score: number | null }>(
    `select created_at, is_banned, trust_score from users where id = ?`,
    [ctx.buyerId],
  );
  if (buyer?.is_banned) {
    reasons.push("Buyer account is banned");
    score += 60;
  }

  const ageMs = t - (buyer?.created_at ?? t);
  const ageHours = ageMs / 3_600_000;
  if (ageHours < 1) {
    reasons.push("Account younger than 1 hour");
    score += 30;
  } else if (ageHours < 24 && ctx.totalCents > 5_000) {
    reasons.push("New account spending >$50");
    score += 25;
  } else if (ageHours < 72 && ctx.totalCents > 25_000) {
    reasons.push("Account <3 days old with high-value order");
    score += 20;
  }

  const ordersLastHour = await q1<{ c: number }>(
    `select count(*) c from orders where buyer_id = ? and created_at > ?`,
    [ctx.buyerId, h1],
  );
  if ((ordersLastHour?.c ?? 0) >= 5) {
    reasons.push(`${ordersLastHour!.c} orders in the last hour`);
    score += 25;
  }

  const orders24 = await q1<{ c: number; gmv: number }>(
    `select count(*) c, coalesce(sum(total_cents),0) gmv from orders where buyer_id = ? and created_at > ?`,
    [ctx.buyerId, h24],
  );
  if ((orders24?.c ?? 0) >= 10) {
    reasons.push(`${orders24!.c} orders in the last 24h`);
    score += 20;
  }
  if ((orders24?.gmv ?? 0) > 100_000) {
    reasons.push("Buyer spent >$1000 in 24h");
    score += 15;
  }

  const sameSeller1h = await q1<{ c: number }>(
    `select count(*) c from orders where buyer_id = ? and seller_id = ? and created_at > ?`,
    [ctx.buyerId, ctx.sellerId, h1],
  );
  if ((sameSeller1h?.c ?? 0) >= 3) {
    reasons.push(`${sameSeller1h!.c} orders to the same seller within 1h`);
    score += 15;
  }

  const disputes30 = await q1<{ c: number }>(
    `select count(*) c from disputes where opened_by = ? and created_at > ?`,
    [ctx.buyerId, d30],
  );
  if ((disputes30?.c ?? 0) >= 2) {
    reasons.push(`${disputes30!.c} disputes opened in 30 days`);
    score += 20;
  }

  const lifetime = await q1<{ total: number; refunded: number }>(
    `select count(*) total,
            sum(case when status in ('refunded','cancelled') then 1 else 0 end) refunded
       from orders where buyer_id = ?`,
    [ctx.buyerId],
  );
  if ((lifetime?.total ?? 0) >= 5) {
    const rate = (lifetime!.refunded ?? 0) / lifetime!.total;
    if (rate >= 0.3) {
      reasons.push(`${Math.round(rate * 100)}% lifetime refund/cancel rate`);
      score += 25;
    }
  }

  // chargeback proxy: unique sellers hit in 24h
  const uniqueSellers = await q1<{ c: number }>(
    `select count(distinct seller_id) c from orders where buyer_id = ? and created_at > ?`,
    [ctx.buyerId, h24],
  );
  if ((uniqueSellers?.c ?? 0) >= 6) {
    reasons.push(`Orders across ${uniqueSellers!.c} sellers in 24h`);
    score += 10;
  }

  score = Math.min(100, score);
  const band: RiskBand = score >= HOLD_THRESHOLD ? "high" : score >= 35 ? "medium" : "low";
  const action: "allow" | "hold" = band === "high" ? "hold" : "allow";
  return { score, band, reasons: reasons.length ? reasons : ["No risk signals"], action };
}

export async function recordRiskEvent(opts: {
  userId: string;
  sellerId: string;
  orderId: string;
  kind: string;
  assessment: RiskAssessment;
}): Promise<void> {
  await run(
    `insert into risk_events (user_id, seller_id, order_id, kind, score, band, reasons, action, created_at)
     values (?,?,?,?,?,?,?,?,?)`,
    [
      opts.userId,
      opts.sellerId,
      opts.orderId,
      opts.kind,
      opts.assessment.score,
      opts.assessment.band,
      JSON.stringify(opts.assessment.reasons),
      opts.assessment.action,
      now(),
    ],
  );
}

export { HOLD_THRESHOLD };
