import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getSellerAnalytics } from "@/lib/api/analytics";
import { usdt } from "@/lib/format";

export const Route = createFileRoute("/seller/analytics")({
  head: () => ({ meta: [{ title: "Seller Analytics — X-VAULT" }] }),
  component: SellerAnalytics,
});

type Range = "7d" | "30d" | "90d";
const RANGES: Range[] = ["7d", "30d", "90d"];

function SellerAnalytics() {
  const [range, setRange] = useState<Range>("30d");
  const { data, isLoading } = useQuery({
    queryKey: ["sellerAnalytics", range],
    queryFn: () => getSellerAnalytics({ data: { range } }),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-bold tracking-[0.25em] text-muted-foreground">
            BUSINESS INSIGHTS
          </p>
          <h1 className="font-display text-xl">Analytics</h1>
        </div>
        <div className="flex gap-1 bg-secondary rounded-md p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded text-[11px] font-bold ${
                range === r ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="NET REVENUE" value={usdt(data.summary.net)} sub={growthSub(data.summary.growth)} />
            <Kpi label="ORDERS" value={String(data.summary.orders)} sub={`${data.summary.qty} units`} />
            <Kpi label="AOV" value={`${data.summary.aov.toFixed(2)} USDT`} />
            <Kpi label="UNIQUE BUYERS" value={String(data.summary.uniqueBuyers)} sub={`${data.summary.repeatRate.toFixed(0)}% repeat`} />
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-3">
              NET REVENUE — {data.range.toUpperCase()}
            </h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sa-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#27272a" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 100).toFixed(0)}`} />
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${(v / 100).toFixed(2)} USDT`, "Net"]}
                  />
                  <Area type="monotone" dataKey="v" stroke="#3b82f6" strokeWidth={2} fill="url(#sa-fill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-3">
                ORDERS BY HOUR (UTC{new Date().getTimezoneOffset() === 0 ? "" : " local"})
              </h2>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.hours} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                    <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#71717a" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [v, "orders"]}
                      labelFormatter={(h) => `${h}:00`}
                    />
                    <Bar dataKey="n" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-3">
                CATEGORY MIX
              </h2>
              {data.categoryMix.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">No sales yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.categoryMix.map((c) => {
                    const max = data.categoryMix[0].revenue || 1;
                    const pct = (c.revenue / max) * 100;
                    return (
                      <div key={c.name} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-bold truncate">{c.name}</span>
                          <span className="font-mono text-muted-foreground">
                            {usdt(c.revenue)} · {c.orders}
                          </span>
                        </div>
                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-3">
              TOP PRODUCTS
            </h2>
            <div className="grid grid-cols-[1fr_70px_60px_70px_70px] gap-2 text-[9px] font-bold text-muted-foreground tracking-widest pb-1 border-b border-border">
              <span>PRODUCT</span>
              <span className="text-right">REVENUE</span>
              <span className="text-right">ORDERS</span>
              <span className="text-right">VIEWS</span>
              <span className="text-right">CONV.</span>
            </div>
            {data.topProducts.map((p) => {
              const conv = p.views > 0 ? ((p.sold_count / p.views) * 100).toFixed(1) : "—";
              return (
                <div
                  key={p.id}
                  className="grid grid-cols-[1fr_70px_60px_70px_70px] gap-2 text-xs py-1.5 border-b border-border/40 last:border-0"
                >
                  <span className="truncate font-bold">{p.title}</span>
                  <span className="text-right font-mono">{usdt(p.revenue)}</span>
                  <span className="text-right font-mono">{p.orders}</span>
                  <span className="text-right font-mono text-muted-foreground">{p.views}</span>
                  <span className={`text-right font-mono ${Number(conv) >= 5 ? "text-accent" : "text-muted-foreground"}`}>
                    {conv}{p.views > 0 ? "%" : ""}
                  </span>
                </div>
              );
            })}
            {data.topProducts.length === 0 && (
              <p className="text-xs text-muted-foreground py-6 text-center">No products yet.</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Kpi label="ACTIVE LISTINGS" value={String(data.productCounts.active ?? 0)} />
            <Kpi label="PAUSED" value={String(data.productCounts.paused ?? 0)} />
            <Kpi label="OUT OF STOCK" value={String(data.productCounts.oos ?? 0)} />
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-[9px] font-bold tracking-widest text-muted-foreground">{label}</p>
      <p className="font-mono text-sm mt-1">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function growthSub(g: number | null) {
  if (g === null) return "no prior period";
  const sign = g >= 0 ? "+" : "";
  return `${sign}${g.toFixed(1)}% vs prev`;
}
