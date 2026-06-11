import { q1, run, tx } from "./db.server";
import { fail, now } from "./core.server";

export interface Wallet {
  user_id: string;
  available_cents: number;
  pending_cents: number;
  frozen_cents: number;
}

export async function getWallet(userId: string): Promise<Wallet> {
  let w = await q1<Wallet>(`select * from wallets where user_id = ?`, [userId]);
  if (!w) {
    await run(`insert into wallets (user_id) values (?) on conflict (user_id) do nothing`, [
      userId,
    ]);
    w = await q1<Wallet>(`select * from wallets where user_id = ?`, [userId]);
  }
  return w!;
}

async function writeLedger(
  userId: string,
  orderId: string | null,
  type: string,
  amountCents: number,
  note?: string,
) {
  const w = await getWallet(userId);
  const balanceAfter = w.available_cents + w.pending_cents;
  await run(
    `insert into wallet_ledger (user_id, order_id, type, amount_cents, balance_after_cents, note, created_at)
     values (?,?,?,?,?,?,?)`,
    [userId, orderId, type, amountCents, balanceAfter, note ?? null, now()],
  );
}

/**
 * All mutations below run inside tx() — a real BEGIN/COMMIT on Postgres
 * (Supabase) and a mutex-serialized transaction on SQLite — so balance
 * read-modify-write is atomic.
 */

/** Payment confirmed: seller's net amount enters escrow (pending). */
export function txEscrowHold(orderId: string, sellerId: string, netCents: number, orderNo: string) {
  return tx(async () => {
    await getWallet(sellerId);
    await run(`update wallets set pending_cents = pending_cents + ? where user_id = ?`, [
      netCents,
      sellerId,
    ]);
    await writeLedger(sellerId, orderId, "escrow_hold", netCents, `Escrow hold for ${orderNo}`);
  });
}

/** Warranty passed: escrow released to seller's available balance. */
export function txEscrowRelease(
  orderId: string,
  sellerId: string,
  netCents: number,
  commissionCents: number,
  orderNo: string,
) {
  return tx(async () => {
    const w = await getWallet(sellerId);
    if (w.pending_cents < netCents) fail(`Escrow inconsistency on order ${orderNo}`);
    await run(
      `update wallets set pending_cents = pending_cents - ?, available_cents = available_cents + ? where user_id = ?`,
      [netCents, netCents, sellerId],
    );
    await writeLedger(
      sellerId,
      orderId,
      "escrow_release",
      netCents,
      `Escrow released for ${orderNo}`,
    );
    await writeLedger(
      sellerId,
      orderId,
      "commission",
      -commissionCents,
      `Platform commission for ${orderNo}`,
    );
  });
}

/**
 * Refund (full or partial). The original escrow hold (seller's net) leaves
 * pending; the refunded amount is credited to the buyer's available balance;
 * anything the seller keeps moves to their available balance.
 */
export function txRefund(
  orderId: string,
  sellerId: string,
  buyerId: string,
  refundCents: number,
  originalNetCents: number,
  sellerKeepNetCents: number,
  orderNo: string,
) {
  return tx(async () => {
    const w = await getWallet(sellerId);
    if (w.pending_cents < originalNetCents) fail(`Escrow inconsistency on order ${orderNo}`);
    await run(`update wallets set pending_cents = pending_cents - ? where user_id = ?`, [
      originalNetCents,
      sellerId,
    ]);
    await writeLedger(
      sellerId,
      orderId,
      "refund",
      -originalNetCents,
      `Escrow reversed for ${orderNo}`,
    );
    if (sellerKeepNetCents > 0) {
      await run(`update wallets set available_cents = available_cents + ? where user_id = ?`, [
        sellerKeepNetCents,
        sellerId,
      ]);
      await writeLedger(
        sellerId,
        orderId,
        "escrow_release",
        sellerKeepNetCents,
        `Partial release for ${orderNo}`,
      );
    }
    if (refundCents > 0) {
      await getWallet(buyerId);
      await run(`update wallets set available_cents = available_cents + ? where user_id = ?`, [
        refundCents,
        buyerId,
      ]);
      await writeLedger(buyerId, orderId, "refund", refundCents, `Refund for ${orderNo}`);
    }
  });
}

/** Seller requests payout: amount + fee leaves available immediately. */
export function txWithdrawalHold(
  userId: string,
  amountCents: number,
  feeCents: number,
  withdrawalId: string,
) {
  return tx(async () => {
    const w = await getWallet(userId);
    if (w.available_cents < amountCents + feeCents) fail("Insufficient available balance.");
    await run(`update wallets set available_cents = available_cents - ? where user_id = ?`, [
      amountCents + feeCents,
      userId,
    ]);
    await writeLedger(
      userId,
      null,
      "withdrawal",
      -(amountCents + feeCents),
      `Withdrawal ${withdrawalId} (incl. fee)`,
    );
  });
}

/** Rejected withdrawal: money returns to available. */
export function txWithdrawalReversal(
  userId: string,
  amountCents: number,
  feeCents: number,
  withdrawalId: string,
) {
  return tx(async () => {
    await getWallet(userId);
    await run(`update wallets set available_cents = available_cents + ? where user_id = ?`, [
      amountCents + feeCents,
      userId,
    ]);
    await writeLedger(
      userId,
      null,
      "withdrawal_reversal",
      amountCents + feeCents,
      `Withdrawal ${withdrawalId} rejected`,
    );
  });
}

/** Admin manual adjustment (audited at the call site). */
export function txAdjustment(userId: string, amountCents: number, note: string) {
  return tx(async () => {
    const w = await getWallet(userId);
    if (w.available_cents + amountCents < 0) fail("Adjustment would make balance negative.");
    await run(`update wallets set available_cents = available_cents + ? where user_id = ?`, [
      amountCents,
      userId,
    ]);
    await writeLedger(userId, null, "adjustment", amountCents, note);
  });
}

/** Freeze / unfreeze a user's entire available balance (dispute or fraud hold). */
export function txSetFreeze(userId: string, freeze: boolean) {
  return tx(async () => {
    const w = await getWallet(userId);
    if (freeze) {
      await run(
        `update wallets set frozen_cents = frozen_cents + available_cents, available_cents = 0 where user_id = ?`,
        [userId],
      );
      await writeLedger(userId, null, "adjustment", -w.available_cents, "Wallet frozen by staff");
    } else {
      await run(
        `update wallets set available_cents = available_cents + frozen_cents, frozen_cents = 0 where user_id = ?`,
        [userId],
      );
      await writeLedger(userId, null, "adjustment", w.frozen_cents, "Wallet unfrozen by staff");
    }
    await run(`update users set wallet_frozen = ? where id = ?`, [freeze ? 1 : 0, userId]);
  });
}
