import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ShieldCheck,
  Zap,
  Headphones,
  Star,
  TrendingUp,
  Sparkles,
  ArrowUpRight,
  History,
} from "lucide-react";
import { getHomeData } from "@/lib/api/catalog";
import { PageShell } from "@/components/shell";
import { ProductCard } from "@/components/product-card";
import { usdtShort, timeAgo } from "@/lib/format";
import { productImage } from "@/lib/images";
import { SmartSearch } from "@/components/smart-search";
import { VerificationBadge, TrustScore } from "@/components/seller-badge";

const SITE = "https://warm-trade-space.lovable.app";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "X-VAULT — Buy & Sell Digital Goods with USDT Escrow" },
      {
        name: "description",
        content:
          "The trusted digital goods marketplace. Game currency, gift cards, keys, accounts and boosting — escrow protected, paid in USDT, instant delivery.",
      },
      { property: "og:title", content: "X-VAULT — Buy & Sell Digital Goods with USDT Escrow" },
      {
        property: "og:description",
        content: "Escrow-protected digital marketplace. Pay in USDT, instant delivery.",
      },
      { property: "og:url", content: SITE + "/" },
    ],
    links: [{ rel: "canonical", href: SITE + "/" }],
  }),
  component: Index,
});

type RecentItem = { slug: string; title: string; image_key: string | null; price_cents: number };

