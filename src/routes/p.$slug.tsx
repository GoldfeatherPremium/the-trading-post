import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Zap, Clock, ShieldCheck, Star, MessageSquare, Minus, Plus } from "lucide-react";
import { getProduct, getRelatedProducts } from "@/lib/api/catalog";
import { createOrder } from "@/lib/api/orders";
import { startProductConversation } from "@/lib/api/chat";
import { checkCoupon } from "@/lib/api/extras";
import { FavoriteButton, ProductCard } from "@/components/product-card";
import { SellerBadge } from "@/components/seller-badge";
import { useMe } from "@/hooks/use-me";
import { PageShell } from "@/components/shell";
import { productImage } from "@/lib/images";
import { usdt, usdtShort, timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const SITE = "https://warm-trade-space.lovable.app";

export const Route = createFileRoute("/p/$slug")({
  loader: async ({ params, context }) => {
    try {
      const data = await context.queryClient.ensureQueryData({
        queryKey: ["product", params.slug],
        queryFn: () => getProduct({ data: { slug: params.slug } }),
      });
      return { product: data?.product ?? null };
    } catch {
      return { product: null };
    }
  },
  head: ({ params, loaderData }) => {
    const p = loaderData?.product;
    const url = `${SITE}/p/${params.slug}`;
    if (!p) {
      return {
        meta: [{ title: "Product — X-VAULT" }],
        links: [{ rel: "canonical", href: url }],
      };
    }
    const title = `${p.title} — ${p.category_name} | X-VAULT`;
    const desc = (p.description || `Buy ${p.title} on X-VAULT — escrow-protected, ${p.warranty_hours}h warranty.`)
      .replace(/\s+/g, " ")
      .slice(0, 155);
    const img = p.image_key && !p.image_key.startsWith("upload:")
      ? `${SITE}${productImage(p.image_key)}`
      : undefined;
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.title,
      description: desc,
      sku: p.id,
      category: p.category_name,
      ...(img ? { image: img } : {}),
      brand: { "@type": "Brand", name: p.seller.username },
      offers: {
        "@type": "Offer",
        url,
        priceCurrency: "USD",
        price: (p.price_cents / 100).toFixed(2),
        availability:
          p.delivery_type === "manual" || p.stock_count > 0
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        seller: { "@type": "Organization", name: p.seller.username },
      },
      ...(p.seller.rating_count > 0
        ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: p.seller.rating.toFixed(1),
              reviewCount: p.seller.rating_count,
            },
          }
        : {}),
    };
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:type", content: "product" },
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
      ],
    };
  },
  component: ProductPage,
});

function ProductPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { me } = useMe();
  const [qty, setQty] = useState(1);
  const [buyerInfo, setBuyerInfo] = useState("");
  const [variantId, setVariantId] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; pctOff: number } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["product", slug],
    queryFn: () => getProduct({ data: { slug } }),
  });

  const buy = useMutation({
    mutationFn: () =>
      createOrder({
        data: {
          productId: data!.product!.id,
          qty,
          buyerInfo: buyerInfo || undefined,
          network: "TRC20",
          couponCode: coupon?.code,
          variantId: variantId ?? undefined,
        },
      }),
    onSuccess: (r) => navigate({ to: "/pay/$orderId", params: { orderId: r.orderId } }),
    onError: (e: Error) => toast.error(e.message),
  });
  const chat = useMutation({
    mutationFn: () => startProductConversation({ data: { productId: data!.product!.id } }),
    onSuccess: (r) => navigate({ to: "/chat", search: { c: r.conversationId } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const applyCoupon = useMutation({
    mutationFn: () =>
      checkCoupon({
        data: { code: couponInput, totalUsdt: ((data!.product!.price_cents ?? 0) * qty) / 100 },
      }),
    onSuccess: (r) => {
      setCoupon(r);
      toast.success(`Coupon applied: ${r.pctOff}% off`);
    },
    onError: (e: Error) => {
      setCoupon(null);
      toast.error(e.message);
    },
  });

  // recently viewed (client-side, shown on the homepage)
  const slug2 = data?.product?.slug;
  useEffect(() => {
    const prod = data?.product;
    if (!prod) return;
    try {
      const key = "xv_recent";
      const prev: Array<{
        slug: string;
        title: string;
        image_key: string | null;
        price_cents: number;
      }> = JSON.parse(localStorage.getItem(key) ?? "[]");
      const next = [
        {
          slug: prod.slug,
          title: prod.title,
          image_key: prod.image_key,
          price_cents: prod.price_cents,
        },
        ...prev.filter((x) => x.slug !== prod.slug),
      ].slice(0, 8);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug2]);

  if (isLoading)
    return (
      <PageShell>
        <div className="py-20 text-center text-muted-foreground">Loading…</div>
      </PageShell>
    );
  const p = data?.product;
  if (!p)
    return (
      <PageShell>
        <div className="py-20 text-center space-y-3">
          <p className="text-muted-foreground">This product is not available.</p>
          <Link to="/browse" className="text-primary text-sm font-bold">
            Browse the market →
          </Link>
        </div>
      </PageShell>
    );

  const requireAuth = (fn: () => void) => {
    if (!me) navigate({ to: "/auth", search: { redirect: `/p/${slug}` } });
    else fn();
  };
  const outOfStock = p.delivery_type === "auto" && p.stock_count === 0;
  const variants = data.variants ?? [];
  const selectedVariant = variants.find((v) => v.id === variantId);
  const unitPrice = selectedVariant?.price_cents ?? p.price_cents;
  const grossTotal = unitPrice * qty;
  const discount = coupon ? Math.round((grossTotal * coupon.pctOff) / 100) : 0;
  const total = grossTotal - discount;

  return (
    <PageShell>
      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
          <div className="aspect-[16/9] bg-secondary rounded-lg overflow-hidden border border-border">
            <img
              src={productImage(p.image_key)}
              alt={p.title}
              className="w-full h-full object-cover"
            />
          </div>

          <div>
            <div className="flex flex-wrap gap-2 mb-2 text-[10px] font-bold">
              <Link
                to="/browse"
                search={{ category: p.category_slug }}
                className="bg-secondary px-2 py-1 rounded"
              >
                {p.category_name}
              </Link>
              {p.region && <span className="bg-secondary px-2 py-1 rounded">🌍 {p.region}</span>}
              {p.platform && (
                <span className="bg-secondary px-2 py-1 rounded">🎮 {p.platform}</span>
              )}
              {p.risk_tier === "high" && (
                <span className="bg-yellow-500/15 text-yellow-400 px-2 py-1 rounded">
                  HIGH-RISK · EXTENDED WARRANTY
                </span>
              )}
            </div>
            <div className="flex items-start gap-2">
              <h1 className="font-display text-3xl leading-tight flex-1">{p.title}</h1>
              <FavoriteButton productId={p.id} className="bg-secondary" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {p.sold_count} sold · {p.views} views
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-2">
              DESCRIPTION
            </h2>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{p.description}</p>
          </div>

          <div className="bg-card border border-accent/30 rounded-lg p-4 flex gap-3">
            <ShieldCheck className="size-8 text-accent shrink-0" />
            <div className="text-xs leading-relaxed">
              <p className="font-bold text-accent mb-1">How escrow protects you</p>
              <p className="text-muted-foreground">
                Your USDT is held by X-VAULT — the seller never sees it until you confirm delivery{" "}
                <b>and</b> your {p.warranty_hours}h warranty passes without a dispute. Problems?
                Open a dispute and our team mediates with full refund power.
              </p>
            </div>
          </div>

          {/* Reviews */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-3">
              REVIEWS ({data.reviews.length})
            </h2>
            {data.reviews.length === 0 && (
              <p className="text-xs text-muted-foreground">No reviews yet.</p>
            )}
            <div className="space-y-4">
              {data.reviews.map((r, i) => (
                <div key={i} className="border-b border-border/60 pb-3 last:border-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold">{r.buyer}</span>
                    <span className="text-yellow-400 flex">
                      {Array.from({ length: r.rating }).map((_, j) => (
                        <Star key={j} className="size-3 fill-current" />
                      ))}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {timeAgo(r.created_at)}
                    </span>
                  </div>
                  {r.comment && <p className="text-xs mt-1">{r.comment}</p>}
                  {r.seller_reply && (
                    <p className="text-[11px] mt-2 bg-secondary rounded-md p-2 text-muted-foreground">
                      <b className="text-foreground">Seller:</b> {r.seller_reply}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Buy box */}
        <div className="space-y-4 lg:sticky lg:top-20 self-start">
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-mono text-accent">{usdtShort(unitPrice)}</span>
              <span
                className={`text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 ${
                  p.delivery_type === "auto"
                    ? "bg-accent/15 text-accent"
                    : "bg-blue-500/15 text-blue-400"
                }`}
              >
                {p.delivery_type === "auto" ? (
                  <Zap className="size-3" />
                ) : (
                  <Clock className="size-3" />
                )}
                {p.delivery_type === "auto"
                  ? "INSTANT DELIVERY"
                  : `DELIVERY ~${p.delivery_sla_minutes} MIN`}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-1">
              {p.delivery_type === "auto" && (
                <p>
                  Stock:{" "}
                  <b className={p.stock_count > 0 ? "text-accent" : "text-destructive"}>
                    {p.stock_count}
                  </b>
                </p>
              )}
              <p>
                Warranty: <b className="text-foreground">{p.warranty_hours}h</b> after confirmation
                {p.insurance_days > 0 && (
                  <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                    🛡 +{p.insurance_days}d INSURANCE
                  </span>
                )}
              </p>
            </div>

            {variants.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
                  SELECT OPTION
                </p>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVariantId(variantId === v.id ? null : v.id)}
                      className={`px-3 py-2 rounded-md text-xs font-bold border ${
                        variantId === v.id
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-secondary hover:bg-border"
                      }`}
                    >
                      {v.title} · {usdtShort(v.price_cents)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Qty</span>
              <div className="flex items-center gap-2 bg-secondary rounded-md p-1">
                <button
                  className="size-7 grid place-items-center rounded hover:bg-border"
                  onClick={() => setQty(Math.max(p.min_qty, qty - 1))}
                >
                  <Minus className="size-3" />
                </button>
                <span className="w-8 text-center text-sm font-mono">{qty}</span>
                <button
                  className="size-7 grid place-items-center rounded hover:bg-border"
                  onClick={() =>
                    setQty(
                      Math.min(
                        p.max_qty,
                        p.delivery_type === "auto" ? Math.min(p.stock_count, qty + 1) : qty + 1,
                      ),
                    )
                  }
                >
                  <Plus className="size-3" />
                </button>
              </div>
              <span className="ml-auto text-sm font-mono">{usdt(total)}</span>
            </div>

            {p.delivery_type === "manual" && p.required_info && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold">
                  Required info:{" "}
                  <span className="font-normal text-muted-foreground">{p.required_info}</span>
                </p>
                <Textarea
                  value={buyerInfo}
                  onChange={(e) => setBuyerInfo(e.target.value)}
                  placeholder="Enter the info the seller needs to deliver…"
                  className="text-xs min-h-16"
                />
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="Coupon code"
                className="flex-1 bg-secondary border border-border rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="text-xs"
                disabled={!couponInput.trim() || applyCoupon.isPending}
                onClick={() => requireAuth(() => applyCoupon.mutate())}
              >
                Apply
              </Button>
            </div>
            {coupon && (
              <p className="text-[11px] text-accent font-bold">
                ✓ {coupon.code}: −{coupon.pctOff}% ({usdt(discount)} off)
              </p>
            )}
            <Button
              className="w-full font-bold tracking-wide"
              disabled={outOfStock || buy.isPending}
              onClick={() => requireAuth(() => buy.mutate())}
            >
              {outOfStock
                ? "OUT OF STOCK"
                : buy.isPending
                  ? "Creating order…"
                  : `BUY NOW · ${usdt(total)}`}
            </Button>
            <Button
              variant="secondary"
              className="w-full text-xs"
              onClick={() => requireAuth(() => chat.mutate())}
            >
              <MessageSquare className="size-3.5" /> Chat with seller
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">
              Pay with USDT · TRC-20 / BEP-20 · escrow protected
            </p>
          </div>

          {/* Seller card */}
          <Link
            to="/s/$username"
            params={{ username: p.seller.username }}
            className="bg-card border border-border rounded-lg p-4 block hover:border-primary/50 space-y-3"
          >
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-full bg-primary/20 border border-primary/40 grid place-items-center text-sm font-bold text-primary uppercase">
                {p.seller.username.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{p.seller.username}</p>
                <p className="text-[10px] text-muted-foreground">
                  ★{" "}
                  {p.seller.rating > 0
                    ? `${p.seller.rating.toFixed(1)} (${p.seller.rating_count})`
                    : "new seller"}{" "}
                  · {p.seller.total_sales.toLocaleString()} sales
                </p>
              </div>
              {p.seller.vacation_mode ? (
                <span className="text-[9px] bg-yellow-500/15 text-yellow-400 px-2 py-1 rounded font-bold">
                  AWAY
                </span>
              ) : (
                <span className="size-2 rounded-full bg-accent" title="online" />
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <SellerBadge
                tier={p.seller.verification_tier}
                level={p.seller.seller_level}
                score={p.seller.trust_score}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <SellerStat label="Completion" value={`${p.seller.completion_rate.toFixed(0)}%`} />
              <SellerStat
                label="Refunds"
                value={
                  p.seller.total_sales > 0
                    ? `${((p.seller.refund_count / p.seller.total_sales) * 100).toFixed(1)}%`
                    : "—"
                }
              />
              <SellerStat
                label="Disputes"
                value={
                  p.seller.total_sales > 0
                    ? `${((p.seller.dispute_count / p.seller.total_sales) * 100).toFixed(1)}%`
                    : "—"
                }
              />
            </div>
          </Link>
        </div>
      </div>

      <RelatedProducts productId={p.id} />
    </PageShell>
  );
}

function RelatedProducts({ productId }: { productId: string }) {
  const { data } = useQuery({
    queryKey: ["relatedProducts", productId],
    queryFn: () => getRelatedProducts({ data: { productId, limit: 8 } }),
  });
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl mb-3 flex items-center gap-2">
        <Sparkle /> RELATED PRODUCTS
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((it) => (
          <ProductCard key={it.id} product={it} />
        ))}
      </div>
    </section>
  );
}

function SellerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-secondary/60 rounded-md px-2 py-1.5 text-center">
      <p className="text-[8px] tracking-widest font-bold text-muted-foreground">
        {label.toUpperCase()}
      </p>
      <p className="text-[11px] font-mono mt-0.5">{value}</p>
    </div>
  );
}


function Sparkle() {
  return <Star className="size-4 text-primary" />;
}
