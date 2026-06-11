import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getAdminSettings, updateAdminSettings } from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettings,
});

function AdminSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["adminSettings"], queryFn: () => getAdminSettings() });
  const [form, setForm] = useState({
    defaultCommissionPct: 8,
    withdrawalFeeUsdt: 1,
    minWithdrawalUsdt: 10,
    autoConfirmHours: 48,
    paymentWindowMinutes: 30,
    maintenanceMode: false,
    announcement: "",
  });

  useEffect(() => {
    if (data?.settings) {
      const s = data.settings;
      setForm({
        defaultCommissionPct: s.default_commission_pct as number,
        withdrawalFeeUsdt: (s.withdrawal_fee_cents as number) / 100,
        minWithdrawalUsdt: (s.min_withdrawal_cents as number) / 100,
        autoConfirmHours: s.auto_confirm_hours as number,
        paymentWindowMinutes: s.payment_window_minutes as number,
        maintenanceMode: !!s.maintenance_mode,
        announcement: (s.announcement as string) ?? "",
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => updateAdminSettings({ data: form }),
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fields: Array<{ key: keyof typeof form; label: string; hint: string }> = [
    {
      key: "defaultCommissionPct",
      label: "Default commission %",
      hint: "Used when a category has no override",
    },
    { key: "withdrawalFeeUsdt", label: "Withdrawal fee (USDT)", hint: "Flat fee per payout" },
    { key: "minWithdrawalUsdt", label: "Minimum withdrawal (USDT)", hint: "" },
    {
      key: "autoConfirmHours",
      label: "Auto-confirm window (hours)",
      hint: "Delivered → completed if buyer is silent",
    },
    {
      key: "paymentWindowMinutes",
      label: "Payment window (minutes)",
      hint: "Unpaid orders expire after this",
    },
  ];

  return (
    <form
      className="max-w-md space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h1 className="font-display text-2xl">PLATFORM SETTINGS</h1>
      {fields.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label className="text-xs">{f.label}</Label>
          <Input
            type="number"
            step="0.01"
            value={form[f.key] as number}
            onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
          />
          {f.hint && <p className="text-[10px] text-muted-foreground">{f.hint}</p>}
        </div>
      ))}
      <div className="space-y-1.5">
        <Label className="text-xs">Site announcement banner</Label>
        <Input
          value={form.announcement}
          maxLength={300}
          onChange={(e) => setForm({ ...form, announcement: e.target.value })}
          placeholder="e.g. ⚡ Weekend sale — use coupon SAVE10 for 10% off!"
        />
        <p className="text-[10px] text-muted-foreground">
          Shown at the top of every page. Leave empty to hide.
        </p>
      </div>
      <div className="flex items-center justify-between bg-card border border-border rounded-lg p-3">
        <div>
          <p className="text-xs font-bold">Maintenance mode</p>
          <p className="text-[10px] text-muted-foreground">
            Shows a banner; pause before migrations.
          </p>
        </div>
        <Switch
          checked={form.maintenanceMode}
          onCheckedChange={(v) => setForm({ ...form, maintenanceMode: v })}
        />
      </div>
      <Button type="submit" disabled={save.isPending}>
        Save settings
      </Button>
    </form>
  );
}
