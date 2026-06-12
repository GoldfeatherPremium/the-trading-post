import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";
import {
  ShoppingBag,
  Layers,
  Scale,
  Megaphone,
  Ticket,
  Settings,
  Heart,
  Wallet,
  Bell,
  Star,
  Boxes,
  PlusCircle,
  LayoutDashboard,
  Gavel,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { PageShell } from "@/components/shell";
import { useMe } from "@/hooks/use-me";
import { logout } from "@/lib/api/auth";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/menu")({
  head: () => ({ meta: [{ title: "My Account — X-VAULT" }] }),
  component: AccountHub,
});

type Entry = { label: string; to: string; icon?: ComponentType<{ className?: string }> };
type Section = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  entries: Entry[];
};

function AccountHub() {
  const { me, isLoading } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const doLogout = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      qc.invalidateQueries();
      navigate({ to: "/" });
    },
  });

  const isSeller = me?.seller_status === "approved";
  const isStaff = me && ["admin", "support", "finance"].includes(me.role);

  const sections: Section[] = [
    {
      id: "buy",
      label: "Buy",
      icon: ShoppingBag,
      color: "text-yellow-400",
      entries: [
        { label: "Purchase Orders", to: "/orders", icon: ShoppingBag },
        { label: "Favorites", to: "/favorites", icon: Heart },
        { label: "My Wallet", to: "/wallet", icon: Wallet },
        { label: "Refer & Earn", to: "/account/affiliate", icon: Wallet },
        { label: "Browse the Market", to: "/browse" },
      ],
    },
    {
      id: "seller",
      label: "Seller Center",
      icon: Layers,
      color: "text-destructive",
      entries: isSeller
        ? [
            { label: "Overview & Analytics", to: "/seller", icon: LayoutDashboard },
            { label: "Sold Orders", to: "/seller/orders", icon: ShoppingBag },
            { label: "Create New Offer", to: "/seller/new-product", icon: PlusCircle },
            { label: "Active Offers", to: "/seller/products", icon: Boxes },
            { label: "Withdrawal Management", to: "/seller/wallet", icon: Wallet },
            { label: "Reviews & Replies", to: "/seller/reviews", icon: Star },
          ]
        : [{ label: "Apply to become a seller", to: "/sell", icon: PlusCircle }],
    },
    {
      id: "disputes",
      label: "Dispute Center",
      icon: Scale,
      color: "text-cyan-400",
      entries: [{ label: "My Disputes", to: "/disputes" }],
    },
    {
      id: "announcement",
      label: "Announcement",
      icon: Megaphone,
      color: "text-yellow-400",
      entries: [
        { label: "Notifications", to: "/notifications", icon: Bell },
        { label: "Messages", to: "/chat" },
      ],
    },
    {
      id: "coupon",
      label: "Coupon",
      icon: Ticket,
      color: "text-destructive",
      entries: [
        { label: "Browse deals", to: "/browse" },
        ...(isStaff ? [{ label: "Manage coupons (staff)", to: "/admin/coupons" }] : []),
      ],
    },
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
      color: "text-muted-foreground",
      entries: [
        { label: "Account & Security", to: "/account" },
        ...(isStaff ? [{ label: "Admin Panel", to: "/admin" }] : []),
      ],
    },
  ];

  if (!me && !isLoading) {
    return (
      <PageShell>
        <div className="py-20 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Sign in to access your account.</p>
          <Link to="/auth" className="text-primary text-sm font-bold">
            Sign in / Register →
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="max-w-xl mx-auto space-y-4">
        {me && (
          <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
            <div className="size-12 rounded-full bg-primary/20 border border-primary/40 grid place-items-center text-sm font-bold text-primary uppercase">
              {me.username.slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{me.username}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {me.email}
                {isSeller ? ` · Seller Lv.${me.seller_level}` : ""}
                {isStaff ? ` · ${me.role.toUpperCase()}` : ""}
              </p>
            </div>
            {isStaff && (
              <Link
                to="/admin"
                className="size-9 rounded-full bg-secondary grid place-items-center"
                title="Admin Panel"
              >
                <Gavel className="size-4" />
              </Link>
            )}
          </div>
        )}

        <Accordion type="multiple" className="space-y-2">
          {sections.map((s) => (
            <AccordionItem
              key={s.id}
              value={s.id}
              className="bg-card border border-border rounded-lg px-4 border-b"
            >
              <AccordionTrigger className="hover:no-underline py-4">
                <span className="flex items-center gap-3 text-sm font-bold">
                  <s.icon className={`size-5 ${s.color}`} /> {s.label}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <div className="divide-y divide-border/60">
                  {s.entries.map((e) => (
                    <Link
                      key={e.to + e.label}
                      to={e.to}
                      className="flex items-center gap-2 py-3 pl-8 text-sm text-foreground/80 hover:text-primary"
                    >
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                      {e.label}
                    </Link>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {me && (
          <button
            onClick={() => doLogout.mutate()}
            className="w-full bg-card border border-border rounded-lg p-4 flex items-center gap-3 text-sm font-bold text-destructive hover:border-destructive/50"
          >
            <LogOut className="size-5" /> Sign out
          </button>
        )}
      </div>
    </PageShell>
  );
}
