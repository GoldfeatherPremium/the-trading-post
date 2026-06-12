import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, Share2, Users, MousePointerClick, ShoppingBag, Wallet } from "lucide-react";
import { toast } from "sonner";
import { getMyReferral, getMyLoyalty } from "@/lib/api/growth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usdt, dateTime } from "@/lib/format";

export const Route = createFileRoute("/account/affiliate")({
  component: AffiliatePage,
});

function AffiliatePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["affiliate"],
    queryFn: () => getMyReferral(),
  });
  const { data: loyalty } = useQuery({
    queryKey: ["loyalty"],
    queryFn: () => getMyLoyalty(),
  });

  const [origin, setOrigin] = useState("");
  if (typeof window !== "undefined" && !origin) setOrigin(window.location.origin);
  const link = data?.referral ? `${origin}/r/${data.referral.code}` : "";

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>;
  }
  if (!data) return null;
  const r = data.referral;

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="font-display text-2xl">REFER & EARN</h1>

      {/* Loyalty banner */}
      {loyalty && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Your loyalty tier
              </p>
              <p className="font-display text-xl text-primary">{loyalty.tier.label}</p>
              <p className="text-[11px] text-muted-foreground">{loyalty.tier.perk}</p>
            </div>
            <div className="text-right text-[11px]">
              <p className="font-mono">{usdt(loyalty.spend_cents)} spent</p>
              <p className="text-muted-foreground">{loyalty.orders} orders · {loyalty.referrals} referrals</p>
            </div>
          </div>
          {loyalty.nextTier && (
            <div>
              <div className="h-1.5 bg-secondary rounded">
                <div
                  className="h-full bg-primary rounded transition-all"
                  style={{ width: `${Math.round(loyalty.progressToNext * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {usdt(loyalty.nextTier.min_spend_cents - loyalty.spend_cents)} to{" "}
                <b className="text-foreground">{loyalty.nextTier.label}</b>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Referral link */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-bold">Your referral link</h2>
        <p className="text-xs text-muted-foreground">
          Earn <b className="text-primary">{r.commission_pct}%</b> in wallet credit every time
          someone you refer completes a purchase. Paid out automatically when escrow releases.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={link} className="font-mono text-xs" />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              navigator.clipboard?.writeText(link).catch(() => {});
              toast.success("Link copied");
            }}
          >
            <Copy className="size-3 mr-1" /> Copy
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (typeof navigator !== "undefined" && typeof (navigator as Navigator).share === "function") {
                (navigator as Navigator).share({ title: "Join X-VAULT", url: link }).catch(() => {});
              } else {
                navigator.clipboard?.writeText(link).catch(() => {});
                toast.success("Link copied");
              }
            }}
          >
            <Share2 className="size-3 mr-1" /> Share
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard icon={<MousePointerClick className="size-4" />} label="Clicks" value={r.click_count} />
        <StatCard icon={<Users className="size-4" />} label="Sign-ups" value={r.signup_count} />
        <StatCard icon={<ShoppingBag className="size-4" />} label="Purchases" value={r.purchase_count} />
        <StatCard icon={<Wallet className="size-4" />} label="Earned" value={usdt(r.earnings_cents)} />
      </div>

      {/* Recent clicks */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-bold mb-2">Recent activity</h2>
        {data.recentClicks.length === 0 ? (
          <p className="text-xs text-muted-foreground">No clicks yet. Share your link!</p>
        ) : (
          <ul className="space-y-1 max-h-64 overflow-auto">
            {data.recentClicks.map((c, i) => (
              <li key={i} className="text-[11px] text-muted-foreground flex justify-between">
                <span>{c.country ?? "—"}</span>
                <span className="font-mono">{dateTime(c.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
        {icon} {label}
      </div>
      <p className="font-mono text-base font-bold">{value}</p>
    </div>
  );
}
