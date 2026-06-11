import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Store, ShieldCheck, Banknote, TrendingUp } from "lucide-react";
import { applyForSeller, getMyApplication } from "@/lib/api/seller";
import { useMe } from "@/hooks/use-me";
import { PageShell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/sell")({
  head: () => ({ meta: [{ title: "Become a Seller — X-VAULT" }] }),
  component: SellPage,
});

function SellPage() {
  const { me, isLoading } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["myApplication"],
    queryFn: () => getMyApplication(),
    enabled: !!me,
  });
  const [form, setForm] = useState({
    fullName: "",
    country: "",
    experience: "",
    usdtPayoutAddress: "",
    usdtNetwork: "TRC20" as const,
  });
  const apply = useMutation({
    mutationFn: () => applyForSeller({ data: form }),
    onSuccess: () => {
      toast.success("Application submitted — our team will review it shortly.");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageShell>
      <div className="max-w-xl mx-auto py-6 space-y-6">
        <div className="text-center space-y-3">
          <h1 className="font-display text-4xl">SELL ON X-VAULT</h1>
          <p className="text-sm text-muted-foreground">
            Reach thousands of buyers. Get paid in USDT. Escrow handles the trust.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { icon: Banknote, t: "8% base fee", d: "per-category rates" },
            { icon: ShieldCheck, t: "Escrow handled", d: "no chargebacks" },
            { icon: TrendingUp, t: "Level up", d: "higher limits as you sell" },
          ].map((x) => (
            <div key={x.t} className="bg-card border border-border rounded-lg p-3 space-y-1">
              <x.icon className="size-5 text-primary mx-auto" />
              <p className="text-[11px] font-bold">{x.t}</p>
              <p className="text-[9px] text-muted-foreground">{x.d}</p>
            </div>
          ))}
        </div>

        {!me && !isLoading && (
          <div className="bg-card border border-border rounded-lg p-6 text-center space-y-3">
            <p className="text-sm">Create an account first, then apply for seller status.</p>
            <Button onClick={() => navigate({ to: "/auth", search: { redirect: "/sell" } })}>
              Sign in / Register
            </Button>
          </div>
        )}

        {me && me.seller_status === "approved" && (
          <div className="bg-card border border-accent/40 rounded-lg p-6 text-center space-y-3">
            <Store className="size-8 text-accent mx-auto" />
            <p className="text-sm font-bold">You're an approved seller!</p>
            <Link to="/seller" className="text-primary text-sm font-bold">
              Open your dashboard →
            </Link>
          </div>
        )}

        {me && me.seller_status === "pending" && (
          <div className="bg-card border border-yellow-500/40 rounded-lg p-6 text-center space-y-2">
            <p className="text-sm font-bold text-yellow-400">Application under review</p>
            <p className="text-xs text-muted-foreground">
              Submitted{" "}
              {data?.application ? new Date(data.application.created_at).toLocaleString() : ""}.
              You'll get a notification once our team decides.
            </p>
          </div>
        )}

        {me && (me.seller_status === "none" || me.seller_status === "rejected") && (
          <form
            className="bg-card border border-border rounded-lg p-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              apply.mutate();
            }}
          >
            {me.seller_status === "rejected" && (
              <p className="text-xs bg-destructive/10 border border-destructive/30 text-destructive rounded-md p-2">
                Your previous application was rejected
                {data?.application?.admin_note ? `: ${data.application.admin_note}` : "."} You may
                re-apply.
              </p>
            )}
            <h2 className="text-xs font-bold tracking-widest">SELLER APPLICATION</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Full legal name</Label>
                <Input
                  required
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Country</Label>
                <Input
                  required
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">What will you sell? (sourcing, experience)</Label>
              <Textarea
                required
                minLength={10}
                value={form.experience}
                onChange={(e) => setForm({ ...form, experience: e.target.value })}
                placeholder="E.g. authorized gift card distributor, established gold farming team…"
              />
            </div>
            <div className="grid sm:grid-cols-[1fr_120px] gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">USDT payout address</Label>
                <Input
                  required
                  minLength={20}
                  value={form.usdtPayoutAddress}
                  onChange={(e) => setForm({ ...form, usdtPayoutAddress: e.target.value })}
                  placeholder="T…"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Network</Label>
                <select
                  value={form.usdtNetwork}
                  onChange={(e) => setForm({ ...form, usdtNetwork: e.target.value as never })}
                  className="w-full bg-secondary border border-border rounded-md px-2 py-2 text-xs h-9"
                >
                  <option>TRC20</option>
                  <option>BEP20</option>
                  <option>ERC20</option>
                </select>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              By applying you agree to the prohibited items policy: no stolen/carded goods, no
              unauthorized credentials, no listings violating the underlying service's terms.
              Violations = permanent ban + frozen funds.
            </p>
            <Button type="submit" className="w-full font-bold" disabled={apply.isPending}>
              {apply.isPending ? "Submitting…" : "Submit application"}
            </Button>
          </form>
        )}
      </div>
    </PageShell>
  );
}
