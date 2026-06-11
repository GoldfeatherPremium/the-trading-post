import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { listSellerReviews, replyToReview } from "@/lib/api/seller";
import { timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/seller/reviews")({
  component: SellerReviews,
});

function SellerReviews() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["sellerReviews"], queryFn: () => listSellerReviews() });
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const send = useMutation({
    mutationFn: (reviewId: string) => replyToReview({ data: { reviewId, reply } }),
    onSuccess: () => {
      setReplying(null);
      setReply("");
      qc.invalidateQueries({ queryKey: ["sellerReviews"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 max-w-2xl">
      <h1 className="font-display text-2xl">REVIEWS</h1>
      {data?.reviews.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">No reviews yet.</p>
      )}
      {data?.reviews.map((r) => (
        <div key={r.id} className="bg-card border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold">{r.buyer}</span>
            <span className="text-yellow-400 flex">
              {Array.from({ length: r.rating }).map((_, j) => (
                <Star key={j} className="size-3 fill-current" />
              ))}
            </span>
            <span className="text-[10px] text-muted-foreground truncate">
              {r.product_title} · {r.order_no}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {timeAgo(r.created_at)}
            </span>
          </div>
          {r.comment && <p className="text-xs">{r.comment}</p>}
          {r.seller_reply ? (
            <p className="text-[11px] bg-secondary rounded-md p-2 text-muted-foreground">
              <b className="text-foreground">Your reply:</b> {r.seller_reply}
            </p>
          ) : replying === r.id ? (
            <div className="space-y-2">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Public reply…"
                className="text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => send.mutate(r.id)}
                  disabled={send.isPending || reply.length < 2}
                >
                  Reply
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReplying(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setReplying(r.id)}>
              Reply
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
