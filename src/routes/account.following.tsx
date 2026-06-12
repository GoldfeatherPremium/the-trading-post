import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Store } from "lucide-react";
import { toast } from "sonner";
import { getFollowedFeed, toggleFollowSeller } from "@/lib/api/follows";
import { VerificationBadge, TrustScore } from "@/components/seller-badge";
import { productImage } from "@/lib/images";
import { usdtShort, timeAgo } from "@/lib/format";

export const Route = createFileRoute("/account/following")({
  head: () => ({ meta: [{ title: "Following — X-VAULT" }] }),
  component: FollowingPage,
});

function FollowingPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["followedFeed"],
    queryFn: () => getFollowedFeed(),
  });
  const unfollow = useMutation({
    mutationFn: (sellerId: string) => toggleFollowSeller({ data: { sellerId } }),
    onSuccess: () => {
      toast.success("Unfollowed");
      qc.invalidateQueries({ queryKey: ["followedFeed"] });
      qc.invalidateQueries({ queryKey: ["followState"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="font-display text-2xl">FOLLOWING</h1>

      {(!data || data.sellers.length === 0) && (
        <div className="rounded-lg border border-border bg-card p-8 text-center space-y-2">
          <Store className="size-8 mx-auto text-muted-foreground" />
          <p className="text-sm font-bold">You're not following anyone yet</p>
          <p className="text-xs text-muted-foreground">
            Follow sellers you trust to get notified when they list something new.
          </p>
          <Link
            to="/browse"
            className="inline-block mt-2 text-xs font-bold text-primary hover:underline"
          >
            Discover sellers →
          </Link>
        </div>
      )}

      {data && data.sellers.length > 0 && (
        <>
          <section>
            <h2 className="text-[10px] font-bold tracking-widest text-muted-foreground mb-2">
              SELLERS ({data.sellers.length})
            </h2>
            <ul className="space-y-1.5">
              {data.sellers.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 bg-card border border-border rounded-lg p-2.5"
                >
                  <Link
                    to="/s/$username"
                    params={{ username: s.username }}
                    className="flex items-center gap-3 flex-1 min-w-0"
                  >
                    <span className="size-10 rounded-full bg-primary/15 border border-primary/40 grid place-items-center text-xs font-bold text-primary uppercase">
                      {s.username.slice(0, 2)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-bold truncate">{s.username}</p>
                        <VerificationBadge
                          tier={s.verification_tier as never}
                          size="xs"
                          showLabel={false}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>Lvl {s.seller_level}</span>
                        <TrustScore score={s.trust_score} />
                        <span>· followed {timeAgo(s.followed_at)}</span>
                      </div>
                    </div>
                  </Link>
                  <button
                    onClick={() => unfollow.mutate(s.id)}
                    disabled={unfollow.isPending}
                    className="text-[11px] font-bold text-muted-foreground hover:text-destructive border border-border hover:border-destructive rounded-full px-3 py-1"
                    title="Unfollow"
                  >
                    <Heart className="size-3 inline mr-1 fill-current" />
                    Unfollow
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-[10px] font-bold tracking-widest text-muted-foreground mb-2">
              LATEST LISTINGS
            </h2>
            {data.newListings.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No active listings from sellers you follow.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {data.newListings.map((p) => (
                  <Link
                    key={p.id}
                    to="/p/$slug"
                    params={{ slug: p.slug }}
                    className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50"
                  >
                    <div className="aspect-[16/10] bg-secondary overflow-hidden">
                      <img
                        src={productImage(p.image_key)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-2.5">
                      <p className="text-[11px] font-bold line-clamp-1">{p.title}</p>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">
                        {p.seller_username} · {timeAgo(p.created_at)}
                      </p>
                      <p className="text-[11px] font-mono text-accent mt-1">
                        {usdtShort(p.price_cents)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
