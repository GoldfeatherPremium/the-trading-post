/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Backend smoke test: exercises the full escrow state machine directly
 * against the server modules (no HTTP). Runs on whichever engine is
 * configured:
 *   node smoke.mjs                      → SQLite (temp file)
 *   DATABASE_URL=postgres://… node …    → Postgres (e.g. local PG / Supabase)
 */
import { rmSync } from "node:fs";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = "/tmp/xvault-smoke.db";
  rmSync("/tmp/xvault-smoke.db", { force: true });
}

const { q, q1, run, tx } = await import("../src/lib/server/db.server");
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

if (process.env.DATABASE_URL) {
  // fresh schema for repeatable runs against Postgres
  await run(`drop schema public cascade`).catch(() => {});
  await run(`create schema public`).catch(() => {});
  const { resetDbForTests } = await import("../src/lib/server/db.server");
  resetDbForTests();
}
await seedIfEmpty();

const buyer = (await q1<{ id: string }>(`select id from users where username = 'demo_buyer'`))!;
const autoProduct = (await q1<any>(
  `select * from products where delivery_type = 'auto' and stock_count > 2 limit 1`,
))!;
check("seed created auto product with stock", !!autoProduct);

// --- helper replicating checkout's insert (the server fn wraps this with auth) ---
async function makeOrder(product: any, qty: number): Promise<string> {
  const orderId = core.uid();
  const total = product.price_cents * qty;
  const commission = Math.round((total * 8) / 100);
  const t = core.now();
  await tx(async () => {
    if (product.delivery_type === "auto") {
      const free = await q<{ id: string }>(
        `select id from stock_items where product_id = ? and status = 'available' limit ?`,
        [product.id, qty],
      );
      if (free.length < qty) throw new Error("no stock");
      for (const s of free)
        await run(`update stock_items set status='reserved', order_id=? where id=?`, [
          orderId,
          s.id,
        ]);
      await run(
        `update products set stock_count = (select count(*) from stock_items where product_id = ? and status = 'available') where id = ?`,
        [product.id, product.id],
      );
    }
    await run(
      `insert into orders (id, order_no, buyer_id, seller_id, product_id, product_title, qty, unit_price_cents,
        total_cents, commission_pct, commission_cents, seller_net_cents, status, delivery_type,
        delivery_sla_minutes, warranty_hours, expires_at, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?, 'awaiting_payment', ?, 60, 72, ?, ?)`,
      [
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
      ],
    );
    await run(
      `insert into deposits (id, order_id, user_id, amount_cents, network, pay_address, expires_at, created_at)
       values (?,?,?,?, 'TRC20', ?, ?, ?)`,
      [core.uid(), orderId, buyer.id, total, core.makePayAddress("TRC20"), t + 30 * 60_000, t],
    );
  });
  return orderId;
}

const stockOf = async (pid: string) =>
  (await q1<any>(`select stock_count from products where id = ?`, [pid]))!.stock_count;

// =============== 1. happy path: auto delivery → release ===============
const o1 = await makeOrder(autoProduct, 2);
const stockBefore = autoProduct.stock_count;
await lc.confirmPayment(o1);
let row = (await lc.getOrderRow(o1))!;
check("auto order delivered on payment", row.status === "delivered", row.status);

const delivery = (await q1<{ payload: string }>(
  `select payload from order_deliveries where order_id = ?`,
  [o1],
))!;
check(
  "delivery payload contains 2 decrypted codes",
  delivery.payload.split("\n").length === 2,
  delivery.payload,
);
check("codes are plaintext (not ciphertext)", !delivery.payload.includes("."), delivery.payload);
check("stock decremented by 2", (await stockOf(autoProduct.id)) === stockBefore - 2);

let sw = await money.getWallet(autoProduct.seller_id);
check("seller escrow (pending) = net", sw.pending_cents === row.seller_net_cents, sw);

await lc.completeOrder(o1, false);
row = (await lc.getOrderRow(o1))!;
check(
  "order completed, warranty running",
  row.status === "completed" && row.warranty_ends_at! > Date.now(),
);

// fast-forward warranty
await run(`update orders set warranty_ends_at = ? where id = ?`, [Date.now() - 1000, o1]);
await lc.sweepLifecycle(true);
row = (await lc.getOrderRow(o1))!;
check("escrow released after warranty", row.status === "released", row.status);
sw = await money.getWallet(autoProduct.seller_id);
check(
  "seller available = net, pending = 0",
  sw.available_cents === row.seller_net_cents && sw.pending_cents === 0,
  sw,
);

