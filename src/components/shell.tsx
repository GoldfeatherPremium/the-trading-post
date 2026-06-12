import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  MessageSquare,
  ShieldCheck,
  Store,
  LogOut,
  Package,
  Wallet,
  User,
  Gavel,
  Heart,
  Megaphone,
  Wrench,
  Menu,
  Scale,
  Users,
  Sparkles,
} from "lucide-react";
import { type ReactNode } from "react";
import { getMyLoyalty } from "@/lib/api/growth";
import { useMe } from "@/hooks/use-me";
import { logout } from "@/lib/api/auth";
import { SmartSearch } from "@/components/smart-search";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SiteHeader() {
  const { me, unreadNotifications, unreadMessages, banner } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const doLogout = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      qc.invalidateQueries();
      navigate({ to: "/" });
    },
  });
  const isStaff = me && ["admin", "support", "finance"].includes(me.role);

  return (
    <nav className="sticky top-0 z-50 bg-background/85 backdrop-blur-md border-b border-border">
      {banner.maintenance && (
        <div className="bg-yellow-500/15 text-yellow-400 text-[11px] font-bold text-center py-1.5 px-4 flex items-center justify-center gap-1.5">
          <Wrench className="size-3" /> Maintenance mode — orders may be briefly delayed.
        </div>
      )}
      {banner.announcement && (
        <div className="bg-primary/15 text-primary text-[11px] font-bold text-center py-1.5 px-4 flex items-center justify-center gap-1.5">
          <Megaphone className="size-3" /> {banner.announcement}
        </div>
      )}
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <Link
          to="/menu"
          aria-label="Account menu"
          className="size-9 rounded-md bg-secondary grid place-items-center hover:bg-border sm:hidden shrink-0"
        >
          <Menu className="size-4" />
        </Link>
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="size-8 bg-primary rounded flex items-center justify-center font-display text-xl text-primary-foreground">
            X
          </div>
          <span className="font-display text-2xl tracking-tight hidden sm:inline">X-VAULT</span>
        </Link>

        <div className="flex-1 max-w-md hidden md:block">
          <SmartSearch variant="header" />
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <Link
            to="/browse"
            className="text-xs font-bold px-3 py-2 rounded-md hover:bg-secondary text-foreground/80 hidden sm:block"
          >
            BROWSE
          </Link>
          {me ? (
            <>
              <Link
                to="/chat"
                className="relative size-9 rounded-full bg-secondary grid place-items-center hover:bg-border"
              >
                <MessageSquare className="size-4" />
                {unreadMessages > 0 && (
                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-4 h-4 px-1 grid place-items-center">
                    {unreadMessages > 9 ? "9+" : unreadMessages}
                  </span>
                )}
              </Link>
              <Link
                to="/notifications"
                className="relative size-9 rounded-full bg-secondary grid place-items-center hover:bg-border"
              >
                <Bell className="size-4" />
                {unreadNotifications > 0 && (
                  <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full min-w-4 h-4 px-1 grid place-items-center">
                    {unreadNotifications > 9 ? "9+" : unreadNotifications}
                  </span>
                )}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger className="size-9 rounded-full bg-primary/20 border border-primary/40 grid place-items-center text-xs font-bold text-primary uppercase">
                  {me.username.slice(0, 2)}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="text-xs">
                    {me.username}
                    <div className="text-[10px] text-muted-foreground font-normal">{me.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate({ to: "/orders" })}>
                    <Package className="size-4" /> My Orders
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/wallet" })}>
                    <Wallet className="size-4" /> Wallet
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/favorites" })}>
                    <Heart className="size-4" /> Favorites
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/disputes" })}>
                    <Scale className="size-4" /> Dispute Center
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/menu" })}>
                    <Menu className="size-4" /> Account Hub
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/account" })}>
                    <User className="size-4" /> Account
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {me.seller_status === "approved" ? (
                    <DropdownMenuItem onClick={() => navigate({ to: "/seller" })}>
                      <Store className="size-4" /> Seller Dashboard
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => navigate({ to: "/sell" })}>
                      <Store className="size-4" /> Become a Seller
                    </DropdownMenuItem>
                  )}
                  {isStaff && (
                    <DropdownMenuItem onClick={() => navigate({ to: "/admin" })}>
                      <Gavel className="size-4" /> Admin Panel
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => doLogout.mutate()}>
                    <LogOut className="size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Link
              to="/auth"
              className="text-xs font-bold px-3 py-2 bg-primary text-primary-foreground rounded-md"
            >
              SIGN IN
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-secondary/20 border-t border-border px-4 py-10 mt-12">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-accent" />
          <span className="font-display text-2xl">X-VAULT</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-xs text-foreground/70">
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase">
              Marketplace
            </h4>
            <p>Escrow-protected trades</p>
            <p>USDT payments (TRC-20 / BEP-20)</p>
            <p>Instant auto-delivery</p>
          </div>
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase">
              Sellers
            </h4>
            <p>8% base commission</p>
            <p>Seller levels & limits</p>
            <p>Fast USDT payouts</p>
          </div>
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase">
              Trust
            </h4>
            <p>Warranty on every order</p>
            <p>Dispute resolution team</p>
            <p>Prohibited items policy enforced</p>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground text-center pt-6 border-t border-border/60 tracking-wide">
          © 2026 X-VAULT MARKETPLACE · DEMO BUILD — USDT PAYMENTS SIMULATED
        </p>
      </div>
    </footer>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <SiteHeader />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
