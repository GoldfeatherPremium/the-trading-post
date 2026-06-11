import { db } from "./db.server";
import { encryptStock, hashPassword, now, sha256, slugify, uid } from "./core.server";

/**
 * Idempotent demo seed: runs once on first boot (skips if any user exists).
 * Demo accounts (password for all: "Password123!"):
 *   admin@xvault.test    — super admin
 *   finance@xvault.test  — finance staff
 *   support@xvault.test  — support staff
 *   goldrush@xvault.test — approved seller with live products + stock
 *   keymaster@xvault.test— approved seller
 *   buyer@xvault.test    — regular buyer
 */
export function seedIfEmpty(): void {
  const d = db();
  const hasUsers = d.prepare(`select 1 from users limit 1`).get();
  if (hasUsers) return;

  const t = now();
  const pw = hashPassword("Password123!");

  const mkUser = (
    email: string,
    username: string,
    role: string,
    sellerStatus = "none",
    extra: Record<string, number> = {},
  ) => {
    const id = uid();
    d.prepare(
      `insert into users (id, email, username, password_hash, role, seller_status, seller_level, rating, rating_count, total_sales, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      email,
      username,
      pw,
      role,
      sellerStatus,
      extra.level ?? 1,
      extra.rating ?? 0,
      extra.rating_count ?? 0,
      extra.total_sales ?? 0,
      t,
    );
    d.prepare(`insert into wallets (user_id) values (?)`).run(id);
    return id;
  };

  mkUser("admin@xvault.test", "admin", "admin");
  mkUser("finance@xvault.test", "finance", "finance");
  mkUser("support@xvault.test", "support", "support");
  const seller1 = mkUser("goldrush@xvault.test", "GoldRush", "seller", "approved", {
    level: 4,
    rating: 4.9,
    rating_count: 2113,
    total_sales: 5400,
  });
  const seller2 = mkUser("keymaster@xvault.test", "KeyMaster", "seller", "approved", {
    level: 3,
    rating: 4.8,
    rating_count: 980,
    total_sales: 2150,
  });
  mkUser("buyer@xvault.test", "demo_buyer", "buyer");

  for (const [sid, name] of [
    [seller1, "Gold Rush Trading"],
    [seller2, "KeyMaster Digital"],
  ] as const) {
    d.prepare(
      `insert into seller_applications (id, user_id, full_name, country, experience, usdt_payout_address, usdt_network, status, created_at, reviewed_at)
       values (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      uid(),
      sid,
      name,
      "United States",
      "Established digital goods reseller",
      "TDemoPayoutAddressXXXXXXXXXXXXXXXX",
      "TRC20",
      "approved",
      t,
      t,
    );
  }

  const cats: Array<[string, string, string, number, number, string]> = [
    // name, slug, icon, warranty_hours, commission_pct, risk
    ["Game Top-Ups & Currency", "currency", "🪙", 72, 8, "normal"],
    ["Game Items & Skins", "items", "⚔️", 72, 8, "normal"],
    ["Game Accounts", "accounts", "👤", 168, 12, "high"],
    ["Gift Cards", "gift-cards", "🎁", 24, 8, "normal"],
    ["Software Keys & Licenses", "software-keys", "🔑", 72, 8, "normal"],
    ["Digital Subscriptions", "subscriptions", "📺", 72, 10, "normal"],
    ["Boosting / Services", "boosting", "🚀", 72, 10, "normal"],
    ["Other Digital Goods", "other", "📦", 72, 8, "normal"],
  ];
  const catIds: Record<string, string> = {};
  cats.forEach(([name, slug, icon, wh, pct, risk], i) => {
    const id = uid();
    catIds[slug] = id;
    d.prepare(
      `insert into categories (id, name, slug, icon, sort, default_warranty_hours, commission_pct, risk_tier) values (?,?,?,?,?,?,?,?)`,
    ).run(id, name, slug, icon, i, wh, pct, risk);
  });

  type P = {
    seller: string;
    cat: string;
    title: string;
    desc: string;
    image: string;
    delivery: "auto" | "manual";
    price: number;
    region?: string;
    platform?: string;
    requiredInfo?: string;
    stock?: string[];
    maxQty?: number;
    sla?: number;
  };
  const products: P[] = [
    {
      seller: seller1,
      cat: "currency",
      title: "1M Gold — World of Valor — Instant Delivery",
      desc: "1,000,000 in-game gold for World of Valor. Auto-delivered redemption code; redeem at any city banker. Escrow protected with 72h warranty.",
      image: "gold",
      delivery: "auto",
      price: 14.5,
      region: "Global",
      platform: "PC",
      stock: Array.from(
        { length: 25 },
        (_, i) =>
          `WOV-GOLD-1M-${String(1000 + i)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      ),
    },
    {
      seller: seller1,
      cat: "currency",
      title: "5,000 Void Credits — Void Strike",
      desc: "Top-up 5,000 Void Credits. Manual delivery to your account ID within 30 minutes, screenshot proof provided.",
      image: "void",
      delivery: "manual",
      price: 22.99,
      region: "Global",
      platform: "PC",
      requiredInfo: "Void Strike account ID and server region",
      sla: 30,
    },
    {
      seller: seller1,
      cat: "items",
      title: "God-Slayer Blade +12 — Elden Reach",
      desc: "Max-enchanted God-Slayer Blade. Face-to-face trade in-game, coordinated through order chat. Proof screenshots on delivery.",
      image: "sword",
      delivery: "manual",
      price: 299,
      region: "EU",
      platform: "PC",
      requiredInfo: "Character name and world level",
      sla: 120,
    },
    {
      seller: seller1,
      cat: "boosting",
      title: "Ranked Boost Bronze → Diamond — Mage Legends",
      desc: "Professional rank boosting by Grandmaster players. VPN protected, no chat with your friends, progress updates in order chat. ETA 3-5 days.",
      image: "league",
      delivery: "manual",
      price: 89,
      region: "NA",
      platform: "PC",
      requiredInfo:
        "Account login region + current rank (credentials shared only in encrypted order chat)",
      sla: 4320,
    },
    {
      seller: seller1,
      cat: "accounts",
      title: "Mythic Account · Lvl 240 — Mage Legends",
      desc: "Endgame account: 38 skins, mythic mounts, full email access transferred. High-risk category: 7-day extended warranty, manual handover only.",
      image: "royale",
      delivery: "manual",
      price: 185,
      region: "Global",
      platform: "PC",
      requiredInfo: "Email address for account transfer",
      sla: 240,
      maxQty: 1,
    },
    {
      seller: seller2,
      cat: "gift-cards",
      title: "Steam Gift Card $50 (US)",
      desc: "Legitimate US-region Steam wallet codes sourced from authorized distributors. Instant auto delivery. 24h replacement warranty.",
      image: "racing",
      delivery: "auto",
      price: 46.5,
      region: "US",
      platform: "Steam",
      stock: Array.from(
        { length: 15 },
        () =>
          `STEAM-50US-${Math.random().toString(36).slice(2, 7).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      ),
    },
    {
      seller: seller2,
      cat: "gift-cards",
      title: "PlayStation Network $25 (US)",
      desc: "PSN wallet top-up codes, US region. Instant delivery after payment confirmation.",
      image: "survive",
      delivery: "auto",
      price: 23.25,
      region: "US",
      platform: "PSN",
      stock: Array.from(
        { length: 12 },
        () =>
          `PSN-25US-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      ),
    },
    {
      seller: seller2,
      cat: "software-keys",
      title: "Windows 11 Pro OEM Key — Global",
      desc: "Genuine OEM activation key for Windows 11 Pro, global activation, lifetime license. Instant delivery with activation guide.",
      image: "elden",
      delivery: "auto",
      price: 18.9,
      region: "Global",
      platform: "PC",
      stock: Array.from(
        { length: 20 },
        () =>
          `W11P-${Math.random().toString(36).slice(2, 7).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      ),
    },
    {
      seller: seller2,
      cat: "currency",
      title: "8,100 V-Coins — Battle Royale",
      desc: "V-Coin top-up via gift method. Manual delivery, requires your player tag. Delivered within 60 minutes.",
      image: "royale",
      delivery: "manual",
      price: 49.99,
      region: "Global",
      platform: "Cross-platform",
      requiredInfo: "Player tag (must accept friend request 48h before gifting)",
      sla: 60,
    },
    {
      seller: seller2,
      cat: "subscriptions",
      title: "Music Streaming Premium — 12 Months (Authorized Reseller)",
      desc: "12-month premium subscription activated on YOUR own account via authorized reseller program. Fully compliant activation — no shared credentials.",
      image: "void",
      delivery: "manual",
      price: 35,
      region: "Global",
      platform: "Any",
      requiredInfo: "Account email used for the subscription",
      sla: 720,
    },
  ];

  for (const p of products) {
    const pid = uid();
    const stockCount = p.stock?.length ?? 0;
    d.prepare(
      `insert into products (id, seller_id, category_id, title, slug, description, image_key, delivery_type,
        delivery_sla_minutes, price_cents, min_qty, max_qty, stock_count, status, region, platform, required_info,
        views, sold_count, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      pid,
      p.seller,
      catIds[p.cat],
      p.title,
      slugify(p.title),
      p.desc,
      p.image,
      p.delivery,
      p.sla ?? 60,
      Math.round(p.price * 100),
      1,
      p.maxQty ?? 50,
      stockCount,
      "active",
      p.region ?? null,
      p.platform ?? null,
      p.requiredInfo ?? null,
      200 + Math.floor(Math.random() * 4000),
      Math.floor(Math.random() * 900),
      t - Math.floor(Math.random() * 30) * 86_400_000,
    );
    for (const code of p.stock ?? []) {
      d.prepare(
        `insert into stock_items (id, product_id, content_encrypted, content_hash, created_at) values (?,?,?,?,?)`,
      ).run(uid(), pid, encryptStock(code), sha256(code), t);
    }
  }
}
