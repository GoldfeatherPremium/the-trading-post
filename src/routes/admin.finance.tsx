import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listDeposits, listWithdrawalQueue, reviewWithdrawal } from "@/lib/api/admin";
import { GENERIC_STATUS_CLS, dateTime, usdt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/finance")({
  component: AdminFinance,
});

function AdminFinance() {
  const qc = useQueryClient();
  const { data: wd } = useQuery({
    queryKey: ["adminWithdrawals"],
    queryFn: () => listWithdrawalQueue(),
  });
  const { data: dp } = useQuery({ queryKey: ["adminDeposits"], queryFn: () => listDeposits() });
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});

  const review = useMutation({
    mutationFn: (vars: {
      withdrawalId: string;
      action: "approve" | "reject" | "mark_sent";
      txHash?: string;
    }) => reviewWithdrawal({ data: vars }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="font-display text-2xl">WITHDRAWAL QUEUE</h1>
        {wd?.withdrawals.length === 0 && (
          <p className="text-sm text-muted-foreground">No withdrawals.</p>
        )}
        {wd?.withdrawals.map((w) => (
          <div
            key={w.id as string}
            className="bg-card border border-border rounded-lg p-3 space-y-2"
          >
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="font-bold">{w.username}</span>
              <span className="text-[10px] text-muted-foreground">
                Lv.{w.seller_level} · wallet {usdt((w.wallet_available as number) ?? 0)}
              </span>
              <span
                className={`text-[9px] font-bold px-2 py-0.5 rounded ${GENERIC_STATUS_CLS[w.status as string] ?? "bg-muted"}`}
              >
                {(w.status as string).toUpperCase()}
              </span>
              <span className="font-mono text-accent ml-auto">
                {usdt(w.amount_cents as number)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                fee {usdt(w.fee_cents as number)}
              </span>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">
              {w.network} → {w.address} {w.tx_hash ? `· tx ${w.tx_hash}` : ""} ·{" "}
              {dateTime(w.created_at as number)}
            </p>
            {["pending", "approved"].includes(w.status as string) && (
              <div className="flex gap-2 items-center flex-wrap">
                {w.status === "pending" && (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        review.mutate({ withdrawalId: w.id as string, action: "approve" })
                      }
                      disabled={review.isPending}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        review.mutate({ withdrawalId: w.id as string, action: "reject" })
                      }
                      disabled={review.isPending}
                    >
                      Reject & refund
                    </Button>
                  </>
                )}
                <Input
                  placeholder="On-chain tx hash"
                  className="h-8 text-xs w-64 font-mono"
                  value={txHashes[w.id as string] ?? ""}
                  onChange={(e) => setTxHashes({ ...txHashes, [w.id as string]: e.target.value })}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={review.isPending || !txHashes[w.id as string]}
                  onClick={() =>
                    review.mutate({
                      withdrawalId: w.id as string,
                      action: "mark_sent",
                      txHash: txHashes[w.id as string],
                    })
                  }
                >
                  Mark sent
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-2xl">DEPOSITS MONITOR</h2>
        <div className="bg-card border border-border rounded-lg p-3 space-y-1">
          {dp?.deposits.length === 0 && (
            <p className="text-sm text-muted-foreground p-2">No deposits.</p>
          )}
          {dp?.deposits.map((d) => (
            <div
              key={d.id as string}
              className="flex items-center gap-2 text-xs border-b border-border/50 pb-1 last:border-0"
            >
              <span className="font-mono text-primary">{d.order_no ?? "—"}</span>
              <span className="text-muted-foreground">{d.username}</span>
              <span className="text-[10px] text-muted-foreground font-mono truncate flex-1">
                {d.network} · {(d.pay_address as string).slice(0, 16)}…
              </span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${GENERIC_STATUS_CLS[d.status as string] ?? "bg-muted"}`}
              >
                {(d.status as string).toUpperCase()}
              </span>
              <span className="font-mono text-accent">{usdt(d.amount_cents as number)}</span>
              <span className="text-[10px] text-muted-foreground">
                {dateTime(d.created_at as number)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
