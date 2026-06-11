import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getWalletData, requestWithdrawal } from "@/lib/api/seller";
import { PageShell } from "@/components/shell";
import { GENERIC_STATUS_CLS, dateTime, usdt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/wallet")({
  head: () => ({ meta: [{ title: "Wallet — X-VAULT" }] }),
  component: WalletPage,
});

export function WalletView() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["wallet"], queryFn: () => getWalletData() });
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState<"TRC20" | "BEP20" | "ERC20">("TRC20");

  const withdraw = useMutation({
    mutationFn: () =>
      requestWithdrawal({
        data: {
          amountUsdt: parseFloat(amount),
          address: address || data?.payoutDefaults?.usdt_payout_address || "",
          network,
        },
      }),
    onSuccess: () => {
      toast.success("Withdrawal requested — finance will review it.");
      setAmount("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "AVAILABLE", v: data.wallet.available_cents, cls: "text-accent" },
          { label: "IN ESCROW", v: data.wallet.pending_cents, cls: "text-yellow-400" },
          { label: "FROZEN", v: data.wallet.frozen_cents, cls: "text-destructive" },
        ].map((x) => (
          <div key={x.label} className="bg-card border border-border rounded-lg p-4">
            <p className="text-[9px] font-bold tracking-widest text-muted-foreground">{x.label}</p>
            <p className={`font-mono text-lg mt-1 ${x.cls}`}>{usdt(x.v)}</p>
          </div>
        ))}
      </div>

      {data.walletFrozen && (
        <p className="text-xs bg-destructive/10 text-destructive border border-destructive/30 rounded-lg p-3">
          Your wallet is frozen by staff. Withdrawals are disabled — contact support.
        </p>
      )}

      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h2 className="text-xs font-bold tracking-widest">REQUEST WITHDRAWAL</h2>
        <div className="grid sm:grid-cols-[110px_1fr_110px_auto] gap-2">
          <Input
            type="number"
            min={1}
            step="0.01"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input
            placeholder={data.payoutDefaults?.usdt_payout_address ?? "USDT payout address"}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as never)}
            className="bg-secondary border border-border rounded-md px-2 text-xs"
          >
            <option>TRC20</option>
            <option>BEP20</option>
            <option>ERC20</option>
          </select>
          <Button
            onClick={() => withdraw.mutate()}
            disabled={
              withdraw.isPending ||
              !amount ||
              data.walletFrozen ||
              (!address && !data.payoutDefaults)
            }
          >
            Withdraw
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Fee: {usdt(data.fees.withdrawalFeeCents)} flat · minimum{" "}
          {usdt(data.fees.minWithdrawalCents)} · reviewed by finance staff before payout.
        </p>
      </div>

      {data.withdrawals.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-xs font-bold tracking-widest mb-2">WITHDRAWALS</h2>
          <div className="space-y-1.5">
            {data.withdrawals.map((w) => (
              <div
                key={w.id}
                className="flex items-center gap-2 text-xs border-b border-border/50 pb-1.5 last:border-0"
              >
                <span className="font-mono">{usdt(w.amount_cents)}</span>
                <span className="text-muted-foreground text-[10px] truncate flex-1">
                  {w.network} · {w.address.slice(0, 12)}…{" "}
                  {w.tx_hash ? `· tx ${w.tx_hash.slice(0, 12)}…` : ""}
                </span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${GENERIC_STATUS_CLS[w.status] ?? "bg-muted"}`}
                >
                  {w.status.toUpperCase()}
                </span>
                <span className="text-[10px] text-muted-foreground">{dateTime(w.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-xs font-bold tracking-widest mb-2">LEDGER</h2>
        {data.ledger.length === 0 && (
          <p className="text-xs text-muted-foreground">No transactions yet.</p>
        )}
        <div className="space-y-1">
          {data.ledger.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 text-xs border-b border-border/50 pb-1 last:border-0"
            >
              <span className="text-[10px] font-bold bg-secondary px-1.5 py-0.5 rounded whitespace-nowrap">
                {l.type.replaceAll("_", " ").toUpperCase()}
              </span>
              <span className="text-muted-foreground text-[10px] truncate flex-1">{l.note}</span>
              <span
                className={`font-mono whitespace-nowrap ${l.amount_cents >= 0 ? "text-accent" : "text-destructive"}`}
              >
                {l.amount_cents >= 0 ? "+" : ""}
                {usdt(l.amount_cents)}
              </span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {dateTime(l.created_at)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WalletPage() {
  return (
    <PageShell>
      <h1 className="font-display text-3xl mb-4">WALLET</h1>
      <WalletView />
    </PageShell>
  );
}
