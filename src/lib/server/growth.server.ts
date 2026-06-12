import { q1, run } from "./db.server";
import { now } from "./core.server";
import { txAdjustment } from "./money.server";

/** Public: record a referral click (called from /r/$code redirect serverFn). */
export async function recordReferralClick(
  code: string,
  ua: string | null,
  country: string | null,
): Promise<{ ok: boolean; refId: string | null }> {
  const r = await q1<{ id: string }>(`select id from referrals where code = ?`, [code]);
  if (!r) return { ok: false, refId: null };
  await run(
    `insert into referral_clicks (referral_id, fingerprint, user_agent, country, created_at) values (?,?,?,?,?)`,
    [r.id, null, (ua ?? "").slice(0, 200), country, now()],
  );
  await run(`update referrals set click_count = click_count + 1 where id = ?`, [r.id]);
  return { ok: true, refId: r.id };
}

/** Credit referrer wallet when attributed buyer's order is released. Idempotent. */
export async function maybePayoutReferralForOrder(
  buyerId: string,
  orderId: string,
  orderTotalCents: number,
): Promise<void> {
  const attr = await q1<{ referral_id: string }>(
    `select referral_id from referral_attributions where user_id = ?`,
    [buyerId],
  );
  if (!attr) return;
  const ref = await q1<{ id: string; owner_user_id: string; commission_pct: number }>(
    `select id, owner_user_id, commission_pct from referrals where id = ?`,
    [attr.referral_id],
  );
  if (!ref) return;
  const already = await q1(
    `select 1 from wallet_ledger where user_id = ? and ref_id = ? and kind = 'adjustment'`,
    [ref.owner_user_id, orderId],
  );
  if (already) return;
  const payout = Math.floor((orderTotalCents * ref.commission_pct) / 100);
  if (payout <= 0) return;
  await txAdjustment(ref.owner_user_id, payout, `Affiliate commission · ${orderId}`);
  await run(
    `update referrals set purchase_count = purchase_count + 1, earnings_cents = earnings_cents + ? where id = ?`,
    [payout, ref.id],
  );
}
