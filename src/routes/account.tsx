import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateProfile } from "@/lib/api/auth";
import { getI18nBootstrap, updatePreferences } from "@/lib/api/i18n";
import { useMe } from "@/hooks/use-me";
import { PageShell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — X-VAULT" }] }),
  component: AccountPage,
});

function AccountPage() {
  const { me } = useMe();
  const qc = useQueryClient();
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const i18n = useQuery({ queryKey: ["i18nBootstrap"], queryFn: () => getI18nBootstrap() });
  const [prefs, setPrefs] = useState({ locale: "en", preferred_currency: "USD", country: "" });

  useEffect(() => {
    if (me) {
      setPrefs({
        locale: (me as unknown as { locale?: string }).locale ?? "en",
        preferred_currency:
          (me as unknown as { preferred_currency?: string }).preferred_currency ?? "USD",
        country: (me as unknown as { country?: string | null }).country ?? "",
      });
    }
  }, [me]);

  const save = useMutation({
    mutationFn: (data: Parameters<typeof updateProfile>[0]["data"]) => updateProfile({ data }),
    onSuccess: () => {
      toast.success("Saved");
      setPw({ currentPassword: "", newPassword: "" });
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePrefs = useMutation({
    mutationFn: (data: Parameters<typeof updatePreferences>[0]["data"]) =>
      updatePreferences({ data }),
    onSuccess: () => {
      toast.success("Preferences updated");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!me)
    return (
      <PageShell>
        <p className="py-16 text-center text-sm text-muted-foreground">
          Sign in to manage your account.
        </p>
      </PageShell>
    );

  return (
    <PageShell>
      <h1 className="font-display text-3xl mb-4">ACCOUNT</h1>
      <div className="max-w-lg space-y-4">
        <div className="bg-card border border-border rounded-lg p-4 space-y-1 text-xs">
          <p>
            <b>Username:</b> {me.username}
          </p>
          <p>
            <b>Email:</b> {me.email}
          </p>
          <p>
            <b>Role:</b> {me.role}
          </p>
          <p>
            <b>Member since:</b> {new Date(me.created_at).toLocaleDateString()}
          </p>
          {me.seller_status !== "none" && (
            <p>
              <b>Seller status:</b> {me.seller_status} (level {me.seller_level})
            </p>
          )}
        </div>

        {me.seller_status === "approved" && (
          <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold">Vacation mode</p>
              <p className="text-[10px] text-muted-foreground">
                Pause new orders on all your listings.
              </p>
            </div>
            <Switch
              checked={!!me.vacation_mode}
              onCheckedChange={(v) => save.mutate({ vacation_mode: v })}
            />
          </div>
        )}

        <form
          className="bg-card border border-border rounded-lg p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            savePrefs.mutate({
              locale: prefs.locale,
              preferred_currency: prefs.preferred_currency,
              country: prefs.country || null,
            });
          }}
        >
          <h2 className="text-xs font-bold tracking-widest">REGION & LANGUAGE</h2>
          <p className="text-[10px] text-muted-foreground">
            Used for currency display and to enforce country-restricted listings at checkout.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[10px]">Country</Label>
              <select
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs"
                value={prefs.country}
                onChange={(e) => setPrefs({ ...prefs, country: e.target.value })}
              >
                <option value="">— Not set —</option>
                {i18n.data?.countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">Language</Label>
              <select
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs"
                value={prefs.locale}
                onChange={(e) => setPrefs({ ...prefs, locale: e.target.value })}
              >
                {i18n.data?.locales.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px]">Currency</Label>
              <select
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs"
                value={prefs.preferred_currency}
                onChange={(e) => setPrefs({ ...prefs, preferred_currency: e.target.value })}
              >
                {i18n.data?.rates.map((r) => (
                  <option key={r.currency} value={r.currency}>
                    {r.currency} {r.symbol ? `(${r.symbol})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button size="sm" type="submit" disabled={savePrefs.isPending}>
            Save preferences
          </Button>
        </form>


        <form
          className="bg-card border border-border rounded-lg p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(pw);
          }}
        >
          <h2 className="text-xs font-bold tracking-widest">CHANGE PASSWORD</h2>
          <div className="space-y-1.5">
            <Label className="text-xs">Current password</Label>
            <Input
              type="password"
              value={pw.currentPassword}
              onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">New password (min. 8 chars)</Label>
            <Input
              type="password"
              minLength={8}
              value={pw.newPassword}
              onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            />
          </div>
          <Button size="sm" type="submit" disabled={save.isPending || pw.newPassword.length < 8}>
            Update password
          </Button>
        </form>
      </div>
    </PageShell>
  );
}
