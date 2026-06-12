# Marketplace Upgrade — Phased Rollout

The 20 areas in your master prompt are weeks of work. I'll ship them in 5 phases, each one self-contained and verifiable in the preview before moving on. After each phase you say "next" and I start the following one.

Existing systems I'll build on (not rebuild): `trust.server.ts` (score + levels already compute), `search.server.ts` (tokenize + did-you-mean), `images.ts` + `/api/public/img.$id` (uploads), wallet/escrow, disputes, reviews, audit, notifications, `seller-badge.tsx`, `smart-search.tsx`.

## Phase 1 — Trust visibility + Homepage (foundation)
Highest ROI; surfaces work that's already in the DB.
- **Homepage**: hero with prominent search + trending queries + category chips; live stats strip (sellers / products / orders / reviews); Trending Products (most viewed, purchased, top rated tabs); Top Sellers row (level + trust + completion); anonymized "recently completed orders" feed.
- **Trust everywhere**: trust score chip + level badge on `product-card`, search results, storefront, product page. Add `seller_trust_history` table + nightly snapshot via cron-style trigger on order completion.
- **Storefront /s/$username**: banner, logo, description, social links (schema + edit UI in seller settings), metrics row, Featured / Latest / Top sections, store announcements.

## Phase 2 — Search, SEO, Recommendations, Wishlist
- **Advanced search UI**: filter sidebar (price, category, seller level, trust min, delivery speed, rating), autocomplete dropdown on `smart-search`, search analytics table (`search_queries` with hits/conversion).
- **Recommendations**: "Related", "Customers also bought", "Recommended for you" via co-purchase + category + view history.
- **Wishlist v2**: collections, price-drop + back-in-stock notifications (hooks into existing notifications table).
- **SEO**: per-route `head()` titles/descriptions/OG, Product/Review/FAQ/Organization JSON-LD, dynamic `/sitemap.xml` server route, `robots.txt`, llms.txt.

## Phase 3 — AI features (Lovable AI Gateway)
- **AI Product Generator**: "Generate with AI" button on new-product form — fills title, description, tags, SEO meta, FAQ from item name + category. Regenerate per field.
- **AI Support Assistant**: dispute/ticket auto-classification + suggested reply for admin queue.
- **AI Fraud Detection**: risk score server fn analyzing order/refund/review patterns + device fingerprint; admin fraud dashboard with flagged users.

## Phase 4 — Growth (Affiliate + Loyalty + Vault hardening)
- **Affiliate**: `referrals` + `referral_clicks` tables, `/r/<code>` redirect route, affiliate dashboard (clicks/signups/purchases/earnings), configurable commission, payout via existing wallet.
- **Buyer Loyalty**: tiers from lifetime spend + orders + referrals; rewards = coupon auto-grants on tier-up.
- **Digital Vault**: dedupe check on stock insert (hash existing encrypted entries), expiration + warranty status surface in seller stock page, replacement tracking on orders.

## Phase 5 — Hardening (PWA, Security, Analytics, i18n, Final pass)
- **PWA**: manifest + icons + install prompt + offline app-shell via guarded `vite-plugin-pwa` (Lovable preview-safe). Push notifications optional.
- **Security**: CSP/HSTS/X-Frame-Options/Referrer-Policy headers, ad-hoc rate-limit middleware on auth/checkout/dispute/withdrawal, device fingerprint capture + VPN/TOR heuristic flag.
- **Analytics dashboards**: admin (revenue/orders/sellers/fraud/growth), seller (revenue/conversion/product perf/repeat), buyer (spend/savings/loyalty progress).
- **i18n**: locale switcher + currency switcher (EN/AR/FR/DE/ES, USD/EUR/GBP/INR/PKR/BDT) wired to existing FX table.
- **Final pass**: dead code, accessibility sweep, mobile responsive QA, index audit on hot queries.

## Excluded (per your spec)
- Subscription Sharing.
- Anything that needs payment-processor integration beyond the existing simulated gateway (real NOWPayments/Stripe onboarding stays manual).

## How this runs
I start Phase 1 immediately after you approve. Each phase ends with a short summary + a "ready for next phase?" prompt. If a phase touches the DB, I run a migration; if it adds an AI surface, I use Lovable AI Gateway (no key needed from you).
