import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listMyOrders } from "@/lib/api/orders";
import { PageShell } from "@/components/shell";
import { ORDER_STATUS_META, dateTime, usdt } from "@/lib/format";
import { productImage } from "@/lib/images";

export const Route = createFileRoute("/orders/")({
  head: () => ({ meta: [{ title: "My Orders — X-VAULT" }] }),
  component: OrdersPage,
});

function OrdersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["myOrders"],
    queryFn: () => listMyOrders({ data: { role: "buyer" } }),
  });

  return (
    <PageShell>
      <h1 className="font-display text-3xl mb-4">MY ORDERS</h1>
      {isLoading && <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>}
      {data?.orders.length === 0 && (
        <div className="py-16 text-center space-y-3">
          <p className="text-sm text-muted-foreground">You haven't bought anything yet.</p>
          <Link to="/browse" className="text-primary text-sm font-bold">
            Browse the market →
          </Link>
        </div>
      )}
      <div className="space-y-2">
        {data?.orders.map((o) => {
          const meta = ORDER_STATUS_META[o.status] ?? { label: o.status, cls: "bg-muted" };
          return (
            <Link
              key={o.id}
              to="/orders/$orderId"
              params={{ orderId: o.id }}
              className="bg-card border border-border rounded-lg p-3 flex items-center gap-3 hover:border-primary/50"
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
                  {o.order_no} · {o.counterparty} · {dateTime(o.created_at)}
                </p>
              </div>
              <span
                className={`text-[9px] font-bold px-2 py-1 rounded whitespace-nowrap ${meta.cls}`}
              >
                {meta.label.toUpperCase()}
              </span>
              <span className="font-mono text-accent text-sm whitespace-nowrap">
                {usdt(o.total_cents)}
              </span>
            </Link>
          );
        })}
      </div>
    </PageShell>
  );
}
