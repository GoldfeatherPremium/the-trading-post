import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getSellerOverview } from "@/lib/api/seller";
import { usdt } from "@/lib/format";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/seller/")({
  component: SellerOverview,
});

function SellerOverview() {
  const { data } = useQuery({ queryKey: ["sellerOverview"], queryFn: () => getSellerOverview() });
  if (!data) return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "SALES TODAY", v: `${data.today.c} · ${usdt(data.today.s)}` },
          { label: "SALES 7 DAYS", v: `${data.week.c} · ${usdt(data.week.s)}` },
          { label: "SALES 30 DAYS", v: `${data.month.c} · ${usdt(data.month.s)}` },
          {
            label: "RATING",
            v:
              data.profile.rating > 0
                ? `★ ${data.profile.rating.toFixed(1)} (${data.profile.ratingCount})`
                : "no reviews",
          },
        ].map((x) => (
          <div key={x.label} className="bg-card border border-border rounded-lg p-4">
            <p className="text-[9px] font-bold tracking-widest text-muted-foreground">{x.label}</p>
            <p className="font-mono text-sm mt-1">{x.v}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-3">
          NET SALES — LAST 14 DAYS
        </h2>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: "#71717a" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  background: "#18181b",
                  border: "1px solid #27272a",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number, name: string) => [
                  name === "sales" ? `${v.toFixed(2)} USDT` : v,
                  name,
                ]}
              />
              <Area
                type="monotone"
                dataKey="sales"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#salesFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "AVAILABLE", v: usdt(data.wallet.available_cents), cls: "text-accent" },
          { label: "IN ESCROW", v: usdt(data.wallet.pending_cents), cls: "text-yellow-400" },
          { label: "FROZEN", v: usdt(data.wallet.frozen_cents), cls: "text-destructive" },
        ].map((x) => (
          <Link
            to="/seller/wallet"
            key={x.label}
            className="bg-card border border-border rounded-lg p-4 hover:border-primary/50"
          >
            <p className="text-[9px] font-bold tracking-widest text-muted-foreground">{x.label}</p>
            <p className={`font-mono text-lg mt-1 ${x.cls}`}>{x.v}</p>
          </Link>
        ))}
      </div>

      {data.topProducts.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-2">
            PRODUCT PERFORMANCE
          </h2>
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_60px_60px_70px_60px] gap-2 text-[9px] font-bold text-muted-foreground tracking-widest pb-1 border-b border-border">
              <span>PRODUCT</span>
              <span className="text-right">VIEWS</span>
              <span className="text-right">SOLD</span>
              <span className="text-right">CONV.</span>
              <span className="text-right">STOCK</span>
            </div>
            {data.topProducts.map((tp) => {
              const conv = tp.views > 0 ? ((tp.sold_count / tp.views) * 100).toFixed(1) : "—";
              return (
                <div
                  key={tp.id}
                  className="grid grid-cols-[1fr_60px_60px_70px_60px] gap-2 text-xs py-1 border-b border-border/40 last:border-0 items-center"
                >
                  <span className="truncate font-bold">{tp.title}</span>
                  <span className="text-right font-mono text-muted-foreground">{tp.views}</span>
                  <span className="text-right font-mono">{tp.sold_count}</span>
                  <span
                    className={`text-right font-mono ${Number(conv) >= 5 ? "text-accent" : "text-muted-foreground"}`}
                  >
                    {conv}%
                  </span>
                  <span
                    className={`text-right font-mono ${tp.delivery_type === "auto" && tp.stock_count <= 5 ? "text-yellow-400" : "text-muted-foreground"}`}
                  >
                    {tp.delivery_type === "auto" ? tp.stock_count : "∞"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(data.needsDelivery > 0 || data.openDisputes > 0) && (
        <div className="grid sm:grid-cols-2 gap-3">
          {data.needsDelivery > 0 && (
            <Link
              to="/seller/orders"
              className="bg-blue-500/10 border border-blue-500/40 rounded-lg p-4 text-sm font-bold text-blue-400"
            >
              ⚡ {data.needsDelivery} order{data.needsDelivery > 1 ? "s" : ""} awaiting delivery —
              SLA running!
            </Link>
          )}
          {data.openDisputes > 0 && (
            <Link
              to="/seller/orders"
              className="bg-destructive/10 border border-destructive/40 rounded-lg p-4 text-sm font-bold text-destructive"
            >
              ⚠ {data.openDisputes} open dispute{data.openDisputes > 1 ? "s" : ""} — respond with
              evidence
            </Link>
          )}
        </div>
      )}

      {data.lowStock.length > 0 && (
        <div className="bg-card border border-yellow-500/30 rounded-lg p-4">
          <h2 className="text-xs font-bold tracking-widest text-yellow-400 mb-2">LOW STOCK</h2>
          {data.lowStock.map((p) => (
            <Link
              key={p.id}
              to="/seller/stock/$productId"
              params={{ productId: p.id }}
              className="flex justify-between text-xs py-1 hover:text-primary"
            >
              <span className="truncate">{p.title}</span>
              <span className="font-mono text-yellow-400">{p.stock_count} left</span>
            </Link>
          ))}
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-4 text-xs text-muted-foreground leading-relaxed">
        <b className="text-foreground">Seller level {data.profile.level}</b> ·{" "}
        {data.profile.totalSales} lifetime sales · {data.profile.completionRate.toFixed(0)}%
        completion. Levels rise with sales volume, rating and low dispute rate — higher levels
        unlock more listings and bigger weekly withdrawal caps.
      </div>
    </div>
  );
}
