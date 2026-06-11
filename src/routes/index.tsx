import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ShieldCheck, Zap, Headphones, Star, TrendingUp, Sparkles } from "lucide-react";
import { getHomeData } from "@/lib/api/catalog";
import { PageShell } from "@/components/shell";
import { ProductCard } from "@/components/product-card";
import { usdtShort, timeAgo } from "@/lib/format";
import { productImage } from "@/lib/images";
import { SmartSearch } from "@/components/smart-search";
import { History } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "X-VAULT — Buy & Sell Digital Goods with USDT Escrow" },
      {
        name: "description",
        content:
          "The trusted digital goods marketplace. Game currency, gift cards, keys, accounts and boosting — escrow protected, paid in USDT, instant delivery.",
      },
    ],
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

  return (
    <PageShell>
      {/* Hero */}
      <header className="py-8 space-y-4 text-center max-w-2xl mx-auto">
        <h1 className="font-display text-5xl sm:text-6xl leading-none text-balance animate-enter">
          Level Up Your <span className="text-primary">Armory</span>
        </h1>
        <p
          className="text-sm text-muted-foreground animate-enter"
          style={{ animationDelay: "60ms" }}
        >
          Game currency, gift cards, keys, accounts & boosting. Every order escrow-protected, paid
          in USDT, released to sellers only after your warranty clears.
        </p>
        <div className="animate-enter pt-2 relative z-50" style={{ animationDelay: "80ms" }}>
          <SmartSearch variant="hero" />
        </div>
        <div
          className="flex justify-center gap-2 animate-enter"
          style={{ animationDelay: "100ms" }}
        >
          <Link
            to="/browse"
            className="bg-primary text-primary-foreground text-xs font-bold tracking-widest px-5 py-3 rounded-md"
          >
            BROWSE MARKET
          </Link>
          <Link
            to="/sell"
            className="bg-secondary text-foreground text-xs font-bold tracking-widest px-5 py-3 rounded-md hover:bg-border"
          >
            START SELLING
          </Link>
        </div>
      </header>

      {/* Categories */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
        {data?.categories.map((c) => (
          <Link
            key={c.id}
            to="/browse"
            search={{ category: c.slug }}
            className="whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold tracking-wide bg-secondary hover:bg-border flex items-center gap-1.5"
          >
            <span>{c.icon}</span> {c.name}
          </Link>
        ))}
      </div>

      {/* Recently viewed */}
      {recent.length > 0 && (
        <section className="pt-6">
          <h2 className="font-display text-xl tracking-wide flex items-center gap-2 mb-3 text-muted-foreground">
            <History className="size-4" /> RECENTLY VIEWED
          </h2>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {recent.map((r) => (
              <Link
                key={r.slug}
                to="/p/$slug"
                params={{ slug: r.slug }}
                className="shrink-0 w-40 bg-card border border-border rounded-lg overflow-hidden hover:border-primary/50"
              >
                <div className="aspect-[16/10] bg-secondary overflow-hidden">
                  <img
                    src={productImage(r.image_key)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-2">
                  <p className="text-[10px] font-bold line-clamp-1">{r.title}</p>
                  <p className="text-[10px] font-mono text-accent">{usdtShort(r.price_cents)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Trending */}
      <section className="py-8">
        <div className="flex justify-between items-end mb-4">
          <h2 className="font-display text-2xl tracking-wide flex items-center gap-2">
            <TrendingUp className="size-5 text-primary" /> TRENDING OFFERS
          </h2>
          <Link to="/browse" className="text-[10px] text-primary font-bold tracking-widest">
            VIEW ALL
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data?.trending.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      {/* New listings */}
      <section className="py-4">
        <div className="flex justify-between items-end mb-4">
          <h2 className="font-display text-2xl tracking-wide flex items-center gap-2">
            <Sparkles className="size-5 text-accent" /> FRESH LISTINGS
          </h2>
          <Link
            to="/browse"
            search={{ sort: "newest" }}
            className="text-[10px] text-primary font-bold tracking-widest"
          >
            SEE MORE
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data?.newest.slice(0, 4).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      {/* Top sellers + recent sales */}
      <section className="grid md:grid-cols-2 gap-6 py-8">
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-display text-xl mb-3">TOP SELLERS</h3>
          <div className="space-y-2">
            {data?.topSellers.map((s, i) => (
              <Link
                key={s.id}
                to="/s/$username"
                params={{ username: s.username }}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary"
              >
                <span className="font-display text-lg text-muted-foreground w-5">#{i + 1}</span>
                <div className="size-8 rounded-full bg-primary/20 border border-primary/40 grid place-items-center text-[10px] font-bold text-primary uppercase">
                  {s.username.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{s.username}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Lv.{s.seller_level} · {s.total_sales.toLocaleString()} sales
                  </p>
                </div>
                <span className="text-[10px] text-yellow-400 flex items-center gap-0.5">
                  <Star className="size-3 fill-current" />{" "}
                  {s.rating > 0 ? s.rating.toFixed(1) : "—"}
                </span>
              </Link>
            ))}
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-display text-xl mb-3">RECENT SALES</h3>
          <div className="space-y-2">
            {data?.recentSales.length === 0 && (
              <p className="text-xs text-muted-foreground">No sales yet — be the first!</p>
            )}
            {data?.recentSales.map((s, i) => (
              <div key={i} className="flex items-center gap-3 p-2 text-xs">
                <span className="size-1.5 rounded-full bg-accent animate-pulse" />
                <span className="truncate flex-1">
                  <b>{s.buyer}</b> bought {s.product_title}
                </span>
                <span className="text-accent font-mono whitespace-nowrap">
                  {usdtShort(s.total_cents)}
                </span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {timeAgo(s.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="grid grid-cols-3 gap-3 py-8 text-center">
        {[
          {
            icon: ShieldCheck,
            t: "Escrow Protection",
            d: "Funds release to sellers only after your warranty clears",
          },
          {
            icon: Zap,
            t: "Instant Delivery",
            d: "Auto-delivered codes the second payment confirms",
          },
          {
            icon: Headphones,
            t: "Dispute Team",
            d: "Open a dispute any time during warranty — we mediate",
          },
        ].map((x) => (
          <div key={x.t} className="space-y-2 bg-card border border-border rounded-lg p-4">
            <x.icon className="size-6 text-primary mx-auto" />
            <p className="text-xs font-bold uppercase">{x.t}</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed hidden sm:block">
              {x.d}
            </p>
          </div>
        ))}
      </section>
    </PageShell>
  );
}
