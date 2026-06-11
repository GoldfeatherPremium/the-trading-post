/**
 * HTTP integration test: drives the real TanStack Start server-fn wire
 * protocol against a running dev server (cookie auth, checkout, payment,
 * delivery, confirm, dispute, admin resolve, withdrawal).
 *
 * Usage: node scripts/http-test.mjs [baseUrl]
 */
import { toJSONAsync, fromCrossJSON } from "seroval";

const BASE = process.argv[2] ?? "http://127.0.0.1:5179";
const FN_BASE = `${BASE}/_serverFn/`;

const jars = {};
function jar(name) {
  if (!jars[name]) jars[name] = {};
  return jars[name];
}

// exact ids extracted from the vite-transformed client modules (avoids any
// base64 variant mismatch with the dev server's manifest)
const idCache = {};
async function fnId(file, exportName) {
  if (!idCache[file]) {
    const src = await (await fetch(`${BASE}/src/lib/api/${file}`)).text();
    idCache[file] = {};
    for (const m of src.matchAll(/createClientRpc\("([^"]+)"\)/g)) {
      const meta = JSON.parse(Buffer.from(m[1], "base64").toString());
      idCache[file][meta.export.replace(/_createServerFn_handler$/, "")] = m[1];
    }
  }
  const id = idCache[file][exportName];
  if (!id) throw new Error(`No RPC id for ${file}#${exportName}`);
  return id;
}

async function call(user, file, exportName, method, data) {
  const cookies = jar(user);
  const headers = {
    "x-tsr-serverFn": "true",
    accept: "application/json",
    cookie: Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; "),
  };
  let url = FN_BASE + (await fnId(file, exportName));
  let body;
  const payload = data === undefined ? undefined : JSON.stringify(await toJSONAsync({ data }));
  if (method === "GET") {
    if (payload !== undefined) url += `?payload=${encodeURIComponent(payload)}`;
  } else {
    headers["content-type"] = "application/json";
    body = payload ?? JSON.stringify(await toJSONAsync(undefined));
  }
  const res = await fetch(url, { method, headers, body, redirect: "manual" });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [pair] = sc.split(";");
    const idx = pair.indexOf("=");
    cookies[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  const text = await res.text();
  // server-fn errors are serialized with a custom $TSR/Error seroval plugin
  if (text.includes('"$TSR/Error"')) {
    const msg = /"message":\{"t":1,"s":"([^"]*)"/.exec(text)?.[1] ?? "server error";
    throw new Error(`${exportName} → ${msg}`);
  }
  let envelope;
  try {
    envelope = fromCrossJSON(JSON.parse(text), { refs: new Map() });
  } catch {
    envelope = text;
  }
  if (!res.ok || envelope?.error) {
    const err = envelope?.error ?? envelope;
    const msg = err?.message ?? (typeof err === "string" ? err.slice(0, 200) : JSON.stringify(err));
    throw new Error(`${exportName} → HTTP ${res.status}: ${msg}`);
  }
  return envelope?.result !== undefined ? envelope.result : envelope;
}

