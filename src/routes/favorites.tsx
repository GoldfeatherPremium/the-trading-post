import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { listFavoriteProducts } from "@/lib/api/extras";
import { PageShell } from "@/components/shell";
import { FavoriteButton } from "@/components/product-card";
import { productImage } from "@/lib/images";
import { usdtShort } from "@/lib/format";
import { useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/favorites")({
  head: () => ({ meta: [{ title: "Favorites — X-VAULT" }] }),
  component: FavoritesPage,
});

function FavoritesPage() {
  const { me, isLoading } = useMe();
  const { data } = useQuery({
    queryKey: ["favoriteProducts"],
    queryFn: () => listFavoriteProducts(),
    enabled: !!me,
  });

  return (
    <PageShell>
      <h1 className="font-display text-3xl mb-4 flex items-center gap-2">
        <Heart className="size-6 text-destructive" /> FAVORITES
      </h1>
      {!me && !isLoading && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Sign in to save favorites.
        </p>
      )}
      {me && data?.products.length === 0 && (
        <div className="py-16 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Nothing saved yet — tap the ♥ on any product to keep it here.
          </p>
          <Link to="/browse" className="text-primary text-sm font-bold">
            Browse the market →
          </Link>
        </div>
      )}
      <div className="space-y-2">
        {data?.products.map((p) => (
          <Link
            key={p.id as string}
            to="/p/$slug"
            params={{ slug: p.slug as string }}
            className="bg-card border border-border rounded-lg p-3 flex items-center gap-3 hover:border-primary/50"
          >
            <div className="size-14 rounded-md overflow-hidden bg-secondary shrink-0">
              <img
                src={productImage(p.image_key as string)}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate">{p.title}</p>
              <p className="text-[10px] text-muted-foreground">
                {p.category_name} · {p.seller_name} ★{" "}
                {(p.seller_rating as number) > 0 ? (p.seller_rating as number).toFixed(1) : "new"} ·{" "}
                {p.delivery_type === "auto" ? `⚡ ${p.stock_count} in stock` : "🕐 manual delivery"}
              </p>
              {p.status !== "active" && (
                <p className="text-[10px] text-yellow-400 font-bold">Currently unavailable</p>
              )}
            </div>
            <span className="font-mono text-accent text-sm">
              {usdtShort(p.price_cents as number)}
            </span>
            <FavoriteButton productId={p.id as string} />
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
