import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getRiskOverview, listRiskEvents, type RiskBand } from "@/lib/api/risk";
import { usdt } from "@/lib/format";

export const Route = createFileRoute("/admin/risk")({
  head: () => ({ meta: [{ title: "Risk & Fraud — Admin" }] }),
  component: AdminRiskPage,
});

const BANDS: Array<{ id: "all" | RiskBand; label: string }> = [
  { id: "all", label: "All" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

function AdminRiskPage() {
  const [band, setBand] = useState<"all" | RiskBand>("high");
  const overview = useQuery({
    queryKey: ["riskOverview"],
    queryFn: () => getRiskOverview(),
    refetchInterval: 30_000,
  });
  const events = useQuery({
    queryKey: ["riskEvents", band],
    queryFn: () => listRiskEvents({ data: { band, limit: 100 } }),
  });

  const pills = overview.data
    ? [
        {
          label: "Held orders",
          value: String(overview.data.heldOrders),
          tone: overview.data.heldOrders > 0 ? "alert" : undefined,
        },
        { label: "Held GMV", value: usdt(overview.data.heldGmvCents) },
        { label: "Events 24h", value: String(overview.data.events24h) },
        {
          label: "High-risk 24h",
          value: String(overview.data.highBand24h),
          tone: overview.data.highBand24h > 0 ? "warn" : undefined,
        },
        { label: "Events 7d", value: String(overview.data.events7d) },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl">Risk & Fraud Engine</h2>
        <p className="text-[11px] text-muted-foreground">
          Velocity, refund-rate and account-age rules score every paid order. Orders ≥70 are
          auto-held; staff release or refund after review.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {pills.length === 0
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 rounded-md bg-secondary/60 animate-pulse" />
            ))
          : pills.map((p) => (
              <div
                key={p.label}
                className={`rounded-md border px-2.5 py-2 ${
                  p.tone === "alert"
                    ? "border-red-500/50 bg-red-500/10"
                    : p.tone === "warn"
                      ? "border-yellow-500/40 bg-yellow-500/5"
                      : "border-border bg-background/40"
                }`}
              >
                <p className="text-[9px] font-bold tracking-widest text-muted-foreground truncate">
                  {p.label.toUpperCase()}
                </p>
                <p className="font-mono text-sm mt-0.5 truncate">{p.value}</p>
              </div>
            ))}
      </div>

      <div className="flex items-center gap-1.5">
        {BANDS.map((b) => (
          <button
            key={b.id}
            onClick={() => setBand(b.id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${
              band === b.id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-border"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-secondary/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">When</th>
              <th className="text-left px-3 py-2">Order</th>
              <th className="text-left px-3 py-2">Buyer → Seller</th>
              <th className="text-right px-3 py-2">Score</th>
              <th className="text-left px-3 py-2">Reasons</th>
              <th className="text-left px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {events.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!events.isLoading && (events.data?.events.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No risk events in this band. Quiet skies. ☁️
                </td>
              </tr>
            )}
            {events.data?.events.map((e) => (
              <tr key={e.id} className="border-t border-border/70 align-top">
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 font-mono">
                  {e.order_id ? (
                    <Link to="/admin/orders" className="text-primary hover:underline">
                      {e.order_no ?? e.order_id.slice(0, 8)}
                    </Link>
                  ) : (
                    "—"
                  )}
                  {e.order_total_cents != null && (
                    <div className="text-[10px] text-muted-foreground">
                      {usdt(e.order_total_cents)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="font-bold">{e.buyer_username ?? "?"}</div>
                  <div className="text-[10px] text-muted-foreground">
                    → {e.seller_username ?? "?"}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={`inline-block font-mono font-bold px-1.5 py-0.5 rounded ${
                      e.band === "high"
                        ? "bg-red-500/15 text-red-400"
                        : e.band === "medium"
                          ? "bg-yellow-500/15 text-yellow-400"
                          : "bg-emerald-500/15 text-emerald-400"
                    }`}
                  >
                    {e.score}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <ul className="list-disc list-inside text-[11px] space-y-0.5">
                    {(Array.isArray(e.reasons) ? e.reasons : [String(e.reasons)])
                      .slice(0, 4)
                      .map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                  </ul>
                </td>
                <td className="px-3 py-2 text-[10px]">
                  <div>
                    <span className="text-muted-foreground">order:</span> {e.order_status ?? "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">escrow:</span>{" "}
                    <span
                      className={
                        e.escrow_status === "on_hold" ? "text-red-400 font-bold" : undefined
                      }
                    >
                      {e.escrow_status ?? "—"}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
