import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageShell } from "@/components/shell";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import {
  applyListingOptimization,
  listOptimizationCandidates,
  optimizeListing,
} from "@/lib/api/ai";
import { usdt } from "@/lib/format";
import { Sparkles, Wand2 } from "lucide-react";

export const Route = createFileRoute("/seller/optimize")({
  head: () => ({
    meta: [
      { title: "AI Listing Optimizer — X-VAULT" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SellerOptimizePage,
});

type Suggestion = Awaited<ReturnType<typeof optimizeListing>>;

function SellerOptimizePage() {
  const { me } = useMe();
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const list = useQuery({
    queryKey: ["optimizeCandidates"],
    queryFn: () => listOptimizationCandidates(),
    enabled: !!me && me.seller_status === "approved",
  });

  const run = useMutation({
    mutationFn: (productId: string) => optimizeListing({ data: { productId } }),
    onSuccess: (out, productId) => {
      setActive(productId);
      setSuggestion(out);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const apply = useMutation({
    mutationFn: (vars: { productId: string; title: string; description: string }) =>
      applyListingOptimization({ data: vars }),
    onSuccess: () => {
      toast.success("Listing updated");
      setSuggestion(null);
      setActive(null);
      qc.invalidateQueries({ queryKey: ["optimizeCandidates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!me || me.seller_status !== "approved")
    return (
      <PageShell>
        <p className="py-16 text-center text-sm text-muted-foreground">
          Approved sellers only.
        </p>
      </PageShell>
    );

  return (
    <PageShell>
      <div className="flex items-center gap-3 mb-1">
        <div className="size-10 rounded-md bg-primary/15 grid place-items-center text-primary">
          <Sparkles className="size-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl">AI Listing Optimizer</h1>
          <p className="text-[11px] text-muted-foreground">
            Sorted by lowest conversion first. Click a listing to draft a stronger title and
            description — apply with one click.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <div className="bg-card border border-border rounded-lg divide-y divide-border">
          {list.isLoading && (
            <div className="p-6 text-center text-xs text-muted-foreground">Loading…</div>
          )}
          {!list.isLoading && (list.data?.candidates.length ?? 0) === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No active listings yet.
            </div>
          )}
          {list.data?.candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => run.mutate(c.id)}
              disabled={run.isPending && active === c.id}
              className={`w-full text-left flex items-center gap-3 p-3 hover:bg-secondary/40 ${
                active === c.id ? "bg-secondary/60" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{c.title}</p>
                <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                  <span>{usdt(c.price_cents)}</span>
                  <span>{c.views} views</span>
                  <span>{c.sold_count} sold</span>
                  <span
                    className={
                      c.conv < 1
                        ? "text-yellow-400"
                        : c.conv < 3
                          ? "text-foreground/70"
                          : "text-emerald-400"
                    }
                  >
                    {c.conv.toFixed(1)}% CR
                  </span>
                </div>
              </div>
              <Wand2 className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>

        <div className="bg-card border border-border rounded-lg p-4 space-y-3 min-h-[300px]">
          {!suggestion && (
            <div className="h-full grid place-items-center text-xs text-muted-foreground py-12">
              {run.isPending ? "Optimizing…" : "Pick a listing to generate a rewrite."}
            </div>
          )}
          {suggestion && (
            <>
              <div>
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
                  RATIONALE
                </p>
                <p className="text-xs">{suggestion.rationale}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
                  WHAT CHANGED
                </p>
                <ul className="list-disc list-inside text-xs space-y-0.5">
                  {suggestion.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
                    BEFORE
                  </p>
                  <p className="text-xs font-bold">{suggestion.current.title}</p>
                  <p className="text-[11px] text-muted-foreground whitespace-pre-wrap mt-1">
                    {suggestion.current.description}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold tracking-widest text-primary">AFTER</p>
                  <p className="text-xs font-bold">{suggestion.newTitle}</p>
                  <p className="text-[11px] whitespace-pre-wrap mt-1">
                    {suggestion.newDescription}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button
                  size="sm"
                  disabled={apply.isPending || !active}
                  onClick={() =>
                    active &&
                    apply.mutate({
                      productId: active,
                      title: suggestion.newTitle,
                      description: suggestion.newDescription,
                    })
                  }
                >
                  {apply.isPending ? "Applying…" : "Apply rewrite"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSuggestion(null);
                    setActive(null);
                  }}
                >
                  Discard
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
