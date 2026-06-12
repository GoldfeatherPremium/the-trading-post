import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, HeartOff, UserPlus } from "lucide-react";
import { toggleFollowSeller, getFollowState } from "@/lib/api/follows";
import { useMe } from "@/hooks/use-me";
import { Link } from "@tanstack/react-router";

/**
 * Follow / unfollow a seller with optimistic UI.
 * Shows follower count alongside the button so social proof is visible even
 * to logged-out visitors. Logged-out users see a "Sign in to follow" link.
 */
export function FollowSellerButton({
  sellerId,
  size = "md",
}: {
  sellerId: string;
  size?: "sm" | "md";
}) {
  const { me } = useMe();
  const qc = useQueryClient();
  const key = ["followState", sellerId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => getFollowState({ data: { sellerId } }),
    staleTime: 30_000,
  });
  const mut = useMutation({
    mutationFn: () => toggleFollowSeller({ data: { sellerId } }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ following: boolean; followers: number }>(key);
      if (prev) {
        qc.setQueryData(key, {
          following: !prev.following,
          followers: prev.followers + (prev.following ? -1 : 1),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["followedFeed"] });
    },
  });

  const following = data?.following ?? false;
  const followers = data?.followers ?? 0;
  const pad = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs";
  const sizeCls = size === "sm" ? "size-3" : "size-3.5";

  if (!me) {
    return (
      <Link
        to="/auth"
        className={`inline-flex items-center gap-1.5 rounded-full bg-secondary hover:bg-border border border-border font-bold ${pad}`}
        title="Sign in to follow"
      >
        <UserPlus className={sizeCls} />
        Follow · {followers}
      </Link>
    );
  }

  if (me.id === sellerId) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-secondary border border-border font-bold text-muted-foreground ${pad}`}
      >
        <Heart className={sizeCls} /> {followers} followers
      </span>
    );
  }

  return (
    <button
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      className={`inline-flex items-center gap-1.5 rounded-full border font-bold transition-colors ${pad} ${
        following
          ? "bg-primary/15 text-primary border-primary/40 hover:bg-primary/25"
          : "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
      }`}
      title={following ? "Unfollow this seller" : "Follow to be notified of new listings"}
    >
      {following ? <HeartOff className={sizeCls} /> : <Heart className={sizeCls} />}
      {following ? "Following" : "Follow"} · {followers}
    </button>
  );
}
