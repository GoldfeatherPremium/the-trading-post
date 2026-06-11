import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { updateProfile } from "@/lib/api/auth";
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

  const save = useMutation({
    mutationFn: (data: Parameters<typeof updateProfile>[0]["data"]) => updateProfile({ data }),
    onSuccess: () => {
      toast.success("Saved");
      setPw({ currentPassword: "", newPassword: "" });
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
