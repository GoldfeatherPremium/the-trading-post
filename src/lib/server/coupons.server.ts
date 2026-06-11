import { q1 } from "./db.server";
import { fail, now } from "./core.server";

export interface CouponRow {
  id: string;
  code: string;
  pct_off: number;
  min_total_cents: number;
  max_uses: number;
  used_count: number;
  expires_at: number | null;
  is_active: number;
}

export async function validateCoupon(code: string, totalCents: number): Promise<CouponRow> {
  const c = await q1<CouponRow>(`select * from coupons where lower(code) = lower(?)`, [
    code.trim(),
  ]);
  if (!c || !c.is_active) fail("Invalid coupon code.");
  if (c!.expires_at && c!.expires_at < now()) fail("This coupon has expired.");
  if (c!.max_uses > 0 && c!.used_count >= c!.max_uses) fail("This coupon has been fully redeemed.");
  if (totalCents < c!.min_total_cents)
    fail(`This coupon requires a minimum order of ${(c!.min_total_cents / 100).toFixed(2)} USDT.`);
  return c!;
}
