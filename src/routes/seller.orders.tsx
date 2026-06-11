import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listMyOrders } from "@/lib/api/orders";
import { ORDER_STATUS_META, countdown, dateTime, usdt } from "@/lib/format";
import { productImage } from "@/lib/images";

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

  const sorted = [...(data?.orders ?? [])].sort(
    (a, b) => Number(NEEDS_ACTION.includes(b.status)) - Number(NEEDS_ACTION.includes(a.status)),
  );

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl">SALES ORDERS</h1>
      {data?.orders.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">No sales yet.</p>
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
