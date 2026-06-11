import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { getProductStock, removeStockItem, uploadStock } from "@/lib/api/seller";
import { dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/seller/stock/$productId")({
  component: StockManager,
});

const STATUS_CLS: Record<string, string> = {
  available: "bg-accent/15 text-accent",
  reserved: "bg-yellow-500/15 text-yellow-400",
  delivered: "bg-blue-500/15 text-blue-400",
  invalid: "bg-muted text-muted-foreground",
};

function StockManager() {
  const { productId } = Route.useParams();
  const qc = useQueryClient();
  const [codes, setCodes] = useState("");
  const { data } = useQuery({
    queryKey: ["stock", productId],
    queryFn: () => getProductStock({ data: { productId } }),
  });

  const upload = useMutation({
    mutationFn: () => uploadStock({ data: { productId, codes } }),
    onSuccess: (r) => {
      toast.success(
        `Added ${r.added} codes${r.duplicates ? ` · ${r.duplicates} duplicates skipped` : ""}`,
      );
      setCodes("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (stockItemId: string) => removeStockItem({ data: { stockItemId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stock", productId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <Link to="/seller/products" className="text-[10px] text-primary font-bold">
          ← BACK TO PRODUCTS
        </Link>
        <h1 className="font-display text-2xl mt-1">STOCK · {data.product.title}</h1>
        <div className="flex gap-2 mt-2">
          {data.counts.map((c) => (
            <span
              key={c.status}
              className={`text-[10px] font-bold px-2 py-1 rounded ${STATUS_CLS[c.status] ?? "bg-muted"}`}
            >
              {c.status.toUpperCase()}: {c.c}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h2 className="text-xs font-bold tracking-widest">BULK UPLOAD CODES</h2>
        <Textarea
          rows={6}
          value={codes}
          onChange={(e) => setCodes(e.target.value)}
          placeholder={"One code per line:\nXXXX-YYYY-ZZZZ\nAAAA-BBBB-CCCC"}
          className="font-mono text-xs"
        />
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={() => upload.mutate()}
            disabled={upload.isPending || !codes.trim()}
          >
            Upload {codes.split("\n").filter((l) => l.trim()).length || ""} codes
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Encrypted at rest (AES-256) · duplicates auto-skipped · revealed only to the buyer on
            delivery.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-xs font-bold tracking-widest mb-2">INVENTORY ({data.items.length})</h2>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {data.items.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 text-xs border-b border-border/50 pb-1 last:border-0"
            >
              <span className="font-mono text-muted-foreground">#{s.id.slice(0, 8)}</span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS_CLS[s.status] ?? "bg-muted"}`}
              >
                {s.status.toUpperCase()}
              </span>
              <span className="text-[10px] text-muted-foreground flex-1">
                added {dateTime(s.created_at)}
                {s.delivered_at ? ` · delivered ${dateTime(s.delivered_at)}` : ""}
              </span>
              {s.status === "available" && (
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate(s.id)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
