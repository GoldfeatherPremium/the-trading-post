import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Globe, Twitter, MessageCircle, Send, Youtube, Store } from "lucide-react";
import { getMyStorefront, saveStorefront } from "@/lib/api/seller";

export const Route = createFileRoute("/seller/storefront")({
  head: () => ({ meta: [{ title: "Storefront — X-VAULT" }] }),
  component: StorefrontEdit,
});

type Socials = { website?: string; twitter?: string; discord?: string; telegram?: string; youtube?: string };

function StorefrontEdit() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["myStorefront"], queryFn: () => getMyStorefront() });
  const [form, setForm] = useState({
    bannerUrl: "",
    logoUrl: "",
    description: "",
    announcement: "",
    socials: {} as Socials,
  });

  useEffect(() => {
    if (data) {
      setForm({
        bannerUrl: data.bannerUrl,
        logoUrl: data.logoUrl,
        description: data.description,
        announcement: data.announcement,
        socials: data.socials as Socials,
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => saveStorefront({ data: form }),
    onSuccess: () => {
      toast.success("Storefront updated");
      qc.invalidateQueries({ queryKey: ["myStorefront"] });
      if (data?.username) qc.invalidateQueries({ queryKey: ["sellerStore", data.username] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const socialFields: Array<{ k: keyof Socials; label: string; icon: typeof Globe; placeholder: string }> = [
    { k: "website", label: "Website", icon: Globe, placeholder: "https://your-site.com" },
    { k: "twitter", label: "Twitter / X", icon: Twitter, placeholder: "https://x.com/handle" },
    { k: "discord", label: "Discord", icon: MessageCircle, placeholder: "https://discord.gg/..." },
    { k: "telegram", label: "Telegram", icon: Send, placeholder: "https://t.me/handle" },
    { k: "youtube", label: "YouTube", icon: Youtube, placeholder: "https://youtube.com/@channel" },
  ];

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-2">
        <Store className="size-5 text-primary" />
        <h2 className="font-display text-2xl">Storefront branding</h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        How your public store at <span className="font-mono">/s/{data?.username ?? "…"}</span> looks to buyers.
      </p>

      {/* Live preview */}
      <div className="rounded-xl overflow-hidden border border-border bg-card">
        <div
          className="h-32 bg-secondary bg-center bg-cover"
          style={form.bannerUrl ? { backgroundImage: `url(${form.bannerUrl})` } : undefined}
        />
        <div className="p-4 flex items-center gap-3">
          {form.logoUrl ? (
            <img
              src={form.logoUrl}
              alt=""
              className="size-14 rounded-xl object-cover border border-border -mt-10 bg-background"
            />
          ) : (
            <div className="size-14 rounded-xl bg-primary/20 border border-primary/40 grid place-items-center text-lg font-bold text-primary uppercase -mt-10">
              {data?.username?.slice(0, 2)}
            </div>
          )}
          <div className="text-xs text-muted-foreground line-clamp-2">
            {form.description || "Add a short description to introduce your store."}
          </div>
        </div>
      </div>

      <Field label="Banner image URL" hint="Recommended 1600 × 400">
        <input
          className="input"
          placeholder="https://…"
          value={form.bannerUrl}
          onChange={(e) => setForm({ ...form, bannerUrl: e.target.value })}
        />
      </Field>

      <Field label="Logo / avatar URL" hint="Recommended square, 256 × 256">
        <input
          className="input"
          placeholder="https://…"
          value={form.logoUrl}
          onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
        />
      </Field>

      <Field label="Store description" hint={`${form.description.length} / 1500`}>
        <textarea
          rows={4}
          className="input"
          maxLength={1500}
          placeholder="Tell buyers what you specialise in, your delivery hours, anything that builds trust."
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>

      <Field label="Store announcement" hint={`${form.announcement.length} / 280 — shown as a banner at the top of your store`}>
        <input
          className="input"
          maxLength={280}
          placeholder="e.g. ⚡ Restocked all Steam keys today — instant delivery."
          value={form.announcement}
          onChange={(e) => setForm({ ...form, announcement: e.target.value })}
        />
      </Field>

      <div>
        <p className="text-xs font-bold tracking-widest text-muted-foreground mb-2">SOCIAL LINKS</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {socialFields.map(({ k, label, icon: Icon, placeholder }) => (
            <label key={k} className="block">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 mb-1">
                <Icon className="size-3.5" /> {label}
              </span>
              <input
                className="input"
                placeholder={placeholder}
                value={form.socials[k] ?? ""}
                onChange={(e) =>
                  setForm({ ...form, socials: { ...form.socials, [k]: e.target.value } })
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="bg-primary text-primary-foreground text-xs font-bold tracking-widest px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {save.isPending ? "SAVING…" : "SAVE STOREFRONT"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold tracking-widest text-muted-foreground">
        {label.toUpperCase()}
      </span>
      {hint && <span className="block text-[10px] text-muted-foreground/80 mb-1">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}
