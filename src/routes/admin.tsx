import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/shell";
import { useMe } from "@/hooks/use-me";
import { getAdminPulse } from "@/lib/api/admin";
import { usdt } from "@/lib/format";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin Control Center — X-VAULT" }] }),
  component: AdminLayout,
});

type NavItem = { to: string; label: string; exact?: boolean; hint?: string };
type NavGroup = { id: string; label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    id: "ops",
    label: "Operations",
    items: [
      { to: "/admin", label: "Dashboard", exact: true, hint: "Overview & KPIs" },
      { to: "/admin/analytics", label: "Analytics", hint: "Marketplace insights" },
      { to: "/admin/orders", label: "Orders", hint: "Escrow & lifecycle" },
      { to: "/admin/disputes", label: "Disputes", hint: "Open cases" },
      { to: "/admin/risk", label: "Risk & fraud", hint: "Held orders & velocity rules" },
      { to: "/admin/moderation", label: "Chat moderation", hint: "Flagged messages" },
    ],
  },
  {
    id: "catalog",
    label: "Catalog",
    items: [
      { to: "/admin/products", label: "Product reviews", hint: "Pending listings" },
      { to: "/admin/items", label: "Selling items", hint: "Taxonomy" },
      { to: "/admin/categories", label: "Categories" },
      { to: "/admin/coupons", label: "Coupons" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { to: "/admin/finance", label: "Finance", hint: "Withdrawals & ledger" },
      { to: "/admin/fx", label: "FX & currency", hint: "Rates & base currency" },
    ],
  },
  {
    id: "people",
    label: "People",
    items: [
      { to: "/admin/sellers", label: "Seller approvals" },
      { to: "/admin/verifications", label: "Verifications", hint: "Trust tiers" },
      { to: "/admin/users", label: "Users" },
    ],
  },
  {
    id: "config",
    label: "Config",
    items: [
      { to: "/admin/settings", label: "Settings" },
      { to: "/admin/audit", label: "Audit log" },
    ],
  },
];

const FLAT = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));

function AdminLayout() {
  const { me, isLoading } = useMe();
  const allowed = me && ["admin", "support", "finance"].includes(me.role);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      } else if (e.key === "Escape") {
        setCmdOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PageShell>
      {!isLoading && !allowed ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          Staff access required.
        </div>
      ) : (
        <div className="space-y-4">
          <ControlHeader onOpenCmd={() => setCmdOpen(true)} />
          <GroupedNav pathname={pathname} />
          <Outlet />
        </div>
      )}
      {cmdOpen && <CommandPalette onClose={() => setCmdOpen(false)} />}
    </PageShell>
  );
}

function ControlHeader({ onOpenCmd }: { onOpenCmd: () => void }) {
  const { data } = useQuery({
    queryKey: ["adminPulse"],
    queryFn: () => getAdminPulse(),
    refetchInterval: 20_000,
  });

  const pills: Array<{ label: string; value: string; tone?: "warn" | "alert" | "ok" }> = data
    ? [
        { label: "Orders 24h", value: String(data.orders24h), tone: "ok" },
        { label: "GMV 24h", value: usdt(data.revenue24h) },
        {
          label: "Refunds 24h",
          value: `${data.refunds24h.c} · ${usdt(data.refunds24h.s)}`,
          tone: data.refunds24h.c > 0 ? "warn" : undefined,
        },
        {
          label: "Escrow on hold",
          value: String(data.escrowOnHold),
          tone: data.escrowOnHold > 0 ? "alert" : undefined,
        },
        {
          label: "Open disputes",
          value: String(data.activeDisputes),
          tone: data.activeDisputes > 0 ? "warn" : undefined,
        },
        { label: "New users 24h", value: String(data.newUsers24h) },
        {
          label: "Withdrawals pending",
          value: usdt(data.pendingWithdrawalAmt),
          tone: data.pendingWithdrawalAmt > 0 ? "warn" : undefined,
        },
        { label: "Avg trust", value: `${data.avgTrust}/100` },
      ]
    : [];

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-card via-card to-secondary/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-bold tracking-[0.25em] text-muted-foreground">
            ADMIN CONTROL CENTER
          </p>
          <h1 className="font-display text-xl">Operations pulse</h1>
        </div>
        <button
          onClick={onOpenCmd}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary hover:bg-border text-xs font-bold"
        >
          <span>Quick jump</span>
          <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-background border border-border">⌘K</kbd>
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {pills.length === 0
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 rounded-md bg-secondary/60 animate-pulse" />
            ))
          : pills.map((p) => (
              <div
                key={p.label}
                className={`rounded-md border px-2.5 py-1.5 ${
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
                <p className="font-mono text-xs mt-0.5 truncate">{p.value}</p>
              </div>
            ))}
      </div>
    </div>
  );
}

function GroupedNav({ pathname }: { pathname: string }) {
  return (
    <div className="space-y-2">
      {GROUPS.map((g) => (
        <div key={g.id} className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-bold tracking-widest text-muted-foreground w-20 shrink-0">
            {g.label.toUpperCase()}
          </span>
          <div className="flex gap-1 flex-wrap">
            {g.items.map((n) => {
              const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary hover:bg-border text-foreground"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return FLAT.slice(0, 12);
    return FLAT.filter(
      (i) =>
        i.label.toLowerCase().includes(needle) ||
        i.group.toLowerCase().includes(needle) ||
        (i.hint?.toLowerCase().includes(needle) ?? false),
    ).slice(0, 12);
  }, [q]);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-center pt-24 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Jump to a section…"
          className="w-full px-4 py-3 bg-transparent text-sm outline-none border-b border-border"
        />
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 && (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">No matches.</div>
          )}
          {results.map((r) => (
            <button
              key={r.to}
              onClick={() => {
                onClose();
                nav({ to: r.to });
              }}
              className="w-full text-left px-4 py-2 hover:bg-secondary flex items-center gap-3"
            >
              <span className="text-[9px] font-bold tracking-widest text-muted-foreground w-16">
                {r.group.toUpperCase()}
              </span>
              <span className="text-sm font-bold flex-1">{r.label}</span>
              {r.hint && <span className="text-[10px] text-muted-foreground">{r.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
