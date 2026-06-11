import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { adminListCategories, adminSaveCategory } from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/categories")({
  component: AdminCategories,
});

const EMPTY = {
  categoryId: undefined as string | undefined,
  name: "",
  slug: "",
  icon: "📦",
  defaultWarrantyHours: 72,
  commissionPct: 8,
  riskTier: "normal" as "normal" | "high",
  isActive: true,
};

function AdminCategories() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["adminCategories"],
    queryFn: () => adminListCategories(),
  });
  const [form, setForm] = useState(EMPTY);

  const save = useMutation({
    mutationFn: () => adminSaveCategory({ data: form }),
    onSuccess: () => {
      toast.success("Category saved");
      setForm(EMPTY);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">CATEGORIES</h1>
      <div className="space-y-2">
        {data?.categories.map((c) => (
          <div
            key={c.id as string}
            className="bg-card border border-border rounded-lg p-3 flex items-center gap-3 text-xs flex-wrap"
          >
            <span className="text-lg">{c.icon}</span>
            <span className="font-bold">{c.name}</span>
            <span className="text-muted-foreground font-mono">/{c.slug}</span>
            <span className="text-[10px] text-muted-foreground">
              warranty {c.default_warranty_hours}h · fee {c.commission_pct}% · {c.product_count}{" "}
              live products
            </span>
            {c.risk_tier === "high" && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                HIGH RISK
              </span>
            )}
            {!c.is_active && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-muted">DISABLED</span>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto h-7 text-[10px]"
              onClick={() =>
                setForm({
                  categoryId: c.id as string,
                  name: c.name as string,
                  slug: c.slug as string,
                  icon: (c.icon as string) ?? "📦",
                  defaultWarrantyHours: c.default_warranty_hours as number,
                  commissionPct: c.commission_pct as number,
                  riskTier: c.risk_tier as never,
                  isActive: !!c.is_active,
                })
              }
            >
              Edit
            </Button>
          </div>
        ))}
      </div>

      <form
        className="bg-card border border-border rounded-lg p-4 space-y-3 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h2 className="text-xs font-bold tracking-widest">
          {form.categoryId ? "EDIT CATEGORY" : "NEW CATEGORY"}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Input
            required
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            required
            placeholder="slug"
            pattern="[a-z0-9-]+"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
          />
          <Input
            placeholder="Icon (emoji)"
            value={form.icon}
            onChange={(e) => setForm({ ...form, icon: e.target.value })}
          />
          <Input
            type="number"
            min={1}
            placeholder="Warranty h"
            value={form.defaultWarrantyHours}
            onChange={(e) => setForm({ ...form, defaultWarrantyHours: Number(e.target.value) })}
          />
          <Input
            type="number"
            min={0}
            max={50}
            step="0.5"
            placeholder="Fee %"
            value={form.commissionPct}
            onChange={(e) => setForm({ ...form, commissionPct: Number(e.target.value) })}
          />
          <select
            value={form.riskTier}
            onChange={(e) => setForm({ ...form, riskTier: e.target.value as never })}
            className="bg-secondary border border-border rounded-md px-2 text-xs h-9"
          >
            <option value="normal">normal risk</option>
            <option value="high">high risk</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Active (visible to buyers and sellers)
        </label>
        <div className="flex gap-2">
          <Button size="sm" type="submit" disabled={save.isPending}>
            {form.categoryId ? "Save changes" : "Create category"}
          </Button>
          {form.categoryId && (
            <Button size="sm" variant="ghost" type="button" onClick={() => setForm(EMPTY)}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
