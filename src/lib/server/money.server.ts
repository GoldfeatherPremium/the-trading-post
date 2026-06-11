import { db } from "./db.server";
import { fail, now } from "./core.server";

export interface Wallet {
  user_id: string;
  available_cents: number;
  pending_cents: number;
  frozen_cents: number;
}

export function getWallet(userId: string): Wallet {
  const d = db();
  let w = d.prepare(`select * from wallets where user_id = ?`).get(userId) as Wallet | undefined;
  if (!w) {
    d.prepare(`insert or ignore into wallets (user_id) values (?)`).run(userId);
    w = d.prepare(`select * from wallets where user_id = ?`).get(userId) as Wallet;
  }
  return w;
}

function writeLedger(
  userId: string,
  orderId: string | null,
  type: string,
  amountCents: number,
  note?: string,
) {
  const w = getWallet(userId);
  const balanceAfter = w.available_cents + w.pending_cents;
  db()
    .prepare(
      `insert into wallet_ledger (user_id, order_id, type, amount_cents, balance_after_cents, note, created_at)
       values (?,?,?,?,?,?,?)`,
    )
    .run(userId, orderId, type, amountCents, balanceAfter, note ?? null, now());
}

/**
 * All mutations below run inside better-sqlite3 transactions; SQLite serializes
 * writers, so balance read-modify-write here is atomic — the equivalent of the
 * spec's "Postgres functions with row locks".
 */

/** Payment confirmed: seller's net amount enters escrow (pending). */
export function txEscrowHold(orderId: string, sellerId: string, netCents: number, orderNo: string) {
  const d = db();
  d.transaction(() => {
    getWallet(sellerId);
    d.prepare(`update wallets set pending_cents = pending_cents + ? where user_id = ?`).run(
      netCents,
      sellerId,
    );
    writeLedger(sellerId, orderId, "escrow_hold", netCents, `Escrow hold for ${orderNo}`);
  })();
}

/** Warranty passed: escrow released to seller's available balance. */
export function txEscrowRelease(
  orderId: string,
  sellerId: string,
  netCents: number,
  commissionCents: number,
  orderNo: string,
) {
  const d = db();
  d.transaction(() => {
    const w = getWallet(sellerId);
    if (w.pending_cents < netCents) fail(`Escrow inconsistency on order ${orderNo}`);
    d.prepare(
      `update wallets set pending_cents = pending_cents - ?, available_cents = available_cents + ? where user_id = ?`,
    ).run(netCents, netCents, sellerId);
    writeLedger(sellerId, orderId, "escrow_release", netCents, `Escrow released for ${orderNo}`);
    writeLedger(
      sellerId,
      orderId,
      "commission",
      -commissionCents,
      `Platform commission for ${orderNo}`,
    );
  })();
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
  const d = db();
  d.transaction(() => {
    const w = getWallet(sellerId);
    if (w.pending_cents < originalNetCents) fail(`Escrow inconsistency on order ${orderNo}`);
    d.prepare(`update wallets set pending_cents = pending_cents - ? where user_id = ?`).run(
      originalNetCents,
      sellerId,
    );
    writeLedger(sellerId, orderId, "refund", -originalNetCents, `Escrow reversed for ${orderNo}`);
    if (sellerKeepNetCents > 0) {
      d.prepare(`update wallets set available_cents = available_cents + ? where user_id = ?`).run(
        sellerKeepNetCents,
        sellerId,
      );
      writeLedger(
        sellerId,
        orderId,
        "escrow_release",
        sellerKeepNetCents,
        `Partial release for ${orderNo}`,
      );
    }
    if (refundCents > 0) {
      getWallet(buyerId);
      d.prepare(`update wallets set available_cents = available_cents + ? where user_id = ?`).run(
        refundCents,
        buyerId,
      );
      writeLedger(buyerId, orderId, "refund", refundCents, `Refund for ${orderNo}`);
    }
  })();
}

/** Seller requests payout: amount + fee leaves available immediately. */
export function txWithdrawalHold(
  userId: string,
  amountCents: number,
  feeCents: number,
  withdrawalId: string,
) {
  const d = db();
  d.transaction(() => {
    const w = getWallet(userId);
    if (w.available_cents < amountCents + feeCents) fail("Insufficient available balance.");
    d.prepare(`update wallets set available_cents = available_cents - ? where user_id = ?`).run(
      amountCents + feeCents,
      userId,
    );
    writeLedger(
      userId,
      null,
      "withdrawal",
      -(amountCents + feeCents),
      `Withdrawal ${withdrawalId} (incl. fee)`,
    );
  })();
}

/** Rejected withdrawal: money returns to available. */
export function txWithdrawalReversal(
  userId: string,
  amountCents: number,
  feeCents: number,
  withdrawalId: string,
) {
  const d = db();
  d.transaction(() => {
    getWallet(userId);
    d.prepare(`update wallets set available_cents = available_cents + ? where user_id = ?`).run(
      amountCents + feeCents,
      userId,
    );
    writeLedger(
      userId,
      null,
      "withdrawal_reversal",
      amountCents + feeCents,
      `Withdrawal ${withdrawalId} rejected`,
    );
  })();
}

/** Admin manual adjustment (audited at the call site). */
export function txAdjustment(userId: string, amountCents: number, note: string) {
  const d = db();
  d.transaction(() => {
    const w = getWallet(userId);
    if (w.available_cents + amountCents < 0) fail("Adjustment would make balance negative.");
    d.prepare(`update wallets set available_cents = available_cents + ? where user_id = ?`).run(
      amountCents,
      userId,
    );
    writeLedger(userId, null, "adjustment", amountCents, note);
  })();
}

/** Freeze / unfreeze a user's entire available balance (dispute or fraud hold). */
export function txSetFreeze(userId: string, freeze: boolean) {
  const d = db();
  d.transaction(() => {
    const w = getWallet(userId);
    if (freeze) {
      d.prepare(
        `update wallets set frozen_cents = frozen_cents + available_cents, available_cents = 0 where user_id = ?`,
      ).run(userId);
      writeLedger(userId, null, "adjustment", -w.available_cents, "Wallet frozen by staff");
    } else {
      d.prepare(
        `update wallets set available_cents = available_cents + frozen_cents, frozen_cents = 0 where user_id = ?`,
      ).run(userId);
      writeLedger(userId, null, "adjustment", w.frozen_cents, "Wallet unfrozen by staff");
    }
    d.prepare(`update users set wallet_frozen = ? where id = ?`).run(freeze ? 1 : 0, userId);
  })();
}
