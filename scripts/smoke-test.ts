/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Backend smoke test: exercises the full escrow state machine directly
 * against the server modules (no HTTP). Run: bun scripts/smoke-test.ts
 */
process.env.DB_PATH = "/tmp/xvault-smoke.db";
import { rmSync } from "node:fs";
rmSync("/tmp/xvault-smoke.db", { force: true });

const { db } = await import("../src/lib/server/db.server");
const { seedIfEmpty } = await import("../src/lib/server/seed.server");
const core = await import("../src/lib/server/core.server");
const money = await import("../src/lib/server/money.server");
const lc = await import("../src/lib/server/lifecycle.server");

let passed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) {
    console.error(`✗ FAIL: ${name}`, detail ?? "");
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${name}`);
}

seedIfEmpty();
const d = db();

const buyer = d.prepare(`select id from users where username = 'demo_buyer'`).get() as {
  id: string;
};
const autoProduct = d
  .prepare(`select * from products where delivery_type = 'auto' and stock_count > 2 limit 1`)
  .get() as any;
check("seed created auto product with stock", !!autoProduct);

// --- helper replicating checkout's insert (the server fn wraps this with auth) ---
function makeOrder(product: any, qty: number): string {
  const orderId = core.uid();
  const total = product.price_cents * qty;
  const commission = Math.round((total * 8) / 100);
  const t = core.now();
  d.transaction(() => {
    if (product.delivery_type === "auto") {
      const free = d
        .prepare(`select id from stock_items where product_id = ? and status = 'available' limit ?`)
        .all(product.id, qty) as Array<{ id: string }>;
      if (free.length < qty) throw new Error("no stock");
      for (const s of free)
        d.prepare(`update stock_items set status='reserved', order_id=? where id=?`).run(
          orderId,
          s.id,
        );
      d.prepare(
        `update products set stock_count = (select count(*) from stock_items where product_id = ? and status = 'available') where id = ?`,
      ).run(product.id, product.id);
    }
    d.prepare(
      `insert into orders (id, order_no, buyer_id, seller_id, product_id, product_title, qty, unit_price_cents,
        total_cents, commission_pct, commission_cents, seller_net_cents, status, delivery_type,
        delivery_sla_minutes, warranty_hours, expires_at, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?, 'awaiting_payment', ?, 60, 72, ?, ?)`,
    ).run(
      orderId,
      core.makeOrderNo(),
      buyer.id,
      product.seller_id,
      product.id,
      product.title,
      qty,
      product.price_cents,
      total,
      8,
      commission,
      total - commission,
      product.delivery_type,
      t + 30 * 60_000,
      t,
    );
    d.prepare(
      `insert into deposits (id, order_id, user_id, amount_cents, network, pay_address, expires_at, created_at)
       values (?,?,?,?, 'TRC20', ?, ?, ?)`,
    ).run(core.uid(), orderId, buyer.id, total, core.makePayAddress("TRC20"), t + 30 * 60_000, t);
  })();
  return orderId;
}

// =============== 1. happy path: auto delivery → release ===============
const o1 = makeOrder(autoProduct, 2);
const stockBefore = autoProduct.stock_count;
lc.confirmPayment(o1);
let row = lc.getOrderRow(o1)!;
check("auto order delivered on payment", row.status === "delivered", row.status);

const delivery = d.prepare(`select payload from order_deliveries where order_id = ?`).get(o1) as {
  payload: string;
};
check(
  "delivery payload contains 2 decrypted codes",
  delivery.payload.split("\n").length === 2,
  delivery.payload,
);
check("codes are plaintext (not ciphertext)", !delivery.payload.includes("."), delivery.payload);

const stockAfter = (
  d.prepare(`select stock_count from products where id = ?`).get(autoProduct.id) as any
).stock_count;
check("stock decremented by 2", stockAfter === stockBefore - 2, { stockBefore, stockAfter });

let sw = money.getWallet(autoProduct.seller_id);
check("seller escrow (pending) = net", sw.pending_cents === row.seller_net_cents, sw);

lc.completeOrder(o1, false);
row = lc.getOrderRow(o1)!;
check(
  "order completed, warranty running",
  row.status === "completed" && row.warranty_ends_at! > Date.now(),
);

// fast-forward warranty
d.prepare(`update orders set warranty_ends_at = ? where id = ?`).run(Date.now() - 1000, o1);
lc.sweepLifecycle(true);
row = lc.getOrderRow(o1)!;
check("escrow released after warranty", row.status === "released", row.status);
sw = money.getWallet(autoProduct.seller_id);
check(
  "seller available = net, pending = 0",
  sw.available_cents === row.seller_net_cents && sw.pending_cents === 0,
  sw,
);

const ledgerTypes = (
  d.prepare(`select type from wallet_ledger where order_id = ? order by id`).all(o1) as any[]
).map((r) => r.type);
check(
  "ledger trail: hold → release → commission",
  JSON.stringify(ledgerTypes) === JSON.stringify(["escrow_hold", "escrow_release", "commission"]),
  ledgerTypes,
);

// =============== 2. dispute → full refund ===============
const o2 = makeOrder(autoProduct, 1);
lc.confirmPayment(o2);
d.prepare(
  `insert into disputes (id, order_id, opened_by, reason, created_at) values (?,?,?,?,?)`,
).run(core.uid(), o2, buyer.id, "invalid_code", Date.now());
d.prepare(`update orders set status = 'disputed' where id = ?`).run(o2);
const ord2 = lc.getOrderRow(o2)!;
lc.refundOrder(o2, ord2.total_cents, "test refund");
const bw = money.getWallet(buyer.id);
check("buyer refunded full total", bw.available_cents === ord2.total_cents, bw);
sw = money.getWallet(autoProduct.seller_id);
check("seller pending back to 0 after refund", sw.pending_cents === 0, sw);
check("order status refunded", lc.getOrderRow(o2)!.status === "refunded");

// =============== 3. unpaid order expiry restores stock ===============
const o3 = makeOrder(autoProduct, 1);
d.prepare(`update orders set expires_at = ? where id = ?`).run(Date.now() - 1000, o3);
const stockBeforeExpiry = (
  d.prepare(`select stock_count from products where id = ?`).get(autoProduct.id) as any
).stock_count;
lc.sweepLifecycle(true);
check("unpaid order expired", lc.getOrderRow(o3)!.status === "expired");
const stockAfterExpiry = (
  d.prepare(`select stock_count from products where id = ?`).get(autoProduct.id) as any
).stock_count;
check("reserved stock returned", stockAfterExpiry === stockBeforeExpiry + 1, {
  stockBeforeExpiry,
  stockAfterExpiry,
});

// =============== 4. manual delivery + auto-confirm ===============
const manualProduct = d
  .prepare(`select * from products where delivery_type = 'manual' limit 1`)
  .get() as any;
const o4 = makeOrder(manualProduct, 1);
lc.confirmPayment(o4);
check("manual order → delivering on payment", lc.getOrderRow(o4)!.status === "delivering");
lc.markManualDelivered(o4, manualProduct.seller_id, "Delivered in-game, screenshot attached");
check("manual order delivered", lc.getOrderRow(o4)!.status === "delivered");
d.prepare(`update orders set auto_confirm_at = ? where id = ?`).run(Date.now() - 1000, o4);
lc.sweepLifecycle(true);
check("auto-confirm kicked in", lc.getOrderRow(o4)!.status === "completed");

// =============== 5. partial refund ===============
const o5 = makeOrder(manualProduct, 2);
lc.confirmPayment(o5);
lc.markManualDelivered(o5, manualProduct.seller_id, "partial delivery");
const ord5 = lc.getOrderRow(o5)!;
const sellerBefore = money.getWallet(manualProduct.seller_id);
const buyerBefore = money.getWallet(buyer.id);
const half = Math.round(ord5.total_cents / 2);
lc.refundOrder(o5, half, "partial refund test");
const sellerAfter = money.getWallet(manualProduct.seller_id);
const buyerAfter = money.getWallet(buyer.id);
const keepGross = ord5.total_cents - half;
const keepNet = keepGross - Math.round((keepGross * ord5.commission_pct) / 100);
check("partial: buyer got half", buyerAfter.available_cents - buyerBefore.available_cents === half);
check(
  "partial: seller kept net of remainder",
  sellerAfter.available_cents - sellerBefore.available_cents === keepNet,
  {
    got: sellerAfter.available_cents - sellerBefore.available_cents,
    keepNet,
  },
);
check(
  "partial: seller pending reduced by original net",
  sellerBefore.pending_cents - sellerAfter.pending_cents === ord5.seller_net_cents,
);

// =============== 6. withdrawal hold + reversal ===============
const seller = autoProduct.seller_id;
const wBefore = money.getWallet(seller);
money.txWithdrawalHold(seller, 500, 100, "wd-test");
check(
  "withdrawal hold deducts amount+fee",
  money.getWallet(seller).available_cents === wBefore.available_cents - 600,
);
money.txWithdrawalReversal(seller, 500, 100, "wd-test");
check(
  "withdrawal reversal restores funds",
  money.getWallet(seller).available_cents === wBefore.available_cents,
);

// =============== 7. encryption + automod ===============
const enc = core.encryptStock("SECRET-CODE-123");
check(
  "stock encryption round-trips",
  core.decryptStock(enc) === "SECRET-CODE-123" && enc !== "SECRET-CODE-123",
);
check("automod flags telegram", core.automodCheck("hit me on telegram @scam") !== null);
check("automod flags email", core.automodCheck("mail me at x@y.com") !== null);
check("automod passes normal text", core.automodCheck("thanks, code worked great!") === null);

console.log(`\nAll ${passed} checks passed ✔`);
