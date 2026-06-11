import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap, Clock, Star, Heart } from "lucide-react";
import type { PublicProduct } from "@/lib/api/catalog";
import { listFavoriteIds, toggleFavorite } from "@/lib/api/extras";
import { useMe } from "@/hooks/use-me";
import { productImage } from "@/lib/images";
import { usdtShort } from "@/lib/format";
import { VerificationBadge } from "./seller-badge";

export function useFavorites() {
  const { me } = useMe();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["favoriteIds"],
    queryFn: () => listFavoriteIds(),
    enabled: !!me,
    staleTime: 30_000,
  });
  const toggle = useMutation({
    mutationFn: (productId: string) => toggleFavorite({ data: { productId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favoriteIds"] }),
  });
  return { ids: new Set(data?.ids ?? []), toggle, loggedIn: !!me };
}

export function FavoriteButton({
  productId,
  className,
}: {
  productId: string;
  className?: string;
}) {
  const { ids, toggle, loggedIn } = useFavorites();
  if (!loggedIn) return null;
  const active = ids.has(productId);
  return (
    <button
      aria-label={active ? "Remove from favorites" : "Add to favorites"}
      className={`size-7 grid place-items-center rounded-full bg-background/70 backdrop-blur hover:bg-background ${className ?? ""}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate(productId);
      }}
    >
      <Heart
        className={`size-3.5 ${active ? "text-destructive fill-current" : "text-foreground/70"}`}
      />
    </button>
  );
}

export function ProductCard({ product }: { product: PublicProduct }) {
  return (
    <Link
      to="/p/$slug"
      params={{ slug: product.slug }}
      className="bg-card border border-border rounded-lg overflow-hidden hover:border-primary/50 transition-colors group flex flex-col"
    >
      <div className="aspect-[16/10] bg-secondary overflow-hidden relative">
        <img
          src={productImage(product.image_key)}
          alt={product.title}
          loading="lazy"
          className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-[1.02] transition-all"
        />
        <span
          className={`absolute top-2 left-2 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${
            product.delivery_type === "auto"
              ? "bg-accent/90 text-accent-foreground"
              : "bg-blue-500/90 text-white"
          }`}
        >
          {product.delivery_type === "auto" ? (
            <Zap className="size-2.5" />
          ) : (
            <Clock className="size-2.5" />
          )}
          {product.delivery_type === "auto" ? "INSTANT" : `~${product.delivery_sla_minutes}min`}
        </span>
        <FavoriteButton productId={product.id} className="absolute bottom-2 right-2" />
        {product.delivery_type === "auto" && product.stock_count === 0 && (
          <span className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-destructive/90 text-white">
            OUT OF STOCK
          </span>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <h3 className="text-xs font-bold leading-tight line-clamp-2">{product.title}</h3>
        <p className="text-[10px] text-muted-foreground">{product.category_name}</p>
        <div className="mt-auto flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
              <span className="size-1.5 rounded-full bg-accent inline-block" />
              {product.seller.username}
              <VerificationBadge tier={product.seller.verification_tier} size="xs" showLabel={false} />
              <span className="flex items-center gap-0.5 text-yellow-400">
                <Star className="size-2.5 fill-current" />
                {product.seller.rating > 0 ? product.seller.rating.toFixed(1) : "new"}
              </span>
            </div>
            <p className="text-[9px] text-muted-foreground">{product.sold_count} sold</p>
          </div>
          <span className="text-accent font-mono text-sm whitespace-nowrap">
            {usdtShort(product.price_cents)}
          </span>
        </div>
      </div>
    </Link>
  );
}
