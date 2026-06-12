import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Star, Globe, Twitter, MessageCircle, Send, Youtube, Zap, Megaphone } from "lucide-react";
import { getSellerStore } from "@/lib/api/catalog";
import { PageShell } from "@/components/shell";
import { ProductCard } from "@/components/product-card";
import { SellerBadge } from "@/components/seller-badge";
import { TrustSparkline } from "@/components/trust-sparkline";
import { timeAgo } from "@/lib/format";

const SITE = "https://warm-trade-space.lovable.app";

export const Route = createFileRoute("/s/$username")({
  loader: async ({ params, context }) => {
    try {
      const data = await context.queryClient.ensureQueryData({
        queryKey: ["sellerStore", params.username],
        queryFn: () => getSellerStore({ data: { username: params.username } }),
      });
      return { seller: data?.seller ?? null };
    } catch {
      return { seller: null };
    }
  },
  head: ({ params, loaderData }) => {
    const s = loaderData?.seller;
    const url = `${SITE}/s/${params.username}`;
    if (!s) {
      return {
        meta: [{ title: `${params.username} — X-VAULT seller` }],
        links: [{ rel: "canonical", href: url }],
      };
    }
    const title = `${s.username} — Trusted seller on X-VAULT`;
    const desc = (s.store_description ||
      `${s.username} on X-VAULT: ${s.total_sales.toLocaleString()} sales, ${s.rating > 0 ? s.rating.toFixed(1) + "★" : "new seller"}, escrow protected. Browse listings & buy with USDT.`
    )
      .replace(/\s+/g, " ")
      .slice(0, 155);
    const img = s.store_logo_url || s.store_banner_url || undefined;
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: s.username,
      url,
      ...(img ? { logo: img, image: img } : {}),
      ...(s.rating_count > 0
        ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: s.rating.toFixed(1),
              reviewCount: s.rating_count,
            },
          }
        : {}),
    };
    const breadcrumbs = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE },
        { "@type": "ListItem", position: 2, name: "Sellers", item: `${SITE}/browse` },
        { "@type": "ListItem", position: 3, name: s.username, item: url },
      ],
    };
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:type", content: "profile" },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:url", content: url },
        ...(img ? [{ property: "og:image", content: img }] : []),
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: desc },
        ...(img ? [{ name: "twitter:image", content: img }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        { type: "application/ld+json", children: JSON.stringify(jsonLd) },
        { type: "application/ld+json", children: JSON.stringify(breadcrumbs) },
      ],
    };
  },
  component: SellerStorePage,
});

const SOCIAL_ICONS: Record<string, { Icon: typeof Globe; label: string }> = {
  website: { Icon: Globe, label: "Website" },
  twitter: { Icon: Twitter, label: "Twitter" },
  discord: { Icon: MessageCircle, label: "Discord" },
  telegram: { Icon: Send, label: "Telegram" },
  youtube: { Icon: Youtube, label: "YouTube" },
};

