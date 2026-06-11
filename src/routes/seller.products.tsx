import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pause, Play, Boxes, Pencil } from "lucide-react";
import { listMyProducts, setProductPaused } from "@/lib/api/seller";
import { PRODUCT_STATUS_META, usdtShort } from "@/lib/format";
import { productImage } from "@/lib/images";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/seller/products")({
  component: SellerProducts,
});

function SellerProducts() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["myProducts"], queryFn: () => listMyProducts() });
  const pause = useMutation({
    mutationFn: (vars: { productId: string; paused: boolean }) => setProductPaused({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myProducts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="font-display text-2xl">MY PRODUCTS</h1>
        <Button size="sm" onClick={() => navigate({ to: "/seller/new-product", search: {} })}>
          <Plus className="size-4" /> New listing
        </Button>
      </div>

      {data?.products.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No products yet — create your first listing.
        </p>
      )}

      <div className="space-y-2">
        {data?.products.map((p) => {
          const meta = PRODUCT_STATUS_META[p.status as string] ?? {
            label: p.status as string,
            cls: "bg-muted",
          };
          return (
            <div
              key={p.id as string}
              className="bg-card border border-border rounded-lg p-3 flex items-center gap-3"
            >
              <div className="size-12 rounded-md overflow-hidden bg-secondary shrink-0">
                <img
                  src={productImage(p.image_key as string)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{p.title}</p>
                <p className="text-[10px] text-muted-foreground">
                  {p.category_name} ·{" "}
                  {p.delivery_type === "auto" ? `⚡ stock ${p.stock_count}` : "🕐 manual"} ·{" "}
                  {p.sold_count} sold
                </p>
                {p.status === "rejected" && p.reject_reason && (
                  <p className="text-[10px] text-destructive mt-0.5">Rejected: {p.reject_reason}</p>
                )}
              </div>
              <span
                className={`text-[9px] font-bold px-2 py-1 rounded whitespace-nowrap ${meta.cls}`}
              >
                {meta.label.toUpperCase()}
              </span>
              <span className="font-mono text-accent text-sm">
                {usdtShort(p.price_cents as number)}
              </span>
              <div className="flex gap-1">
                {p.delivery_type === "auto" && (
                  <Link
                    to="/seller/stock/$productId"
                    params={{ productId: p.id as string }}
                    className="size-8 grid place-items-center rounded-md bg-secondary hover:bg-border"
                    title="Manage stock"
                  >
                    <Boxes className="size-4" />
                  </Link>
                )}
                <button
                  className="size-8 grid place-items-center rounded-md bg-secondary hover:bg-border"
                  title="Edit"
                  onClick={() =>
                    navigate({ to: "/seller/new-product", search: { edit: p.id as string } })
                  }
                >
                  <Pencil className="size-4" />
                </button>
                {["active", "out_of_stock", "paused"].includes(p.status as string) && (
                  <button
                    className="size-8 grid place-items-center rounded-md bg-secondary hover:bg-border"
                    title={p.status === "paused" ? "Resume" : "Pause"}
                    onClick={() =>
                      pause.mutate({ productId: p.id as string, paused: p.status !== "paused" })
                    }
                  >
                    {p.status === "paused" ? (
                      <Play className="size-4" />
                    ) : (
                      <Pause className="size-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