const ledgerTypes = (
  await q<any>(`select type from wallet_ledger where order_id = ? order by id`, [o1])
).map((r) => r.type);
check(
  "ledger trail: hold → release → commission",
  JSON.stringify(ledgerTypes) === JSON.stringify(["escrow_hold", "escrow_release", "commission"]),
  ledgerTypes,
);

// =============== 2. dispute → full refund ===============
const o2 = await makeOrder(autoProduct, 1);
await lc.confirmPayment(o2);
await run(`insert into disputes (id, order_id, opened_by, reason, created_at) values (?,?,?,?,?)`, [
  core.uid(),
  o2,
  buyer.id,
  "invalid_code",
  Date.now(),
]);
await run(`update orders set status = 'disputed' where id = ?`, [o2]);
const ord2 = (await lc.getOrderRow(o2))!;
await lc.refundOrder(o2, ord2.total_cents, "test refund");
const bw = await money.getWallet(buyer.id);
check("buyer refunded full total", bw.available_cents === ord2.total_cents, bw);
sw = await money.getWallet(autoProduct.seller_id);
check("seller pending back to 0 after refund", sw.pending_cents === 0, sw);
check("order status refunded", (await lc.getOrderRow(o2))!.status === "refunded");

// =============== 3. unpaid order expiry restores stock ===============
const o3 = await makeOrder(autoProduct, 1);
await run(`update orders set expires_at = ? where id = ?`, [Date.now() - 1000, o3]);
const stockBeforeExpiry = await stockOf(autoProduct.id);
await lc.sweepLifecycle(true);
check("unpaid order expired", (await lc.getOrderRow(o3))!.status === "expired");
check("reserved stock returned", (await stockOf(autoProduct.id)) === stockBeforeExpiry + 1);

// =============== 4. manual delivery + auto-confirm ===============
const manualProduct = (await q1<any>(
  `select * from products where delivery_type = 'manual' limit 1`,
))!;
const o4 = await makeOrder(manualProduct, 1);
await lc.confirmPayment(o4);
check("manual order → delivering on payment", (await lc.getOrderRow(o4))!.status === "delivering");
await lc.markManualDelivered(o4, manualProduct.seller_id, "Delivered in-game, screenshot attached");
check("manual order delivered", (await lc.getOrderRow(o4))!.status === "delivered");
await run(`update orders set auto_confirm_at = ? where id = ?`, [Date.now() - 1000, o4]);
await lc.sweepLifecycle(true);
check("auto-confirm kicked in", (await lc.getOrderRow(o4))!.status === "completed");

// =============== 5. partial refund ===============
const o5 = await makeOrder(manualProduct, 2);
await lc.confirmPayment(o5);
await lc.markManualDelivered(o5, manualProduct.seller_id, "partial delivery");
const ord5 = (await lc.getOrderRow(o5))!;
const sellerBefore = await money.getWallet(manualProduct.seller_id);
const buyerBefore = await money.getWallet(buyer.id);
const half = Math.round(ord5.total_cents / 2);
await lc.refundOrder(o5, half, "partial refund test");
const sellerAfter = await money.getWallet(manualProduct.seller_id);
const buyerAfter = await money.getWallet(buyer.id);
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
const wBefore = await money.getWallet(seller);
await money.txWithdrawalHold(seller, 500, 100, "wd-test");
check(
  "withdrawal hold deducts amount+fee",
  (await money.getWallet(seller)).available_cents === wBefore.available_cents - 600,
);
await money.txWithdrawalReversal(seller, 500, 100, "wd-test");
check(
  "withdrawal reversal restores funds",
  (await money.getWallet(seller)).available_cents === wBefore.available_cents,
);

// =============== 7. transaction rollback on failure ===============
const preTx = await money.getWallet(seller);
await tx(async () => {
  await run(`update wallets set available_cents = available_cents + 99999 where user_id = ?`, [
    seller,
  ]);
  throw new Error("forced rollback");
}).catch(() => {});
check(
  "failed transaction rolls back",
  (await money.getWallet(seller)).available_cents === preTx.available_cents,
);

// =============== 8. encryption + automod ===============
const enc = core.encryptStock("SECRET-CODE-123");
check(
  "stock encryption round-trips",
  core.decryptStock(enc) === "SECRET-CODE-123" && enc !== "SECRET-CODE-123",
);
check("automod flags telegram", core.automodCheck("hit me on telegram @scam") !== null);
check("automod flags email", core.automodCheck("mail me at x@y.com") !== null);
check("automod passes normal text", core.automodCheck("thanks, code worked great!") === null);

console.log(
  `\nAll ${passed} checks passed ✔ (engine: ${process.env.DATABASE_URL ? "postgres" : "sqlite"})`,
);
process.exit(0);