function SellerStorePage() {
  const { username } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["sellerStore", username],
    queryFn: () => getSellerStore({ data: { username } }),
  });

  if (isLoading)
    return (
      <PageShell>
        <div className="py-20 text-center text-muted-foreground">Loading…</div>
      </PageShell>
    );
  if (!data?.seller)
    return (
      <PageShell>
        <div className="py-20 text-center text-muted-foreground">Seller not found.</div>
      </PageShell>
    );

  const s = data.seller;
  const featured = [...data.products].sort((a, b) => b.sold_count - a.sold_count).slice(0, 4);
  const latest = [...data.products].slice(0, 8);
  const socials = Object.entries(s.store_socials || {}).filter(([, v]) => !!v);

  return (
    <PageShell>
      {/* Banner */}
      <div
        className="h-40 sm:h-56 rounded-2xl overflow-hidden bg-secondary bg-center bg-cover border border-border"
        style={
          s.store_banner_url
            ? { backgroundImage: `url(${s.store_banner_url})` }
            : { background: "var(--gradient-aurora)" }
        }
      />

      {/* Header card overlapping banner */}
      <div className="bg-card border border-border rounded-2xl p-5 -mt-10 mx-3 sm:mx-6 relative">
        <div className="flex items-start gap-4 flex-wrap">
          {s.store_logo_url ? (
            <img
              src={s.store_logo_url}
              alt=""
              className="size-20 rounded-2xl object-cover border border-border bg-background -mt-12"
            />
          ) : (
            <div className="size-20 rounded-2xl bg-primary/20 border border-primary/40 grid place-items-center text-2xl font-bold text-primary uppercase -mt-12">
              {s.username.slice(0, 2)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl">{s.username}</h1>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <SellerBadge tier={s.verification_tier} level={s.seller_level} score={s.trust_score} />
              <TrustSparkline userId={s.id} currentScore={s.trust_score} />
              {s.vacation_mode ? (
                <span className="text-[10px] bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded-full border border-yellow-500/40 font-bold">
                  ON VACATION
                </span>
              ) : null}
            </div>
            {s.store_description && (
              <p className="text-sm text-muted-foreground mt-3 max-w-2xl whitespace-pre-line">
                {s.store_description}
              </p>
            )}
            {socials.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {socials.map(([k, url]) => {
                  const meta = SOCIAL_ICONS[k] ?? { Icon: Globe, label: k };
                  const Icon = meta.Icon;
                  return (
                    <a
                      key={k}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1.5 text-[11px] bg-secondary hover:bg-border border border-border rounded-full px-2.5 py-1"
                    >
                      <Icon className="size-3" /> {meta.label}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-5">
          <Metric label="Sales" value={s.total_sales.toLocaleString()} />
          <Metric
            label="Rating"
            value={s.rating > 0 ? `★ ${s.rating.toFixed(1)}` : "—"}
            hint={`${s.rating_count} reviews`}
          />
          <Metric label="Completion" value={`${s.completion_rate.toFixed(0)}%`} />
          <Metric
            label="Delivery"
            value={s.avg_delivery_minutes > 0 ? `${formatMinutes(s.avg_delivery_minutes)}` : "—"}
            hint="average"
          />
          <Metric
            label="Member since"
            value={new Date(s.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short" })}
          />
        </div>
      </div>

      {/* Announcement */}
      {s.store_announcement && (
        <div className="mt-5 flex items-start gap-2 bg-accent/10 border border-accent/30 rounded-xl p-3 text-xs">
          <Megaphone className="size-4 text-accent shrink-0 mt-0.5" />
          <p className="leading-relaxed">{s.store_announcement}</p>
        </div>
      )}

      {/* Featured */}
      {featured.length > 0 && (
        <section className="pt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-2xl flex items-center gap-2">
              <Zap className="size-5 text-primary" /> Featured
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {featured.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* Latest / All */}
      <section className="pt-8">
        <h2 className="font-display text-2xl mb-3">All listings ({data.products.length})</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
          {latest.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <section className="pt-2">
        <h2 className="font-display text-2xl mb-3">Reviews</h2>
        <div className="space-y-3 max-w-2xl">
          {data.reviews.length === 0 && (
            <p className="text-xs text-muted-foreground">No reviews yet.</p>
          )}
          {data.reviews.map((r, i) => (
            <div key={i} className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold">{r.buyer}</span>
                <span className="text-yellow-400 flex">
                  {Array.from({ length: r.rating }).map((_, j) => (
                    <Star key={j} className="size-3 fill-current" />
                  ))}
                </span>
                <Link
                  to="/s/$username"
                  params={{ username }}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {r.product_title}
                </Link>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {timeAgo(r.created_at)}
                </span>
              </div>
              {r.comment && <p className="text-xs mt-1">{r.comment}</p>}
              {r.seller_reply && (
                <p className="text-[11px] mt-2 bg-secondary rounded-md p-2 text-muted-foreground">
                  <b className="text-foreground">Reply:</b> {r.seller_reply}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-secondary/60 rounded-lg p-2.5">
      <p className="text-[9px] font-bold tracking-widest text-muted-foreground">{label.toUpperCase()}</p>
      <p className="font-mono text-sm mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function formatMinutes(m: number) {
  if (m < 60) return `${m}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
