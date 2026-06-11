import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminDeleteFxRate,
  adminSetBaseCurrency,
  adminUpsertFxRate,
  getI18nBootstrap,
} from "@/lib/api/i18n";

export const Route = createFileRoute("/admin/fx")({
  head: () => ({ meta: [{ title: "FX & currency — Admin" }] }),
  component: AdminFxPage,
});

function AdminFxPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["i18nBootstrap"], queryFn: () => getI18nBootstrap() });
  const [form, setForm] = useState({ currency: "", rate_to_base: "", symbol: "" });

  const upsert = useMutation({
    mutationFn: (d: { currency: string; rate_to_base: number; symbol?: string }) =>
      adminUpsertFxRate({ data: d }),
    onSuccess: () => {
      toast.success("Rate saved");
      setForm({ currency: "", rate_to_base: "", symbol: "" });
      qc.invalidateQueries({ queryKey: ["i18nBootstrap"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (currency: string) => adminDeleteFxRate({ data: { currency } }),
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["i18nBootstrap"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setBase = useMutation({
    mutationFn: (currency: string) => adminSetBaseCurrency({ data: { currency } }),
    onSuccess: () => {
      toast.success("Base currency updated");
      qc.invalidateQueries({ queryKey: ["i18nBootstrap"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return <p className="text-xs text-muted-foreground py-10">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-[10px] font-bold tracking-widest text-muted-foreground">BASE CURRENCY</p>
        <p className="text-2xl font-display mt-1">{data.baseCurrency}</p>
        <p className="text-[10px] text-muted-foreground mt-1">
          Catalog prices are stored in this currency. Buyers see prices converted to their preferred
          currency using the rates below.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          <h2 className="text-xs font-bold tracking-widest">FX RATES (relative to base)</h2>
          <span className="text-[10px] text-muted-foreground">
            1 {data.baseCurrency} = rate × foreign
          </span>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-secondary/40 text-[10px] tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">CURRENCY</th>
              <th className="text-left px-3 py-2">SYMBOL</th>
              <th className="text-right px-3 py-2">RATE / BASE</th>
              <th className="text-left px-3 py-2">UPDATED</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.rates.map((r) => {
              const isBase = r.currency === data.baseCurrency;
              return (
                <tr key={r.currency} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">
                    {r.currency}
                    {isBase && (
                      <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        BASE
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.symbol ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.rate_to_base}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(r.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right space-x-1">
                    {!isBase && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setBase.mutate(r.currency)}
                          disabled={setBase.isPending}
                        >
                          Make base
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => del.mutate(r.currency)}
                          disabled={del.isPending}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form
        className="rounded-lg border border-border bg-card p-4 space-y-3 max-w-lg"
        onSubmit={(e) => {
          e.preventDefault();
          const rate = parseFloat(form.rate_to_base);
          if (!form.currency || !isFinite(rate) || rate <= 0) {
            toast.error("Provide a currency code and positive rate.");
            return;
          }
          upsert.mutate({
            currency: form.currency.toUpperCase().trim(),
            rate_to_base: rate,
            symbol: form.symbol || undefined,
          });
        }}
      >
        <h2 className="text-xs font-bold tracking-widest">ADD / UPDATE RATE</h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px]">Code (e.g. EUR)</Label>
            <Input
              maxLength={4}
              value={form.currency}
              onChange={(e) =>
                setForm({ ...form, currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Rate / base</Label>
            <Input
              inputMode="decimal"
              value={form.rate_to_base}
              onChange={(e) => setForm({ ...form, rate_to_base: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Symbol</Label>
            <Input
              maxLength={3}
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            />
          </div>
        </div>
        <Button size="sm" type="submit" disabled={upsert.isPending}>
          Save rate
        </Button>
      </form>
    </div>
  );
}