let passed = 0;
function check(name, cond, detail) {
  if (!cond) {
    console.error(`✗ FAIL: ${name}`, detail ?? "");
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${name}`);
}

// ---------------------------------------------------------------------------
const suffix = Math.random().toString(36).slice(2, 8);

// 1. register a fresh buyer (cookie session)
await call("buyer", "auth.ts", "register", "POST", {
  email: `it-${suffix}@test.dev`,
  username: `it_${suffix}`,
  password: "Password123!",
});
let me = await call("buyer", "auth.ts", "getMe", "GET");
check("register + session cookie works", me.user?.username === `it_${suffix}`, me);

// 2. login as admin
await call("admin", "auth.ts", "login", "POST", {
  email: "admin@xvault.test",
  password: "Password123!",
});

// 3. browse + pick an auto product, then log in as its seller
const home = await call("buyer", "catalog.ts", "getHomeData", "GET");
check("home data: categories + trending", home.categories.length >= 8 && home.trending.length > 0);
const autoProduct = home.trending.find((p) => p.delivery_type === "auto" && p.stock_count > 1);
check("auto product available", !!autoProduct);

const sellerEmail = `${autoProduct.seller.username.toLowerCase()}@xvault.test`;
await call("seller", "auth.ts", "login", "POST", { email: sellerEmail, password: "Password123!" });
const sellerMe = await call("seller", "auth.ts", "getMe", "GET");
check("seller login works", sellerMe.user?.username === autoProduct.seller.username, sellerMe.user);

const browse = await call("buyer", "catalog.ts", "browseProducts", "GET", {
  q: "gift",
  sort: "popular",
  page: 1,
});
check("search works", browse.total >= 1, browse.total);

// 4. checkout → payment page → simulated USDT confirmation → instant delivery
const { orderId } = await call("buyer", "orders.ts", "createOrder", "POST", {
  productId: autoProduct.id,
  qty: 2,
  network: "TRC20",
});
const pay = await call("buyer", "orders.ts", "getPayment", "GET", { orderId });
check(
  "deposit created with pay address",
  pay.deposit.pay_address.length > 20 && pay.order.status === "awaiting_payment",
);

await call("buyer", "orders.ts", "simulatePaymentSent", "POST", { orderId });
let order = await call("buyer", "orders.ts", "getOrder", "GET", { orderId });
check("auto order delivered after payment", order.order.status === "delivered", order.order.status);
check("buyer sees 2 codes", order.deliveries[0]?.payload.split("\n").length === 2);

// 5. order chat + automod
await call("buyer", "chat.ts", "sendMessage", "POST", {
  conversationId: order.conversationId,
  body: "Thanks, got the codes!",
});
const flagged = await call("buyer", "chat.ts", "sendMessage", "POST", {
  conversationId: order.conversationId,
  body: "add me on telegram @deals",
});
check("automod flags contact sharing over HTTP", flagged.flagged === true);
const msgs = await call("seller", "chat.ts", "getMessages", "GET", {
  conversationId: order.conversationId,
});
check(
  "seller reads order chat incl. system messages",
  msgs.messages.some((m) => m.is_system) && msgs.messages.some((m) => m.body.includes("codes")),
);

// 6. confirm received → completed (warranty starts)
await call("buyer", "orders.ts", "buyerConfirmReceived", "POST", { orderId });
order = await call("buyer", "orders.ts", "getOrder", "GET", { orderId });
check(
  "order completed, warranty running",
  order.order.status === "completed" && order.order.warranty_ends_at > Date.now(),
);

// 7. review
await call("buyer", "reviews.ts", "leaveReview", "POST", {
  orderId,
  rating: 5,
  comment: "Instant and legit.",
});
order = await call("buyer", "orders.ts", "getOrder", "GET", { orderId });
check("review saved", order.review?.rating === 5);

// 8. second order → dispute → admin full refund → buyer wallet credited
const { orderId: o2 } = await call("buyer", "orders.ts", "createOrder", "POST", {
  productId: autoProduct.id,
  qty: 1,
  network: "TRC20",
});
await call("buyer", "orders.ts", "simulatePaymentSent", "POST", { orderId: o2 });
await call("buyer", "orders.ts", "openDispute", "POST", {
  orderId: o2,
  reason: "invalid_code",
  description: "Code was already redeemed when I tried it.",
});
let o2view = await call("buyer", "orders.ts", "getOrder", "GET", { orderId: o2 });
check(
  "dispute opened, order disputed",
  o2view.order.status === "disputed" && o2view.dispute?.status === "open",
);

await call("seller", "orders.ts", "sellerRespondDispute", "POST", {
  orderId: o2,
  response: "Code was fresh; but I accept the refund decision.",
});
const disputes = await call("admin", "admin.ts", "listDisputes", "GET");
const dd = disputes.disputes.find((x) => x.order_id === o2);
check("dispute visible in admin center with seller response", dd?.status === "seller_responded");

await call("admin", "admin.ts", "resolveDispute", "POST", {
  disputeId: dd.id,
  resolution: "refund_full",
  note: "Code invalid per evidence — refunding buyer.",
});
o2view = await call("buyer", "orders.ts", "getOrder", "GET", { orderId: o2 });
check("order refunded after resolution", o2view.order.status === "refunded");
const buyerWallet = await call("buyer", "seller.ts", "getWalletData", "GET");
check(
  "refund credited to buyer wallet",
  buyerWallet.wallet.available_cents === o2view.order.total_cents,
  buyerWallet.wallet,
);

// 9. buyer withdraws refund → finance approves & marks sent
await call("buyer", "seller.ts", "requestWithdrawal", "POST", {
  amountUsdt: Math.max(10, (buyerWallet.wallet.available_cents - 100) / 100),
  address: "TBuyerRefundPayoutAddressXXXXXXXXXX",
  network: "TRC20",
});
await call("admin", "auth.ts", "getMe", "GET");
const wq = await call("admin", "admin.ts", "listWithdrawalQueue", "GET");
const wd = wq.withdrawals.find((w) => w.status === "pending");
check("withdrawal in finance queue", !!wd);
await call("admin", "admin.ts", "reviewWithdrawal", "POST", {
  withdrawalId: wd.id,
  action: "mark_sent",
  txHash: "0xabc123feedbeef",
});
const buyerWallet2 = await call("buyer", "seller.ts", "getWalletData", "GET");
check(
  "withdrawal marked sent",
  buyerWallet2.withdrawals.some((w) => w.status === "sent"),
);

// 10. seller side: product + stock management
const newProd = await call("seller", "seller.ts", "saveProduct", "POST", {
  categoryId: home.categories[0].id,
  title: `IT test bundle ${suffix}`,
  description: "Integration-test product with thirty plus characters of description.",
  imageKey: "void",
  deliveryType: "auto",
  deliverySlaMinutes: 60,
  warrantyHours: null,
  priceUsdt: 5,
  minQty: 1,
  maxQty: 10,
});
const up = await call("seller", "seller.ts", "uploadStock", "POST", {
  productId: newProd.productId,
  codes: `AAA-${suffix}\nBBB-${suffix}\nAAA-${suffix}`,
});
check("stock upload dedupes", up.added === 2 && up.duplicates === 1, up);

// admin approves it
await call("admin", "admin.ts", "reviewProduct", "POST", {
  productId: newProd.productId,
  approve: true,
});
const q2 = await call("buyer", "catalog.ts", "browseProducts", "GET", {
  q: `IT test bundle ${suffix}`,
  sort: "newest",
  page: 1,
});
check(
  "approved product is live & searchable",
  q2.items.some((p) => p.id === newProd.productId),
);

// 11. permission walls
let denied = false;
try {
  await call("buyer", "admin.ts", "getAdminDashboard", "GET");
} catch {
  denied = true;
}
check("buyer blocked from admin API", denied);
denied = false;
try {
  await call("buyer", "seller.ts", "uploadStock", "POST", {
    productId: newProd.productId,
    codes: "HACK-1",
  });
} catch {
  denied = true;
}
check("buyer blocked from seller stock API", denied);

// 12. admin dashboard reflects activity
const dash = await call("admin", "admin.ts", "getAdminDashboard", "GET");
check("admin dashboard GMV > 0", dash.gmvToday.s > 0, dash.gmvToday);

console.log(`\nAll ${passed} HTTP integration checks passed ✔`);
