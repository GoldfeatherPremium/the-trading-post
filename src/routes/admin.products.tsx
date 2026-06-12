import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { listProductReviewQueue, reviewProduct } from "@/lib/api/admin";
import { aiScreenListing } from "@/lib/api/copilot";
import { PRODUCT_STATUS_META, usdtShort, dateTime } from "@/lib/format";
import { productImage } from "@/lib/images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/products")({
  component: AdminProducts,
});

type ScreenOut = {
  verdict: "approve" | "review" | "reject";
  risk_score: number;
  reasons: string[];
  policy_flags: string[];
  suggested_rejection_message?: string;
};

function AdminProducts() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["adminProductQueue"],
    queryFn: () => listProductReviewQueue(),
  });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [screens, setScreens] = useState<Record<string, ScreenOut>>({});
  const [pendingScreen, setPendingScreen] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: (vars: { productId: string; approve: boolean; reason?: string }) =>
      reviewProduct({ data: vars }),
    onSuccess: () => {
      toast.success("Product reviewed");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function runScreen(productId: string) {
    setPendingScreen(productId);
    try {
      const out = await aiScreenListing({ data: { productId } });
      setScreens((s) => ({ ...s, [productId]: out as ScreenOut }));
      if (out.suggested_rejection_message && out.verdict === "reject") {
        setReasons((r) => ({ ...r, [productId]: out.suggested_rejection_message! }));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPendingScreen(null);
    }
  }

  const verdictColor = (v: ScreenOut["verdict"]) =>
    v === "approve"
      ? "bg-emerald-500/15 text-emerald-400"
      : v === "reject"
        ? "bg-red-500/15 text-red-400"
        : "bg-yellow-500/15 text-yellow-400";

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl">PRODUCT APPROVALS</h1>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Prohibited: stolen/carded gift cards, hacked accounts, unauthorized credentials, listings
        violating the underlying service's terms (e.g. shared-credential subscriptions). Use the AI
        copilot to triage faster — staff always makes the final call.
      </p>
      {data?.products.map((p) => {
        const id = p.id as string;
        const meta = PRODUCT_STATUS_META[p.status as string] ?? {
          label: p.status as string,
          cls: "bg-muted",
        };
        const screen = screens[id];
        return (
          <div key={id} className="bg-card border border-border rounded-lg p-4 flex gap-3">
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
                {screen && (
                  <span
                    className={`text-[9px] font-bold px-2 py-0.5 rounded ${verdictColor(screen.verdict)}`}
                  >
                    AI: {screen.verdict.toUpperCase()} · {screen.risk_score}/100
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {p.seller_name} · {p.category_name} · {p.delivery_type} delivery ·{" "}
                {usdtShort(p.price_cents as number)} · {dateTime(p.created_at as number)}
              </p>
              <p className="text-[11px] text-muted-foreground line-clamp-2">{p.description}</p>

              {screen && (
                <div className="mt-2 rounded-md border border-border bg-secondary/30 p-2 space-y-1">
                  <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
                    AI ASSESSMENT
                  </p>
                  <ul className="text-[11px] list-disc pl-4 space-y-0.5">
                    {screen.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  {screen.policy_flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {screen.policy_flags.map((f, i) => (
                        <span
                          key={i}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {p.status === "pending_review" && (
                <div className="flex gap-2 items-center pt-1 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runScreen(id)}
                    disabled={pendingScreen === id}
                  >
                    <Sparkles className="size-3 mr-1" />
                    {pendingScreen === id ? "Screening…" : screen ? "Re-screen" : "AI screen"}
                  </Button>
                  <Input
                    placeholder="Rejection reason"
                    className="max-w-xs h-8 text-xs"
                    value={reasons[id] ?? ""}
                    onChange={(e) => setReasons({ ...reasons, [id]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    onClick={() => review.mutate({ productId: id, approve: true })}
                    disabled={review.isPending}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={review.isPending}
                    onClick={() => {
                      const reason = reasons[id];
                      if (!reason) return toast.error("A rejection reason is required.");
                      review.mutate({ productId: id, approve: false, reason });
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
