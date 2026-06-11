import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { getSellerStore } from "@/lib/api/catalog";
import { PageShell } from "@/components/shell";
import { ProductCard } from "@/components/product-card";
import { SellerBadge } from "@/components/seller-badge";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/s/$username")({
  head: ({ params }) => ({ meta: [{ title: `${params.username} — X-VAULT seller` }] }),
  component: SellerStorePage,
});

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

  return (
    <PageShell>
      <div className="bg-card border border-border rounded-lg p-5 flex items-center gap-4 mb-6">
        <div className="size-16 rounded-full bg-primary/20 border border-primary/40 grid place-items-center text-xl font-bold text-primary uppercase">
          {s.username.slice(0, 2)}
        </div>
        <div className="flex-1">
          <h1 className="font-display text-3xl">{s.username}</h1>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <SellerBadge
              tier={s.verification_tier}
              level={s.seller_level}
              score={s.trust_score}
            />
            {s.vacation_mode ? (
              <span className="text-[10px] bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded-full border border-yellow-500/40 font-bold">
                ON VACATION
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            ★{" "}
            {s.rating > 0 ? `${s.rating.toFixed(1)} (${s.rating_count} reviews)` : "no reviews yet"}{" "}
            · {s.total_sales.toLocaleString()} sales · {s.completion_rate.toFixed(0)}% completion ·
            member since {new Date(s.created_at).getFullYear()}
          </p>
        </div>
      </div>

      <h2 className="font-display text-2xl mb-3">LISTINGS ({data.products.length})</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        {data.products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>

      <h2 className="font-display text-2xl mb-3">REVIEWS</h2>
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
              <span className="text-[10px] text-muted-foreground">{r.product_title}</span>
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
    </PageShell>
  );
}
