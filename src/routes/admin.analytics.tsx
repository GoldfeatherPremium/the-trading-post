import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getAdminAnalytics } from "@/lib/api/analytics";
import { usdt } from "@/lib/format";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({ meta: [{ title: "Marketplace Analytics — X-VAULT" }] }),
  component: AdminAnalytics,
});

type Range = "7d" | "30d" | "90d";
const RANGES: Range[] = ["7d", "30d", "90d"];

function AdminAnalytics() {
  const [range, setRange] = useState<Range>("30d");
  const { data, isLoading } = useQuery({
    queryKey: ["adminAnalytics", range],
    queryFn: () => getAdminAnalytics({ data: { range } }),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-bold tracking-[0.25em] text-muted-foreground">
            MARKETPLACE INSIGHTS
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
            <Kpi
              label="GMV"
              value={usdt(data.summary.gmv)}
              sub={
                data.summary.gmvGrowth === null
                  ? null
                  : `${data.summary.gmvGrowth >= 0 ? "+" : ""}${data.summary.gmvGrowth.toFixed(1)}% vs prev`
              }
            />
            <Kpi label="ORDERS" value={String(data.summary.orders)} sub={`${data.summary.aov.toFixed(2)} USDT AOV`} />
            <Kpi label="COMMISSION" value={usdt(data.summary.commission)} />
            <Kpi
              label="ACTIVE"
              value={`${data.summary.activeSellers} sellers`}
              sub={`${data.summary.uniqueBuyers} buyers`}
            />
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-3">
              GMV TREND — {data.range.toUpperCase()}
            </h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="aa-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#27272a" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 100).toFixed(0)}`} />
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${(v / 100).toFixed(2)} USDT`, "GMV"]}
                  />
                  <Area type="monotone" dataKey="v" stroke="#22c55e" strokeWidth={2} fill="url(#aa-fill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <Panel title="CATEGORY PERFORMANCE">
              {data.categoryPerf.length === 0 ? (
                <Empty />
              ) : (
                <div className="space-y-2">
                  {data.categoryPerf.map((c) => {
                    const max = data.categoryPerf[0].gmv || 1;
                    const pct = (c.gmv / max) * 100;
                    return (
                      <div key={c.name} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-bold truncate">{c.name}</span>
                          <span className="font-mono text-muted-foreground">
                            {usdt(c.gmv)} · {c.orders} · {c.sellers}s
                          </span>
                        </div>
                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel title="TOP SELLERS">
              {data.topSellers.length === 0 ? (
                <Empty />
              ) : (
                <div className="space-y-1">
                  {data.topSellers.map((s, i) => (
                    <div
                      key={s.username}
                      className="grid grid-cols-[20px_1fr_80px_60px] gap-2 text-xs py-1 border-b border-border/40 last:border-0 items-center"
                    >
                      <span className="font-mono text-muted-foreground">#{i + 1}</span>
                      <span className="font-bold truncate">{s.username}</span>
                      <span className="text-right font-mono">{usdt(s.gmv)}</span>
                      <span className="text-right font-mono text-muted-foreground">{s.orders}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel title="TOP PRODUCTS">
            {data.topProducts.length === 0 ? (
              <Empty />
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_120px_80px_60px] gap-2 text-[9px] font-bold text-muted-foreground tracking-widest pb-1 border-b border-border">
                  <span>PRODUCT</span>
                  <span>SELLER</span>
                  <span className="text-right">GMV</span>
                  <span className="text-right">ORDERS</span>
                </div>
                {data.topProducts.map((p) => (
                  <div
                    key={p.id}
                    className="grid grid-cols-[1fr_120px_80px_60px] gap-2 text-xs py-1.5 border-b border-border/40 last:border-0"
                  >
                    <span className="truncate font-bold">{p.title}</span>
                    <span className="truncate text-muted-foreground">{p.seller}</span>
                    <span className="text-right font-mono">{usdt(p.gmv)}</span>
                    <span className="text-right font-mono text-muted-foreground">{p.orders}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-3 gap-3">
            <Kpi label="NEW BUYERS" value={String(data.newSignups.buyers ?? 0)} />
            <Kpi label="NEW SELLERS" value={String(data.newSignups.sellers ?? 0)} />
            <Kpi label="CATALOG CONV." value={`${data.summary.marketplaceConversion.toFixed(2)}%`} />
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground py-6 text-center">No data in this range.</p>;
}
