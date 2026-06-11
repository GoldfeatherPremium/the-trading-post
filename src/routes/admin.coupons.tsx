import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { adminListCoupons, adminSaveCoupon } from "@/lib/api/admin";
import { dateTime, usdt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/coupons")({
  component: AdminCoupons,
});

const EMPTY = {
  couponId: undefined as string | undefined,
  code: "",
  pctOff: 10,
  minTotalUsdt: 0,
  maxUses: 0,
  expiresInDays: 0,
  isActive: true,
};

function AdminCoupons() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["adminCoupons"], queryFn: () => adminListCoupons() });
  const [form, setForm] = useState(EMPTY);

  const save = useMutation({
    mutationFn: () => adminSaveCoupon({ data: form }),
    onSuccess: () => {
      toast.success("Coupon saved");
      setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ["adminCoupons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">COUPONS</h1>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Percentage discounts applied at checkout. Use the announcement banner (Settings) to promote
        them.
      </p>

      <div className="space-y-2">
        {data?.coupons.length === 0 && (
          <p className="text-sm text-muted-foreground">No coupons yet.</p>
        )}
        {data?.coupons.map((c) => {
          const expired = c.expires_at && (c.expires_at as number) < Date.now();
          const usedUp =
            (c.max_uses as number) > 0 && (c.used_count as number) >= (c.max_uses as number);
          return (
            <div
              key={c.id as string}
              className="bg-card border border-border rounded-lg p-3 flex items-center gap-3 text-xs flex-wrap"
            >
              <span className="font-mono font-bold text-primary">{c.code}</span>
              <span className="font-bold text-accent">−{c.pct_off}%</span>
              <span className="text-[10px] text-muted-foreground">
                {(c.min_total_cents as number) > 0
                  ? `min ${usdt(c.min_total_cents as number)} · `
                  : ""}
                used {c.used_count}
                {(c.max_uses as number) > 0 ? ` / ${c.max_uses}` : " (unlimited)"}
                {c.expires_at ? ` · expires ${dateTime(c.expires_at as number)}` : ""}
              </span>
              {!c.is_active && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-muted">DISABLED</span>
              )}
              {expired ? (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-destructive/15 text-destructive">
                  EXPIRED
                </span>
              ) : usedUp ? (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                  FULLY REDEEMED
                </span>
              ) : c.is_active ? (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-accent/15 text-accent">
                  LIVE
                </span>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto h-7 text-[10px]"
                onClick={() =>
                  setForm({
                    couponId: c.id as string,
                    code: c.code as string,
                    pctOff: c.pct_off as number,
                    minTotalUsdt: (c.min_total_cents as number) / 100,
                    maxUses: c.max_uses as number,
                    expiresInDays: 0,
                    isActive: !!c.is_active,
                  })
                }
              >
                Edit
              </Button>
            </div>
          );
        })}
      </div>

      <form
        className="bg-card border border-border rounded-lg p-4 space-y-3 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h2 className="text-xs font-bold tracking-widest">
          {form.couponId ? "EDIT COUPON" : "NEW COUPON"}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Input
            required
            placeholder="CODE (e.g. SAVE10)"
            value={form.code}
            pattern="[A-Za-z0-9_-]+"
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            className="font-mono"
          />
          <Input
            type="number"
            min={1}
            max={100}
            step="0.5"
            placeholder="% off"
            value={form.pctOff}
            onChange={(e) => setForm({ ...form, pctOff: Number(e.target.value) })}
          />
          <Input
            type="number"
            min={0}
            placeholder="Min order USDT (0 = none)"
            value={form.minTotalUsdt}
            onChange={(e) => setForm({ ...form, minTotalUsdt: Number(e.target.value) })}
          />
          <Input
            type="number"
            min={0}
            placeholder="Max uses (0 = unlimited)"
            value={form.maxUses}
            onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })}
          />
          <Input
            type="number"
            min={0}
            max={365}
            placeholder="Expires in days (0 = never)"
            value={form.expiresInDays}
            onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) })}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Active
          </label>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Max uses / min order / expiry are optional limits. Editing resets expiry only if "expires
          in days" &gt; 0.
        </p>
        <div className="flex gap-2">
          <Button size="sm" type="submit" disabled={save.isPending}>
            {form.couponId ? "Save changes" : "Create coupon"}
          </Button>
          {form.couponId && (
            <Button size="sm" variant="ghost" type="button" onClick={() => setForm(EMPTY)}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
