import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { LayoutDashboard, Package, ListOrdered, Wallet, Star } from "lucide-react";
import { PageShell } from "@/components/shell";
import { useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/seller")({
  head: () => ({ meta: [{ title: "Seller Dashboard — X-VAULT" }] }),
  component: SellerLayout,
});

const NAV = [
  { to: "/seller", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/seller/products", label: "Products", icon: Package },
  { to: "/seller/orders", label: "Orders", icon: ListOrdered },
  { to: "/seller/wallet", label: "Wallet", icon: Wallet },
  { to: "/seller/reviews", label: "Reviews", icon: Star },
];

function SellerLayout() {
  const { me, isLoading } = useMe();
  const allowed =
    me && (me.seller_status === "approved" || ["admin", "support", "finance"].includes(me.role));

  return (
    <PageShell>
      {!isLoading && !allowed ? (
        <div className="py-20 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Seller access required.</p>
          <Link to="/sell" className="text-primary text-sm font-bold">
            Apply to become a seller →
          </Link>
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
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold whitespace-nowrap"
              >
                <n.icon className="size-3.5" /> {n.label}
              </Link>
            ))}
          </div>
          <Outlet />
        </div>
      )}
    </PageShell>
  );
}
