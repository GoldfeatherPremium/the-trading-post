import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listMyOrders } from "@/lib/api/orders";
import { ORDER_STATUS_META, countdown, dateTime, usdt } from "@/lib/format";
import { productImage } from "@/lib/images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/seller/orders")({
  component: SellerOrders,
});

const NEEDS_ACTION = ["paid", "delivering", "disputed"];

function SellerOrders() {
  const { data } = useQuery({
    queryKey: ["sellerOrders"],
    queryFn: () => listMyOrders({ data: { role: "seller" } }),
    refetchInterval: 10_000,
  });

  const [tab, setTab] = useState<"all" | "action" | "disputed" | "done">("all");
  const [search, setSearch] = useState("");

  const all = data?.orders ?? [];
  const counts = {
    all: all.length,
    action: all.filter((o) => ["paid", "delivering"].includes(o.status)).length,
    disputed: all.filter((o) => o.status === "disputed").length,
    done: all.filter((o) => ["completed", "released"].includes(o.status)).length,
  };
  const filtered = all.filter((o) => {
    if (tab === "action" && !["paid", "delivering"].includes(o.status)) return false;
    if (tab === "disputed" && o.status !== "disputed") return false;
    if (tab === "done" && !["completed", "released"].includes(o.status)) return false;
    if (search) {
      const s = search.toLowerCase();
      if (
        !o.order_no.toLowerCase().includes(s) &&
        !o.product_title.toLowerCase().includes(s) &&
        !o.counterparty.toLowerCase().includes(s)
      )
        return false;
    }
    return true;
  });
  const sorted = [...filtered].sort(
    (a, b) => Number(NEEDS_ACTION.includes(b.status)) - Number(NEEDS_ACTION.includes(a.status)),
  );

  const exportCsv = () => {
    const rows = [
      ["order_no", "product", "buyer", "qty", "total_usdt", "net_usdt", "status", "created_at"],
      ...all.map((o) => [
        o.order_no,
        `"${o.product_title.replaceAll('"', '""')}"`,
        o.counterparty,
        o.qty,
        (o.total_cents / 100).toFixed(2),
        (o.seller_net_cents / 100).toFixed(2),
        o.status,
        new Date(o.created_at).toISOString(),
      ]),
    ];
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-display text-2xl">SALES ORDERS</h1>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={all.length === 0}>
          <Download className="size-3.5" /> Export CSV
        </Button>
      </div>
      <div className="flex gap-1.5 flex-wrap items-center">
        {(
          [
            ["all", "All"],
            ["action", "Needs action"],
            ["disputed", "Disputed"],
            ["done", "Completed"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${
              tab === k ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-border"
            }`}
          >
            {label} ({counts[k]})
          </button>
        ))}
        <Input
          placeholder="Search order / product / buyer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs max-w-56 ml-auto"
        />
      </div>
      {sorted.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {all.length === 0 ? "No sales yet." : "No orders match this filter."}
        </p>
      )}
      <div className="space-y-2">
        {sorted.map((o) => {
          const meta = ORDER_STATUS_META[o.status] ?? { label: o.status, cls: "bg-muted" };
          const slaDeadline = (o.paid_at ?? o.created_at) + o.delivery_sla_minutes * 60_000;
          const needsDelivery = ["paid", "delivering"].includes(o.status);
          return (
            <Link
              key={o.id}
              to="/orders/$orderId"
              params={{ orderId: o.id }}
              className={`bg-card border rounded-lg p-3 flex items-center gap-3 hover:border-primary/50 ${
                NEEDS_ACTION.includes(o.status) ? "border-blue-500/40" : "border-border"
              }`}
            >
              <div className="size-12 rounded-md overflow-hidden bg-secondary shrink-0">
                <img
                  src={productImage(o.image_key)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{o.product_title}</p>
                <p className="text-[10px] text-muted-foreground">
                  {o.order_no} · buyer {o.counterparty} · qty {o.qty} · {dateTime(o.created_at)}
                </p>
                {needsDelivery && o.delivery_type === "manual" && (
                  <p
                    className={`text-[10px] font-bold ${Date.now() > slaDeadline ? "text-destructive" : "text-blue-400"}`}
                  >
                    SLA:{" "}
                    {Date.now() > slaDeadline ? "BREACHED — deliver now!" : countdown(slaDeadline)}
                  </p>
                )}
              </div>
              <span
                className={`text-[9px] font-bold px-2 py-1 rounded whitespace-nowrap ${meta.cls}`}
              >
                {meta.label.toUpperCase()}
              </span>
              <div className="text-right">
                <p className="font-mono text-accent text-sm whitespace-nowrap">
                  {usdt(o.total_cents)}
                </p>
                <p className="text-[9px] text-muted-foreground whitespace-nowrap">
                  net {usdt(o.seller_net_cents)}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
