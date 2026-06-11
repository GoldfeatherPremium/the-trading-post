import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { applyForVerification, getMyVerification } from "@/lib/api/trust";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { VerificationBadge } from "@/components/seller-badge";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/seller/verification")({
  head: () => ({ meta: [{ title: "Seller verification — X-VAULT" }] }),
  component: VerificationPage,
});

type Tier = "verified" | "business" | "premium";

const TIER_INFO: Record<Tier, { title: string; bullet: string[] }> = {
  verified: {
    title: "Verified",
    bullet: [
      "Government ID confirmed",
      "Verified badge on every listing",
      "+5 trust score boost",
    ],
  },
  business: {
    title: "Business",
    bullet: [
      "Registered business documentation",
      "Business badge + storefront highlight",
      "+10 trust score boost",
    ],
  },
  premium: {
    title: "Premium",
    bullet: [
      "Manual vetting by trust & safety",
      "Premium crown badge + priority placement",
      "+15 trust score boost",
    ],
  },
};

function VerificationPage() {
  const { me } = useMe();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["myVerification"],
    queryFn: () => getMyVerification(),
    enabled: !!me,
  });

  const [tier, setTier] = useState<Tier>("verified");
  const [legalName, setLegalName] = useState("");
  const [country, setCountry] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [registration, setRegistration] = useState("");
  const [idRef, setIdRef] = useState("");
  const [notes, setNotes] = useState("");

  const apply = useMutation({
    mutationFn: () =>
      applyForVerification({
        data: {
          tierRequested: tier,
          legalName,
          country,
          businessName: businessName || undefined,
          businessRegistration: registration || undefined,
          idDocRef: idRef || undefined,
          notes: notes || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myVerification"] });
      toast.success("Application submitted — we'll review within 48h");
      setLegalName("");
      setBusinessName("");
      setRegistration("");
      setIdRef("");
      setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const application = data?.application ?? null;
  const pending = application?.status === "pending";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">VERIFICATION</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Verified sellers convert more, rank higher, and receive priority support.
        </p>
      </div>

      {application && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase font-bold text-muted-foreground">Latest application:</span>
            <VerificationBadge tier={application.tier_requested} size="xs" />
            <span
              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                application.status === "pending"
                  ? "bg-yellow-500/15 text-yellow-400"
                  : application.status === "approved"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-destructive/15 text-destructive"
              }`}
            >
              {application.status}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {timeAgo(application.created_at)}
            </span>
          </div>
          {application.admin_note && (
            <p className="text-xs text-muted-foreground">
              <b className="text-foreground">Note:</b> {application.admin_note}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.keys(TIER_INFO) as Tier[]).map((t) => {
          const info = TIER_INFO[t];
          const active = tier === t;
          return (
            <button
              key={t}
              type="button"
              disabled={pending}
              onClick={() => setTier(t)}
              className={`text-left rounded-lg border p-3 transition ${
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/40"
              } ${pending ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <div className="flex items-center justify-between mb-2">
                <VerificationBadge tier={t} size="sm" />
              </div>
              <p className="font-display text-sm mb-2">{info.title}</p>
              <ul className="text-[11px] text-muted-foreground space-y-1">
                {info.bullet.map((b) => (
                  <li key={b}>• {b}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!legalName || !country) {
            toast.error("Legal name and country are required");
            return;
          }
          apply.mutate();
        }}
        className="bg-card border border-border rounded-lg p-4 space-y-3"
      >
        <fieldset disabled={pending} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Legal name *" value={legalName} onChange={setLegalName} />
            <Input label="Country *" value={country} onChange={setCountry} />
          </div>
          {(tier === "business" || tier === "premium") && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Business name *" value={businessName} onChange={setBusinessName} />
              <Input
                label="Registration number"
                value={registration}
                onChange={setRegistration}
              />
            </div>
          )}
          <Input
            label="ID document reference"
            value={idRef}
            onChange={setIdRef}
            placeholder="e.g. upload link, passport number prefix"
          />
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
              Notes for reviewer
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full mt-1 bg-secondary border border-border rounded-md px-3 py-2 text-xs"
            />
          </label>
          <Button type="submit" className="w-full font-bold" disabled={apply.isPending || pending}>
            {pending
              ? "Application under review"
              : apply.isPending
                ? "Submitting…"
                : `Apply for ${TIER_INFO[tier].title}`}
          </Button>
        </fieldset>
      </form>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 bg-secondary border border-border rounded-md px-3 py-2 text-xs"
      />
    </label>
  );
}
