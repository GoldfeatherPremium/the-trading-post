import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { getHomeData } from "@/lib/api/catalog";
import { listMyProducts, saveProduct } from "@/lib/api/seller";
import { IMAGE_KEYS, productImage } from "@/lib/images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/seller/new-product")({
  validateSearch: z.object({ edit: z.string().optional() }),
  component: ProductForm,
});

function ProductForm() {
  const { edit } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: home } = useQuery({ queryKey: ["home"], queryFn: () => getHomeData() });
  const { data: mine } = useQuery({
    queryKey: ["myProducts"],
    queryFn: () => listMyProducts(),
    enabled: !!edit,
  });

  const [form, setForm] = useState({
    categoryId: "",
    title: "",
    description: "",
    imageKey: "gold",
    deliveryType: "auto" as "auto" | "manual",
    deliverySlaMinutes: 60,
    warrantyHours: "" as string,
    priceUsdt: "" as string,
    minQty: 1,
    maxQty: 50,
    region: "",
    platform: "",
    requiredInfo: "",
  });

  useEffect(() => {
    if (edit && mine) {
      const p = mine.products.find((x) => x.id === edit);
      if (p) {
        setForm({
          categoryId: p.category_id as string,
          title: p.title as string,
          description: p.description as string,
          imageKey: (p.image_key as string) ?? "gold",
          deliveryType: p.delivery_type as never,
          deliverySlaMinutes: p.delivery_sla_minutes as number,
          warrantyHours: p.warranty_hours ? String(p.warranty_hours) : "",
          priceUsdt: String((p.price_cents as number) / 100),
          minQty: p.min_qty as number,
          maxQty: p.max_qty as number,
          region: (p.region as string) ?? "",
          platform: (p.platform as string) ?? "",
          requiredInfo: (p.required_info as string) ?? "",
        });
      }
    }
  }, [edit, mine]);

  const save = useMutation({
    mutationFn: () =>
      saveProduct({
        data: {
          productId: edit,
          categoryId: form.categoryId,
          title: form.title,
          description: form.description,
          imageKey: form.imageKey,
          deliveryType: form.deliveryType,
          deliverySlaMinutes: Number(form.deliverySlaMinutes),
          warrantyHours: form.warrantyHours ? Number(form.warrantyHours) : null,
          priceUsdt: parseFloat(form.priceUsdt),
          minQty: Number(form.minQty),
          maxQty: Number(form.maxQty),
          region: form.region || undefined,
          platform: form.platform || undefined,
          requiredInfo: form.requiredInfo || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Submitted for review — admins approve listings before they go live.");
      qc.invalidateQueries();
      navigate({ to: "/seller/products" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedCat = home?.categories.find((c) => c.id === form.categoryId);

  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h1 className="font-display text-2xl">{edit ? "EDIT LISTING" : "NEW LISTING"}</h1>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Every new listing and edit goes through admin review before becoming visible.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Category</Label>
          <select
            required
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="w-full bg-secondary border border-border rounded-md px-2 py-2 text-xs h-9"
          >
            <option value="">Select…</option>
            {home?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name} ({c.commission_pct}% fee)
              </option>
            ))}
          </select>
          {selectedCat?.risk_tier === "high" && (
            <p className="text-[10px] text-yellow-400">
              High-risk category: extended warranty, manual delivery recommended.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Price (USDT)</Label>
          <Input
            required
            type="number"
            min="0.5"
            step="0.01"
            value={form.priceUsdt}
            onChange={(e) => setForm({ ...form, priceUsdt: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Title (min. 8 chars)</Label>
        <Input
          required
          minLength={8}
          maxLength={120}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Description (min. 30 chars)</Label>
        <Textarea
          required
          minLength={30}
          rows={5}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What exactly does the buyer get? Delivery method, region locks, warranty terms…"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Cover image</Label>
        <div className="flex gap-2 flex-wrap">
          {IMAGE_KEYS.map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => setForm({ ...form, imageKey: k })}
              className={`size-14 rounded-md overflow-hidden border-2 ${form.imageKey === k ? "border-primary" : "border-transparent opacity-60 hover:opacity-100"}`}
            >
              <img src={productImage(k)} alt={k} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Delivery type</Label>
          <select
            value={form.deliveryType}
            disabled={!!edit}
            onChange={(e) => setForm({ ...form, deliveryType: e.target.value as never })}
            className="w-full bg-secondary border border-border rounded-md px-2 py-2 text-xs h-9"
          >
            <option value="auto">⚡ Auto — codes delivered instantly from stock</option>
            <option value="manual">🕐 Manual — you deliver within an SLA</option>
          </select>
        </div>
        {form.deliveryType === "manual" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Delivery SLA (minutes)</Label>
            <Input
              type="number"
              min={5}
              max={14400}
              value={form.deliverySlaMinutes}
              onChange={(e) => setForm({ ...form, deliverySlaMinutes: Number(e.target.value) })}
            />
          </div>
        )}
      </div>

      {form.deliveryType === "manual" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Info required from buyer at checkout</Label>
          <Input
            value={form.requiredInfo}
            onChange={(e) => setForm({ ...form, requiredInfo: e.target.value })}
            placeholder="e.g. game account ID + server region"
          />
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Min qty</Label>
          <Input
            type="number"
            min={1}
            value={form.minQty}
            onChange={(e) => setForm({ ...form, minQty: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Max qty</Label>
          <Input
            type="number"
            min={1}
            value={form.maxQty}
            onChange={(e) => setForm({ ...form, maxQty: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Region</Label>
          <Input
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
            placeholder="Global"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Platform</Label>
          <Input
            value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value })}
            placeholder="PC"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">
          Warranty hours override (blank = category default
          {selectedCat ? `: ${selectedCat.default_warranty_hours}h` : ""})
        </Label>
        <Input
          type="number"
          min={1}
          value={form.warrantyHours}
          onChange={(e) => setForm({ ...form, warrantyHours: e.target.value })}
          placeholder={selectedCat ? `${selectedCat.default_warranty_hours}` : ""}
        />
      </div>

      <Button type="submit" className="font-bold" disabled={save.isPending}>
        {save.isPending ? "Submitting…" : edit ? "Save & resubmit for review" : "Submit for review"}
      </Button>
    </form>
  );
}
