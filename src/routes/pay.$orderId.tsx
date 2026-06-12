import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ShieldCheck, Timer } from "lucide-react";
import { SellerBadge } from "@/components/seller-badge";
import { cancelUnpaidOrder, getPayment, simulatePaymentSent } from "@/lib/api/orders";
import { payWithWallet } from "@/lib/api/extras";
import { getWalletData } from "@/lib/api/seller";
import { PageShell } from "@/components/shell";
import { usdt, countdown } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pay/$orderId")({
  head: () => ({ meta: [{ title: "Pay with USDT — X-VAULT" }] }),
  component: PayPage,
});

function PayPage() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { data } = useQuery({
    queryKey: ["payment", orderId],
    queryFn: () => getPayment({ data: { orderId } }),
    refetchInterval: 2500,
  });

  const { data: walletData } = useQuery({ queryKey: ["wallet"], queryFn: () => getWalletData() });
  const payWallet = useMutation({
    mutationFn: () => payWithWallet({ data: { orderId } }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Paid from wallet balance!");
      navigate({ to: "/orders/$orderId", params: { orderId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const paySim = useMutation({
    mutationFn: () => simulatePaymentSent({ data: { orderId } }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Payment confirmed!");
      navigate({ to: "/orders/$orderId", params: { orderId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => cancelUnpaidOrder({ data: { orderId } }),
    onSuccess: () => {
      toast("Order cancelled");
      navigate({ to: "/browse" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (data && data.order.status !== "awaiting_payment" && data.order.status !== "expired") {
      navigate({ to: "/orders/$orderId", params: { orderId } });
    }
  }, [data?.order.status]);

  const walletAvailable = walletData?.wallet.available_cents ?? 0;

  if (!data)
    return (
      <PageShell>
        <div className="py-20 text-center text-muted-foreground">Loading…</div>
      </PageShell>
    );
  const { order, deposit } = data;
  const expired =
    order.status === "expired" || (order.expires_at !== null && order.expires_at < Date.now());

  return (
    <PageShell>
      <div className="max-w-md mx-auto py-6 space-y-4">
        <h1 className="font-display text-3xl text-center">COMPLETE PAYMENT</h1>

        {data.seller && (
          <Link
            to="/s/$username"
            params={{ username: data.seller.username }}
            className="block bg-card border border-border rounded-lg px-4 py-3 hover:border-primary/50"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground tracking-widest font-bold">SELLER</p>
                <p className="text-sm font-bold truncate">{data.seller.username}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {data.seller.total_sales.toLocaleString()} sales ·{" "}
                  {data.seller.completion_rate.toFixed(0)}% completion
                </p>
              </div>
              <div className="shrink-0">
                <SellerBadge
                  tier={data.seller.verification_tier}
                  level={data.seller.seller_level}
                  score={data.seller.trust_score}
                  size="xs"
                />
              </div>
            </div>
          </Link>
        )}

        {expired ? (
          <div className="bg-card border border-destructive/40 rounded-lg p-6 text-center space-y-3">
            <p className="text-sm text-destructive font-bold">Payment window expired</p>
            <p className="text-xs text-muted-foreground">
              The order was cancelled and any reserved stock was returned.
            </p>
            <Link to="/browse" className="text-primary text-xs font-bold">
              Back to market →
            </Link>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">{order.order_no}</span>
              <span className="flex items-center gap-1 text-yellow-400 font-mono font-bold">
                <Timer className="size-3.5" />
                {order.expires_at ? countdown(order.expires_at) : "—"}
              </span>
            </div>

            <div className="text-center py-2">
              <p className="text-[10px] text-muted-foreground tracking-widest font-bold">
                SEND EXACTLY
              </p>
              <p className="text-3xl font-mono text-accent mt-1">{usdt(deposit.amount_cents)}</p>
              {(order.discount_cents ?? 0) > 0 && (
                <p className="text-[10px] text-accent font-bold mt-1">
                  coupon {order.coupon_code}: −{usdt(order.discount_cents)} applied
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">
                network: <b className="text-foreground">{deposit.network}</b>
              </p>
            </div>

            {/* simulated QR */}
            <div className="mx-auto size-36 bg-foreground rounded-lg p-2 grid place-items-center">
              <div className="size-full rounded grid grid-cols-8 grid-rows-8 gap-px overflow-hidden">
                {Array.from({ length: 64 }).map((_, i) => (
                  <div
                    key={i}
                    className={
                      (deposit.pay_address.charCodeAt(i % deposit.pay_address.length) + i * 7) % 3
                        ? "bg-background"
                        : "bg-foreground"
                    }
                  />
                ))}
              </div>
            </div>

            <button
              className="w-full bg-secondary rounded-md p-3 text-left group"
              onClick={() => {
                navigator.clipboard.writeText(deposit.pay_address);
                toast.success("Address copied");
              }}
            >
              <p className="text-[9px] text-muted-foreground tracking-widest font-bold mb-1">
                DEPOSIT ADDRESS (TAP TO COPY)
              </p>
              <p className="text-xs font-mono break-all flex items-center gap-2">
                {deposit.pay_address}
                <Copy className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </p>
            </button>

            <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-secondary/50 rounded-md p-2.5">
              <ShieldCheck className="size-4 text-accent shrink-0" />
              Funds are held in escrow — the seller is paid only after delivery + warranty.
            </div>

            <div className="space-y-2 pt-1">
              {walletAvailable >= deposit.amount_cents && (
                <Button
                  variant="secondary"
                  className="w-full font-bold border border-accent/40 text-accent"
                  onClick={() => payWallet.mutate()}
                  disabled={payWallet.isPending}
                >
                  {payWallet.isPending
                    ? "Paying…"
                    : `Pay instantly from wallet (${usdt(walletAvailable)} available)`}
                </Button>
              )}
              <Button
                className="w-full font-bold"
                onClick={() => paySim.mutate()}
                disabled={paySim.isPending}
              >
                {paySim.isPending
                  ? "Confirming on-chain…"
                  : "I've sent the USDT (demo: confirm now)"}
              </Button>
              <Button
                variant="ghost"
                className="w-full text-xs text-muted-foreground"
                onClick={() => cancel.mutate()}
              >
                Cancel order
              </Button>
            </div>
            <p className="text-[9px] text-muted-foreground text-center leading-relaxed">
              Demo build: payment confirmation is simulated. In production this page watches the
              chain via the payment provider webhook and confirms automatically.
            </p>
          </div>
        )}
      </div>
    </PageShell>
  );
}
