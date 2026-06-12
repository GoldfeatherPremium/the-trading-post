import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  deleteMyCoupon,
  listMyProductsForPromo,
  listMyPromotions,
  saveMyCoupon,
  setProductSale,
} from "@/lib/api/promotions";
import { usdt } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/seller/promotions")({
  head: () => ({ meta: [{ title: "Promotions — X-VAULT" }] }),
  component: PromotionsPage,
});

function PromotionsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["myPromotions"], queryFn: () => listMyPromotions() });
  const { data: productList } = useQuery({
    queryKey: ["promoProducts"],
    queryFn: () => listMyProductsForPromo(),
  });
  const [editingCoupon, setEditingCoupon] = useState<Record<string, unknown> | null>(null);
  const [showNewCoupon, setShowNewCoupon] = useState(false);
  const [salesEditor, setSalesEditor] = useState<{
    productId: string;
    title: string;
    priceCents: number;
  } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["myPromotions"] });
    qc.invalidateQueries({ queryKey: ["promoProducts"] });
  };

  const delMut = useMutation({
    mutationFn: (couponId: string) => deleteMyCoupon({ data: { couponId } }),
    onSuccess: () => {
      toast.success("Coupon deleted");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-bold tracking-[0.25em] text-muted-foreground">
          MARKETING TOOLS
        </p>
        <h1 className="font-display text-xl">Promotions</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Run flash sales and issue your own discount codes to drive demand.
        </p>
      </div>

      <section className="bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold tracking-widest text-muted-foreground">
            DISCOUNT CODES
          </h2>
          <button
            onClick={() => {
              setEditingCoupon(null);
              setShowNewCoupon(true);
            }}
            className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-bold"
          >
            + New code
          </button>
        </div>
        {!data?.coupons.length ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No coupons yet.</p>
        ) : (
          <div className="space-y-2">
            {data.coupons.map((c) => {
              const expired = c.expires_at && Number(c.expires_at) < Date.now();
              const exhausted =
                Number(c.max_uses) > 0 && Number(c.used_count) >= Number(c.max_uses);
              return (
                <div
                  key={String(c.id)}
                  className="flex items-center justify-between gap-3 p-3 rounded border border-border/60 bg-background/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">{c.code}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                        -{Number(c.pct_off)}%
                      </span>
                      {!c.is_active && (
                        <span className="text-[10px] font-bold text-muted-foreground">PAUSED</span>
                      )}
                      {expired && (
                        <span className="text-[10px] font-bold text-destructive">EXPIRED</span>
                      )}
                      {exhausted && (
                        <span className="text-[10px] font-bold text-yellow-400">USED UP</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {c.product_title ? `Scoped to: ${c.product_title}` : "All your products"}
                      {Number(c.max_uses) > 0
                        ? ` · ${c.used_count}/${c.max_uses} used`
                        : ` · ${c.used_count} used`}
                      {c.expires_at
                        ? ` · expires ${new Date(Number(c.expires_at)).toLocaleDateString()}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingCoupon(c);
                        setShowNewCoupon(true);
                      }}
                      className="px-2 py-1 text-[11px] font-bold bg-secondary rounded hover:bg-border"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete coupon ${c.code}?`)) delMut.mutate(String(c.id));
                      }}
                      className="px-2 py-1 text-[11px] font-bold text-destructive bg-destructive/10 rounded hover:bg-destructive/20"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold tracking-widest text-muted-foreground">FLASH SALES</h2>
        </div>
        {!productList?.products.length ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Add a product first.
          </p>
        ) : (
          <div className="space-y-2">
            {productList.products.map((p) => {
              const active = data?.sales.find((s) => s.id === p.id);
              const endsAt = active?.sale_ends_at ? Number(active.sale_ends_at) : null;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 p-3 rounded border border-border/60 bg-background/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{p.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Regular {usdt(p.price_cents)}
                      {active && (
                        <>
                          {" · "}
                          <span className="text-accent">
                            sale {usdt(Number(active.sale_price_cents))}
                          </span>
                          {endsAt && ` · until ${new Date(endsAt).toLocaleDateString()}`}
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setSalesEditor({
                        productId: p.id,
                        title: p.title,
                        priceCents: p.price_cents,
                      })
                    }
                    className="px-2 py-1 text-[11px] font-bold bg-secondary rounded hover:bg-border shrink-0"
                  >
                    {active ? "Manage" : "Start sale"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {data && data.recentRedemptions.length > 0 && (
        <section className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-xs font-bold tracking-widest text-muted-foreground mb-3">
            COUPON PERFORMANCE — LAST 90 DAYS
          </h2>
          <div className="grid grid-cols-[1fr_60px_90px_90px] gap-2 text-[9px] font-bold text-muted-foreground tracking-widest pb-1 border-b border-border">
            <span>CODE</span>
            <span className="text-right">ORDERS</span>
            <span className="text-right">GROSS</span>
            <span className="text-right">DISCOUNTED</span>
          </div>
          {data.recentRedemptions.map((r) => (
            <div
              key={r.coupon_code}
              className="grid grid-cols-[1fr_60px_90px_90px] gap-2 text-xs py-1.5 border-b border-border/40 last:border-0"
            >
              <span className="font-mono font-bold truncate">{r.coupon_code}</span>
              <span className="text-right font-mono">{r.orders}</span>
              <span className="text-right font-mono">{usdt(r.gross)}</span>
              <span className="text-right font-mono text-accent">-{usdt(r.discount)}</span>
            </div>
          ))}
        </section>
      )}

      {showNewCoupon && (
        <CouponDialog
          coupon={editingCoupon}
          products={productList?.products ?? []}
          onClose={() => {
            setShowNewCoupon(false);
            setEditingCoupon(null);
          }}
          onSaved={() => {
            setShowNewCoupon(false);
            setEditingCoupon(null);
            refresh();
          }}
        />
      )}

      {salesEditor && (
        <SaleDialog
          ctx={salesEditor}
          activeSale={data?.sales.find((s) => s.id === salesEditor.productId) ?? null}
          onClose={() => setSalesEditor(null)}
          onSaved={() => {
            setSalesEditor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CouponDialog({
  coupon,
  products,
  onClose,
  onSaved,
}: {
  coupon: Record<string, unknown> | null;
  products: Array<{ id: string; title: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    code: String(coupon?.code ?? ""),
    pctOff: Number(coupon?.pct_off ?? 10),
    minTotalUsdt: coupon?.min_total_cents ? Number(coupon.min_total_cents) / 100 : 0,
    maxUses: Number(coupon?.max_uses ?? 0),
    expiresInDays: coupon?.expires_at
      ? Math.max(
          0,
          Math.ceil((Number(coupon.expires_at) - Date.now()) / 86_400_000),
        )
      : 30,
    productId: coupon?.product_id ? String(coupon.product_id) : "",
    label: String(coupon?.label ?? ""),
    isActive: coupon ? !!coupon.is_active : true,
  });
  const mut = useMutation({
    mutationFn: () =>
      saveMyCoupon({
        data: {
          couponId: coupon?.id ? String(coupon.id) : undefined,
          code: form.code.trim(),
          pctOff: form.pctOff,
          minTotalUsdt: form.minTotalUsdt,
          maxUses: form.maxUses,
          expiresInDays: form.expiresInDays,
          productId: form.productId || undefined,
          label: form.label || undefined,
          isActive: form.isActive,
        },
      }),
    onSuccess: () => {
      toast.success(coupon ? "Coupon updated" : "Coupon created");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-xl p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg">{coupon ? "Edit coupon" : "New coupon"}</h2>
        <Field label="Code">
          <input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            className="w-full px-3 py-2 bg-secondary rounded font-mono text-sm uppercase"
            placeholder="SUMMER20"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="% off">
            <input
              type="number"
              min={1}
              max={80}
              value={form.pctOff}
              onChange={(e) => setForm({ ...form, pctOff: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-secondary rounded text-sm"
            />
          </Field>
          <Field label="Min order USDT">
            <input
              type="number"
              min={0}
              value={form.minTotalUsdt}
              onChange={(e) => setForm({ ...form, minTotalUsdt: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-secondary rounded text-sm"
            />
          </Field>
          <Field label="Max uses (0 = ∞)">
            <input
              type="number"
              min={0}
              value={form.maxUses}
              onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-secondary rounded text-sm"
            />
          </Field>
          <Field label="Expires in days (0 = never)">
            <input
              type="number"
              min={0}
              max={365}
              value={form.expiresInDays}
              onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-secondary rounded text-sm"
            />
          </Field>
        </div>
        <Field label="Scope">
          <select
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
            className="w-full px-3 py-2 bg-secondary rounded text-sm"
          >
            <option value="">All my products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Active (buyers can redeem)
        </label>
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded bg-secondary text-sm font-bold"
          >
            Cancel
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="flex-1 px-3 py-2 rounded bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50"
          >
            {mut.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SaleDialog({
  ctx,
  activeSale,
  onClose,
  onSaved,
}: {
  ctx: { productId: string; title: string; priceCents: number };
  activeSale: Record<string, unknown> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [salePrice, setSalePrice] = useState(
    activeSale?.sale_price_cents
      ? Number(activeSale.sale_price_cents) / 100
      : Number((ctx.priceCents * 0.8).toFixed(2)) / 100,
  );
  const [days, setDays] = useState(7);
  const setMut = useMutation({
    mutationFn: (clear: boolean) =>
      setProductSale({
        data: {
          productId: ctx.productId,
          salePriceUsdt: clear ? null : salePrice,
          endsInDays: days,
        },
      }),
    onSuccess: () => {
      toast.success("Sale updated");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-xl p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg">Flash sale</h2>
        <p className="text-xs text-muted-foreground">
          {ctx.title} — regular {usdt(ctx.priceCents)}
        </p>
        <Field label="Sale price (USDT)">
          <input
            type="number"
            min={0.5}
            step={0.01}
            value={salePrice}
            onChange={(e) => setSalePrice(Number(e.target.value))}
            className="w-full px-3 py-2 bg-secondary rounded text-sm"
          />
        </Field>
        <Field label="Ends in (days, 0 = no end)">
          <input
            type="number"
            min={0}
            max={60}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full px-3 py-2 bg-secondary rounded text-sm"
          />
        </Field>
        <div className="flex gap-2 pt-2">
          {activeSale && (
            <button
              onClick={() => setMut.mutate(true)}
              disabled={setMut.isPending}
              className="flex-1 px-3 py-2 rounded bg-destructive/10 text-destructive text-sm font-bold disabled:opacity-50"
            >
              End sale
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded bg-secondary text-sm font-bold"
          >
            Cancel
          </button>
          <button
            onClick={() => setMut.mutate(false)}
            disabled={setMut.isPending}
            className="flex-1 px-3 py-2 rounded bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50"
          >
            {setMut.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-bold tracking-widest text-muted-foreground">
        {label.toUpperCase()}
      </span>
      {children}
    </label>
  );
}
