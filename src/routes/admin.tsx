import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PageShell } from "@/components/shell";
import { useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — X-VAULT" }] }),
  component: AdminLayout,
});

const NAV = [
  { to: "/admin", label: "Dashboard", exact: true },
  { to: "/admin/sellers", label: "Seller approvals" },
  { to: "/admin/products", label: "Product approvals" },
  { to: "/admin/orders", label: "Orders" },
  { to: "/admin/disputes", label: "Disputes" },
  { to: "/admin/finance", label: "Finance" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/moderation", label: "Chat mod" },
  { to: "/admin/categories", label: "Categories" },
  { to: "/admin/coupons", label: "Coupons" },
  { to: "/admin/settings", label: "Settings" },
  { to: "/admin/audit", label: "Audit log" },
];

function AdminLayout() {
  const { me, isLoading } = useMe();
  const allowed = me && ["admin", "support", "finance"].includes(me.role);

  return (
    <PageShell>
      {!isLoading && !allowed ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          Staff access required.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-border pb-2">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: n.exact ?? false }}
                activeProps={{ className: "bg-primary text-primary-foreground" }}
                inactiveProps={{ className: "bg-secondary hover:bg-border" }}
                className="px-3 py-2 rounded-md text-xs font-bold whitespace-nowrap"
              >
                {n.label}
              </Link>
            ))}
          </div>
          <Outlet />
        </div>
      )}
    </PageShell>
  );
}
