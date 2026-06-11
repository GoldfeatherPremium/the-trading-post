import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, BookOpen, ListChecks, Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { getHomeData, listCatalogItems } from "@/lib/api/catalog";
import { suggestItem } from "@/lib/api/seller";
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
  const [agreed, setAgreed] = useState(false);
  const [variants, setVariants] = useState<Array<{ title: string; priceUsdt: string }>>([]);
  const [expiresInDays, setExpiresInDays] = useState(0);
  const [insuranceDays, setInsuranceDays] = useState(0);
  const [itemId, setItemId] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestName, setSuggestName] = useState("");
  const { data: catalog } = useQuery({
    queryKey: ["catalogItems"],
    queryFn: () => listCatalogItems(),
  });
  const suggest = useMutation({
    mutationFn: () => suggestItem({ data: { name: suggestName } }),
    onSuccess: () => {
      toast.success("Request sent — admins will review it and you'll get a notification.");
      setSuggesting(false);
      setSuggestName("");
    },
    onError: (e: Error) => toast.error(e.message),
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
        setItemId((p.item_id as string) ?? "");
      }
    }
  }, [edit, mine]);

  const save = useMutation({
    mutationFn: () =>
      saveProduct({
        data: {
          productId: edit,
          itemId: itemId || undefined,
          variants: variants
            .filter((v) => v.title.trim() && parseFloat(v.priceUsdt) > 0)
            .map((v) => ({ title: v.title.trim(), priceUsdt: parseFloat(v.priceUsdt) })),
          expiresInDays,
          insuranceDays,
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
      <h1 className="font-display text-2xl">{edit ? "EDIT LISTING" : "CREATE LISTING"}</h1>
      <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-lg p-3 flex gap-2 text-[11px] leading-relaxed">
        <AlertTriangle className="size-4 text-yellow-400 shrink-0 mt-0.5" />
        <span>
          Sellers are strictly prohibited from listing any product or service that violates local
          laws or the underlying service's terms: stolen/carded gift cards, hacked accounts,
          unauthorized credentials or shared-credential subscriptions. Violations lead to a
          permanent ban with frozen funds. Every new listing and edit goes through staff review
          before becoming visible.
        </span>
      </div>
      <h2 className="text-sm font-bold flex items-center gap-2 pt-1">
        <BookOpen className="size-4 text-primary" /> General Info
      </h2>

      <div className="space-y-1.5">
        <Label className="text-xs">Selling item (game / brand / service)</Label>
        <select
          value={itemId}
          onChange={(e) => {
            setItemId(e.target.value);
            setForm({ ...form, categoryId: "" });
          }}
          className="w-full bg-secondary border border-border rounded-md px-2 py-2 text-xs h-9"
        >
          <option value="">— General (no specific item) —</option>
          {catalog?.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="text-[10px] text-primary font-bold"
          onClick={() => setSuggesting(!suggesting)}
        >
          Can't find it? Request a new item →
        </button>
        {suggesting && (
          <div className="flex gap-2 pt-1">
            <Input
              placeholder="Item name (e.g. LinkedIn, Spotify, Valorant)"
              value={suggestName}
              onChange={(e) => setSuggestName(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              type="button"
              size="sm"
              disabled={suggest.isPending || suggestName.trim().length < 2}
              onClick={() => suggest.mutate()}
            >
              Send request
            </Button>
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Sub-category</Label>
          <select
            required
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="w-full bg-secondary border border-border rounded-md px-2 py-2 text-xs h-9"
          >
            <option value="">Select…</option>
            {home?.categories
              .filter((c) => {
                if (!itemId) return true;
                const item = catalog?.items.find((i) => i.id === itemId);
                return !item || item.categoryIds.length === 0 || item.categoryIds.includes(c.id);
              })
              .map((c) => (
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

      <h2 className="text-sm font-bold flex items-center gap-2 pt-2">
        <ListChecks className="size-4 text-primary" /> Delivery Option
      </h2>
      <div className="bg-secondary/50 border border-border rounded-lg p-3 text-[10px] text-muted-foreground leading-relaxed">
        Set the delivery time cautiously — buyers expect every order completed within it. If you
        miss the guarantee, the buyer can cancel for a full refund, your completion rate drops, and
        repeated breaches affect your seller level.
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
            <Label className="text-xs">Delivery ETA (guaranteed)</Label>
            <select
              value={form.deliverySlaMinutes}
              onChange={(e) => setForm({ ...form, deliverySlaMinutes: Number(e.target.value) })}
              className="w-full bg-secondary border border-border rounded-md px-2 py-2 text-xs h-9"
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={180}>3 hours</option>
              <option value={360}>6 hours</option>
              <option value={720}>12 hours</option>
              <option value={1440}>24 hours</option>
              <option value={4320}>3 days</option>
              <option value={10080}>7 days</option>
            </select>
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

      <div className="space-y-1.5">
        <Label className="text-xs">Custom programs / price tiers (optional)</Label>
        <p className="text-[10px] text-muted-foreground">
          Offer multiple options on one listing, e.g. "1 Month" / "3 Months" / "12 Months". Buyers
          pick one at checkout; leave empty for a single-price listing.
        </p>
        {variants.map((v, i) => (
          <div key={i} className="flex gap-2">
            <Input
              placeholder={`Option ${i + 1} title (e.g. 1 Month)`}
              value={v.title}
              onChange={(e) =>
                setVariants(variants.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
              }
            />
            <Input
              type="number"
              min="0.5"
              step="0.01"
              placeholder="USDT"
              className="w-28"
              value={v.priceUsdt}
              onChange={(e) =>
                setVariants(
                  variants.map((x, j) => (j === i ? { ...x, priceUsdt: e.target.value } : x)),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setVariants(variants.filter((_, j) => j !== i))}
            >
              ×
            </Button>
          </div>
        ))}
        {variants.length < 20 && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setVariants([...variants, { title: "", priceUsdt: "" }])}
          >
            ⊕ Add custom program
          </Button>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">⏱ Listing expiration</Label>
          <div className="flex gap-2">
            {[0, 7, 15, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setExpiresInDays(d)}
                className={`px-3 py-2 rounded-md text-xs font-bold border ${
                  expiresInDays === d
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-secondary hover:bg-border"
                }`}
              >
                {d === 0 ? "No expiry" : `${d} Days`}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Expired listings pause automatically; edit & resubmit to relist.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">🛡 Insurance program</Label>
          <div className="flex gap-2">
            {[0, 7, 15, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setInsuranceDays(d)}
                className={`px-3 py-2 rounded-md text-xs font-bold border ${
                  insuranceDays === d
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border bg-secondary hover:bg-border"
                }`}
              >
                {d === 0 ? "Do not join" : `${d} Days`}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Extends buyer warranty by the chosen days; insured listings rank first in browse.
          </p>
        </div>
      </div>

      <h2 className="text-sm font-bold flex items-center gap-2 pt-2">
        <Send className="size-4 text-primary" /> Publish
      </h2>
      <label className="flex items-start gap-2 text-[11px] text-muted-foreground leading-relaxed cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I have read and agree to the seller policy and prohibited items rules. I confirm I am
          authorized to sell this product and it does not violate the underlying service's terms.
        </span>
      </label>
      <Button
        type="submit"
        className="font-bold w-full sm:w-auto"
        disabled={save.isPending || !agreed}
      >
        {save.isPending ? "Submitting…" : edit ? "Save & resubmit for review" : "Submit for review"}
      </Button>
    </form>
  );
}
