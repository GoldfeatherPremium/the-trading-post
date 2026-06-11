import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listProductReviewQueue, reviewProduct } from "@/lib/api/admin";
import { PRODUCT_STATUS_META, usdtShort, dateTime } from "@/lib/format";
import { productImage } from "@/lib/images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/products")({
  component: AdminProducts,
});

function AdminProducts() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["adminProductQueue"],
    queryFn: () => listProductReviewQueue(),
  });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const review = useMutation({
    mutationFn: (vars: { productId: string; approve: boolean; reason?: string }) =>
      reviewProduct({ data: vars }),
    onSuccess: () => {
      toast.success("Product reviewed");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl">PRODUCT APPROVALS</h1>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Prohibited: stolen/carded gift cards, hacked accounts, unauthorized credentials, listings
        violating the underlying service's terms (e.g. shared-credential subscriptions).
      </p>
      {data?.products.map((p) => {
        const meta = PRODUCT_STATUS_META[p.status as string] ?? {
          label: p.status as string,
          cls: "bg-muted",
        };
        return (
          <div
            key={p.id as string}
            className="bg-card border border-border rounded-lg p-4 flex gap-3"
          >
            <div className="size-16 rounded-md overflow-hidden bg-secondary shrink-0">
              <img
                src={productImage(p.image_key as string)}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-bold">{p.title}</p>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${meta.cls}`}>
                  {meta.label.toUpperCase()}
                </span>
                {p.risk_tier === "high" && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                    HIGH RISK
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {p.seller_name} · {p.category_name} · {p.delivery_type} delivery ·{" "}
                {usdtShort(p.price_cents as number)} · {dateTime(p.created_at as number)}
              </p>
              <p className="text-[11px] text-muted-foreground line-clamp-2">{p.description}</p>
              {p.status === "pending_review" && (
                <div className="flex gap-2 items-center pt-1">
                  <Input
                    placeholder="Rejection reason"
                    className="max-w-xs h-8 text-xs"
                    value={reasons[p.id as string] ?? ""}
                    onChange={(e) => setReasons({ ...reasons, [p.id as string]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    onClick={() => review.mutate({ productId: p.id as string, approve: true })}
                    disabled={review.isPending}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={review.isPending}
                    onClick={() => {
                      const reason = reasons[p.id as string];
                      if (!reason) return toast.error("A rejection reason is required.");
                      review.mutate({ productId: p.id as string, approve: false, reason });
                    }}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
