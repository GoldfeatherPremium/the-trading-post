import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, Eye, EyeOff, Repeat } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/shell";
import { buyerListSubscriptions } from "@/lib/api/subscriptions";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { dateTime } from "@/lib/format";

export const Route = createFileRoute("/account/subscriptions")({
  head: () => ({ meta: [{ title: "My Subscriptions — X-VAULT" }] }),
  component: BuyerSubs,
});

function BuyerSubs() {
  const { me } = useMe();
  const { data, isLoading } = useQuery({
    queryKey: ["mySubs"],
    queryFn: () => buyerListSubscriptions(),
    enabled: !!me,
    refetchInterval: 30_000,
  });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  return (
    <PageShell>
      <h1 className="font-display text-2xl mb-1 flex items-center gap-2">
        <Repeat className="size-5 text-primary" /> MY SUBSCRIPTIONS
      </h1>
      <p className="text-[11px] text-muted-foreground mb-4">
        Shared subscription slots you currently hold. Credentials are only visible while a seat is
        active.
      </p>
      {!me && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Sign in to view your subscriptions.
        </p>
      )}
      {me && !isLoading && (data?.slots ?? []).length === 0 && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No active subscription slots.
        </p>
      )}
      <div className="space-y-2">
        {data?.slots.map((s) => {
          const active = s.status === "active";
          const show = revealed[s.id];
          return (
            <div key={s.id} className="bg-card border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold flex-1 truncate">{s.productTitle}</p>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    active ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s.status.toUpperCase()}
                </span>
                {s.orderId && (
                  <Link
                    to="/orders/$orderId"
                    params={{ orderId: s.orderId }}
                    className="text-[10px] text-primary underline"
                  >
                    Order
                  </Link>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Seller @{s.sellerUsername} · Slot {s.label}
                {s.startedAt && ` · started ${dateTime(s.startedAt)}`}
                {s.expiresAt && ` · expires ${dateTime(s.expiresAt)}`}
              </p>
              {active && s.credentials && (
                <div className="border border-border rounded-md bg-background/40 p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-widest text-muted-foreground">
                      ACCESS DETAILS
                    </span>
                    <div className="ml-auto flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRevealed((r) => ({ ...r, [s.id]: !r[s.id] }))}
                      >
                        {show ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(s.credentials!);
                          toast.success("Copied");
                        }}
                      >
                        <Copy className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <pre className="text-[11px] whitespace-pre-wrap break-all font-mono">
                    {show ? s.credentials : "•".repeat(Math.min(48, s.credentials.length))}
                  </pre>
                </div>
              )}
              {!active && (
                <p className="text-[11px] text-muted-foreground italic">
                  Seat is not active. Contact the seller to renew or replace it.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