function Index() {
  const { data } = useQuery({ queryKey: ["home"], queryFn: () => getHomeData() });
  const [recent, setRecent] = useState<RecentItem[]>([]);
  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem("xv_recent") ?? "[]"));
    } catch {
      /* ignore */
    }
  }, []);

  const featured = data?.trending[0];
  const totalSales = data?.topSellers.reduce((a, s) => a + s.total_sales, 0) ?? 0;

  return (
    <PageShell>
      {/* ============ HERO BENTO ============ */}
      <section className="relative">
        {/* aurora glow background */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70 blur-3xl"
          style={{ background: "var(--gradient-aurora)" }}
        />

        <div className="grid grid-cols-6 auto-rows-[minmax(110px,auto)] gap-3 sm:gap-4 pt-2">
          {/* Big hero tile */}
          <div className="col-span-6 lg:col-span-4 row-span-2 relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div
              aria-hidden
              className="absolute -top-20 -right-20 size-72 rounded-full opacity-40 blur-3xl"
              style={{ background: "var(--gradient-primary)" }}
            />
            <div className="relative space-y-5 max-w-xl">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-primary bg-primary/10 border border-primary/30 rounded-full px-2.5 py-1">
                <ShieldCheck className="size-3" /> ESCROW-PROTECTED · USDT
              </span>
              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[0.95] text-balance">
                Level up your
                <br />
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: "var(--gradient-primary)" }}
                >
                  digital armory
                </span>
              </h1>
              <p className="text-sm text-muted-foreground max-w-md">
                Game currency, gift cards, keys, accounts & boosting — released to sellers only
                after your warranty clears.
              </p>
              <div className="pt-1 relative z-50">
                <SmartSearch variant="hero" />
              </div>
              {data?.trendingSearches && data.trendingSearches.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="text-muted-foreground tracking-widest font-bold">TRENDING:</span>
                  {data.trendingSearches.slice(0, 6).map((s) => (
                    <Link
                      key={s.query}
                      to="/browse"
                      search={{ q: s.query }}
                      className="px-2 py-1 rounded-full bg-secondary/70 border border-border text-foreground/90 hover:border-primary/40 hover:text-primary capitalize"
                    >
                      {s.query}
                    </Link>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/browse"
                  className="group inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-bold tracking-widest px-4 py-2.5 rounded-lg hover:opacity-90"
                >
                  BROWSE MARKET
                  <ArrowUpRight className="size-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </Link>
                <Link
                  to="/sell"
                  className="inline-flex items-center gap-1.5 bg-secondary text-foreground text-xs font-bold tracking-widest px-4 py-2.5 rounded-lg hover:bg-border"
                >
                  START SELLING
                </Link>
              </div>
            </div>
          </div>

          {/* Stats stack — live marketplace counters */}
          <StatTile
            label="Active Sellers"
            value={(data?.stats.sellers ?? 0).toLocaleString()}
            icon={<Star className="size-4" />}
            className="col-span-3 lg:col-span-2"
          />
          <StatTile
            label="Live Listings"
            value={(data?.stats.products ?? 0).toLocaleString()}
            icon={<Sparkles className="size-4" />}
            className="col-span-3 lg:col-span-2"
            accent
          />
          <StatTile
            label="Orders Done"
            value={(data?.stats.orders ?? 0).toLocaleString()}
            icon={<ShieldCheck className="size-4" />}
            className="col-span-3 lg:col-span-2"
          />
          <StatTile
            label="24h GMV"
            value={usdtShort(data?.last24h.gmv24h ?? 0)}
            icon={<TrendingUp className="size-4" />}
            className="col-span-3 lg:col-span-2"
            accent
          />

          {/* Featured product card */}
          {featured && (
            <Link
              to="/p/$slug"
              params={{ slug: featured.slug }}
              className="col-span-6 lg:col-span-2 row-span-2 relative overflow-hidden rounded-2xl border border-border bg-card group"
            >
              <img
                src={productImage(featured.image_key)}
                alt={featured.title}
                className="absolute inset-0 size-full object-cover opacity-70 group-hover:opacity-90 group-hover:scale-105 transition-all duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
              <div className="relative h-full flex flex-col justify-end p-5 min-h-[260px]">
                <span className="inline-flex items-center gap-1 self-start text-[9px] font-bold tracking-widest text-accent bg-accent/15 border border-accent/30 rounded-full px-2 py-0.5 mb-2">
                  <TrendingUp className="size-2.5" /> #1 TRENDING
                </span>
                <h3 className="font-display text-lg leading-tight line-clamp-2">
                  {featured.title}
                </h3>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-muted-foreground">
                    {featured.seller.username}
                  </span>
                  <span className="font-mono text-accent text-sm">
                    {usdtShort(featured.price_cents)}
                  </span>
                </div>
              </div>
            </Link>
          )}
        </div>
      </section>

      {/* ============ CATEGORY BENTO ============ */}
      <section className="pt-8">
        <SectionHeader label="EXPLORE" title="Categories" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {data?.categories.map((c, i) => (
            <Link
              key={c.id}
              to="/browse"
              search={{ category: c.slug }}
              className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors min-h-[110px] flex flex-col justify-between"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div
                aria-hidden
                className="absolute -bottom-8 -right-8 size-24 rounded-full opacity-0 group-hover:opacity-30 blur-2xl transition-opacity"
                style={{ background: "var(--gradient-primary)" }}
              />
              <span className="text-3xl">{c.icon}</span>
              <div>
                <p className="text-sm font-bold leading-tight">{c.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
                  {c.product_count > 0 ? `${c.product_count.toLocaleString()} listings` : "Browse"} <ArrowUpRight className="size-2.5" />
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ============ RECENTLY VIEWED ============ */}
      {recent.length > 0 && (
        <section className="pt-8">
          <SectionHeader label="JUST FOR YOU" title="Recently viewed" icon={<History />} />
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {recent.map((r) => (
              <Link
                key={r.slug}
                to="/p/$slug"
                params={{ slug: r.slug }}
                className="shrink-0 w-44 bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50"
              >
                <div className="aspect-[16/10] bg-secondary overflow-hidden">
                  <img
                    src={productImage(r.image_key)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-2.5">
                  <p className="text-[11px] font-bold line-clamp-1">{r.title}</p>
                  <p className="text-[11px] font-mono text-accent mt-0.5">
                    {usdtShort(r.price_cents)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ============ TRENDING BENTO ============ */}
      <section className="pt-10">
        <SectionHeader
          label="HOT RIGHT NOW"
          title="Trending offers"
          icon={<TrendingUp />}
          link={{ to: "/browse", label: "View all" }}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data?.trending.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      {/* ============ FRESH LISTINGS ============ */}
      <section className="pt-10">
        <SectionHeader
          label="JUST DROPPED"
          title="Fresh listings"
          icon={<Sparkles />}
          link={{ to: "/browse", search: { sort: "newest" as const }, label: "See more" }}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data?.newest.slice(0, 4).map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      {/* ============ TOP SELLERS + LIVE FEED BENTO ============ */}
      <section className="pt-10 grid lg:grid-cols-5 gap-4">
        {/* Top sellers */}
        <div className="lg:col-span-3 bg-card border border-border rounded-2xl p-5">
          <SectionHeader label="LEADERBOARD" title="Top sellers" inline />
          <div className="space-y-1.5 mt-3">
            {data?.topSellers.map((s, i) => (
              <Link
                key={s.id}
                to="/s/$username"
                params={{ username: s.username }}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-secondary/60 transition-colors"
              >
                <span
                  className={`font-display text-xl w-7 text-center ${
                    i === 0
                      ? "text-primary"
                      : i === 1
                        ? "text-foreground/80"
                        : "text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="size-10 rounded-xl bg-primary/15 border border-primary/40 grid place-items-center text-xs font-bold text-primary uppercase">
                  {s.username.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold truncate">{s.username}</p>
                    <VerificationBadge tier={s.verification_tier} size="xs" showLabel={false} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>Lvl {s.seller_level} · {s.total_sales.toLocaleString()} sales</span>
                    <TrustScore score={s.trust_score} />
                  </div>
                </div>
                <span className="text-[11px] text-yellow-400 flex items-center gap-0.5 font-bold">
                  <Star className="size-3 fill-current" />
                  {s.rating > 0 ? s.rating.toFixed(1) : "—"}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Live feed */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-5 relative overflow-hidden">
          <div
            aria-hidden
            className="absolute -top-10 -right-10 size-40 rounded-full opacity-30 blur-3xl"
            style={{ background: "var(--gradient-primary)" }}
          />
          <SectionHeader label="LIVE" title="Recent sales" inline pulse />
          <div className="space-y-2.5 mt-3 relative">
            {data?.recentSales.length === 0 && (
              <p className="text-xs text-muted-foreground">No sales yet — be the first!</p>
            )}
            {data?.recentSales.slice(0, 6).map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="size-1.5 rounded-full bg-accent animate-pulse mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="leading-tight truncate">
                    <b className="text-foreground">{s.buyer}</b>{" "}
                    <span className="text-muted-foreground">bought</span> {s.product_title}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {timeAgo(s.created_at)} · <span className="text-accent font-mono">
                      {usdtShort(s.total_cents)}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ TRUST BENTO ============ */}
      <section className="pt-10">
        <SectionHeader label="WHY X-VAULT" title="Built for trust" />
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            {
              icon: ShieldCheck,
              t: "Escrow Protection",
              d: "Funds release to sellers only after your warranty clears.",
              tag: "100% PROTECTED",
            },
            {
              icon: Zap,
              t: "Instant Delivery",
              d: "Auto-delivered codes the second your payment confirms.",
              tag: "⚡ < 60s",
            },
            {
              icon: Headphones,
              t: "Dispute Team",
              d: "Open a dispute anytime during warranty — we mediate.",
              tag: "24 / 7",
            },
          ].map((x) => (
            <div
              key={x.t}
              className="relative overflow-hidden bg-card border border-border rounded-2xl p-5 hover:border-primary/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-4">
                <div
                  className="size-10 rounded-xl grid place-items-center text-primary-foreground"
                  style={{ background: "var(--gradient-primary)" }}
                >
                  <x.icon className="size-5" />
                </div>
                <span className="text-[9px] font-bold tracking-widest text-muted-foreground bg-secondary px-2 py-1 rounded-full">
                  {x.tag}
                </span>
              </div>
              <p className="font-bold text-sm">{x.t}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{x.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ CTA STRIP ============ */}
      <section className="pt-10 pb-2">
        <div
          className="relative overflow-hidden rounded-2xl border border-border p-8 sm:p-10 text-center"
          style={{ background: "var(--gradient-primary)" }}
        >
          <div
            aria-hidden
            className="absolute inset-0 opacity-30"
            style={{ background: "radial-gradient(circle at 30% 50%, white, transparent 60%)" }}
          />
          <div className="relative space-y-3">
            <h2 className="font-display text-3xl sm:text-4xl text-primary-foreground">
              Ready to sell?
            </h2>
            <p className="text-sm text-primary-foreground/85 max-w-md mx-auto">
              List your digital goods, get paid in USDT, ship from anywhere.
            </p>
            <div className="flex justify-center gap-2 pt-1">
              <Link
                to="/sell"
                className="bg-background text-foreground text-xs font-bold tracking-widest px-5 py-3 rounded-lg hover:bg-card"
              >
                BECOME A SELLER
              </Link>
            </div>
          </div>
        </div>
        <p className="sr-only">{totalSales} total sales across the platform.</p>
      </section>
    </PageShell>
  );
}

function StatTile({
  label,
  value,
  icon,
  className,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border bg-card p-4 flex flex-col justify-between ${className ?? ""}`}
    >
      <div
        className={`size-8 rounded-lg grid place-items-center ${accent ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary"}`}
      >
        {icon}
      </div>
      <div>
        <p className="font-display text-2xl leading-none">{value}</p>
        <p className="text-[10px] text-muted-foreground tracking-widest mt-1">{label}</p>
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  title,
  icon,
  link,
  inline,
  pulse,
}: {
  label: string;
  title: string;
  icon?: React.ReactNode;
  link?: { to: string; label: string; search?: Record<string, unknown> };
  inline?: boolean;
  pulse?: boolean;
}) {
  return (
    <div className={`flex items-end justify-between gap-3 ${inline ? "mb-0" : "mb-4"}`}>
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-primary tracking-widest">
          {pulse && <span className="size-1.5 rounded-full bg-accent animate-pulse" />}
          {label}
        </div>
        <h2 className="font-display text-2xl sm:text-3xl flex items-center gap-2 leading-tight mt-0.5">
          {icon}
          {title}
        </h2>
      </div>
      {link && (
        <Link
          to={link.to as "/browse"}
          search={(link.search ?? {}) as never}
          className="text-[10px] text-primary font-bold tracking-widest flex items-center gap-1 hover:gap-1.5 transition-all"
        >
          {link.label} <ArrowUpRight className="size-3" />
        </Link>
      )}
    </div>
  );
}
