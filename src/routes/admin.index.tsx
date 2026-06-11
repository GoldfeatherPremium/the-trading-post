import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getAdminDashboard } from "@/lib/api/admin";
import { ORDER_STATUS_META, usdt } from "@/lib/format";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const { data } = useQuery({
    queryKey: ["adminDashboard"],
    queryFn: () => getAdminDashboard(),
    refetchInterval: 15_000,
  });
  if (!data) return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;

  const queues = [
    { label: "Seller applications", v: data.pending.sellerApplications, to: "/admin/sellers" },
    { label: "Products to review", v: data.pending.productReviews, to: "/admin/products" },
    { label: "Open disputes", v: data.pending.openDisputes, to: "/admin/disputes" },
    { label: "Withdrawals pending", v: data.pending.withdrawals, to: "/admin/finance" },
    { label: "Flagged messages", v: data.pending.flaggedMessages, to: "/admin/moderation" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "GMV TODAY", v: `${usdt(data.gmvToday.s)} · ${data.gmvToday.c} orders` },
          { label: "GMV 30 DAYS", v: `${usdt(data.gmv30d.s)} · ${data.gmv30d.c} orders` },
          { label: "REVENUE (COMMISSIONS)", v: usdt(data.revenue) },
          { label: "ESCROW HELD", v: usdt(data.escrowHeld) },
        ].map((x) => (
          <div key={x.label} className="bg-card border border-border rounded-lg p-4">
            <p className="text-[9px] font-bold tracking-widest text-muted-foreground">{x.label}</p>
            <p className="font-mono text-sm mt-1">{x.v}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {queues.map((q) => (
          <Link
            key={q.label}
            to={q.to}
            className={`bg-card border rounded-lg p-3 text-center hover:border-primary/50 ${q.v > 0 ? "border-yellow-500/40" : "border-border"}`}
          >
            <p
              className={`font-display text-3xl ${q.v > 0 ? "text-yellow-400" : "text-muted-foreground"}`}
            >
              {q.v}
            </p>
            <p className="text-[10px] font-bold text-muted-foreground">{q.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-xs font-bold tracking-widest mb-3">ORDERS BY STATUS</h2>
          <div className="space-y-1.5">
            {data.ordersByStatus.map((s) => (
              <div key={s.status} className="flex items-center gap-2 text-xs">
                <span
                  className={`text-[9px] font-bold px-2 py-0.5 rounded w-36 text-center ${ORDER_STATUS_META[s.status]?.cls ?? "bg-muted"}`}
                >
                  {(ORDER_STATUS_META[s.status]?.label ?? s.status).toUpperCase()}
                </span>
                <div className="flex-1 bg-secondary rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-full"
                    style={{
                      width: `${Math.min(100, (s.c / Math.max(...data.ordersByStatus.map((x) => x.c))) * 100)}%`,
                    }}
                  />
                </div>
                <span className="font-mono w-8 text-right">{s.c}</span>
              </div>
            ))}
            {data.ordersByStatus.length === 0 && (
              <p className="text-xs text-muted-foreground">No orders yet.</p>
            )}
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-xs font-bold tracking-widest mb-3">TOP SELLERS (30D)</h2>
          {data.topSellers.length === 0 && (
            <p className="text-xs text-muted-foreground">No sales in the last 30 days.</p>
          )}
          <div className="space-y-2">
            {data.topSellers.map((s, i) => (
              <div key={s.username} className="flex items-center gap-2 text-xs">
                <span className="font-display text-muted-foreground">#{i + 1}</span>
                <span className="font-bold flex-1">{s.username}</span>
                <span className="text-muted-foreground">{s.c} orders</span>
                <span className="font-mono text-accent">{usdt(s.s)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-4">
            {data.users} registered users total.
          </p>
        </div>
      </div>
    </div>
  );
}
