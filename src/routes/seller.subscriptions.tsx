import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Repeat, Plus, RefreshCw, X } from "lucide-react";
import {
  sellerAssignSlot,
  sellerCreateSlot,
  sellerListSlots,
  sellerUpdateSlot,
} from "@/lib/api/subscriptions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dateTime } from "@/lib/format";

export const Route = createFileRoute("/seller/subscriptions")({
  head: () => ({ meta: [{ title: "Subscription Slots — X-VAULT" }] }),
  component: SellerSubscriptions,
});

function SellerSubscriptions() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["sellerSlots"],
    queryFn: () => sellerListSlots(),
    refetchInterval: 20_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["sellerSlots"] });

  const [creating, setCreating] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [creds, setCreds] = useState("");

  const createSlot = useMutation({
    mutationFn: () =>
      sellerCreateSlot({
        data: { productId: creating!, label, credentials: creds },
      }),
    onSuccess: () => {
      toast.success("Slot added");
      setCreating(null);
      setLabel("");
      setCreds("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateSlot = useMutation({
    mutationFn: (vars: {
      slotId: string;
      credentials?: string;
      action?: "disable" | "enable" | "reclaim";
    }) => sellerUpdateSlot({ data: vars }),
    onSuccess: () => {
      toast.success("Slot updated");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignSlot = useMutation({
    mutationFn: (vars: { slotId: string; orderId: string }) =>
      sellerAssignSlot({ data: vars }),
    onSuccess: () => {
      toast.success("Buyer assigned");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const products = data?.products ?? [];
  const slots = data?.slots ?? [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl flex items-center gap-2">
        <Repeat className="size-5 text-primary" /> SUBSCRIPTION SLOTS
      </h1>
      <p className="text-[11px] text-muted-foreground">
        Manage shared subscription seats. Each slot stores encrypted access details and is assigned
        to a buyer for one billing cycle at a time.
      </p>

      {products.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No subscription-slot products yet. Set <b>Product kind</b> to{" "}
          <code>subscription_slot</code> on a listing to enable slot management.
        </div>
      )}

      {products.map((p) => {
        const productSlots = slots.filter((s) => s.product_id === p.id);
        return (
          <div key={p.id} className="bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold flex-1 truncate">{p.title}</h2>
              <span className="text-[10px] text-muted-foreground">
                {productSlots.filter((s) => s.status !== "disabled").length}/
                {p.subscription_seats_total} seats · {p.subscription_cycle_days}d cycle
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setCreating(p.id);
                  setLabel(`Slot ${productSlots.length + 1}`);
                  setCreds("");
                }}
              >
                <Plus className="size-3.5" /> Add slot
              </Button>
            </div>

            {creating === p.id && (
              <div className="border border-border rounded-md p-3 space-y-2 bg-background/40">
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Slot label (e.g. Profile 3)"
                  className="h-8 text-xs"
                />
                <Textarea
                  value={creds}
                  onChange={(e) => setCreds(e.target.value)}
                  placeholder="Credentials / access details (stored encrypted)"
                  className="text-xs min-h-[60px]"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => createSlot.mutate()}
                    disabled={createSlot.isPending || creds.length < 2}
                  >
                    Save slot
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCreating(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {productSlots.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No slots yet.</p>
              )}
              {productSlots.map((s) => (
                <SlotRow
                  key={s.id}
                  slot={s}
                  onUpdate={(action) => updateSlot.mutate({ slotId: s.id, action })}
                  onAssign={(orderId) => assignSlot.mutate({ slotId: s.id, orderId })}
                  onRefreshCreds={(c) =>
                    updateSlot.mutate({ slotId: s.id, credentials: c })
                  }
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type SlotPub = {
  id: string;
  product_id: string;
  label: string;
  status: string;
  buyer_id: string | null;
  buyer_username?: string | null;
  order_id: string | null;
  expires_at: number | null;
};

function SlotRow({
  slot,
  onUpdate,
  onAssign,
  onRefreshCreds,
}: {
  slot: SlotPub;
  onUpdate: (a: "disable" | "enable" | "reclaim") => void;
  onAssign: (orderId: string) => void;
  onRefreshCreds: (c: string) => void;
}) {
  const [orderId, setOrderId] = useState("");
  const [newCreds, setNewCreds] = useState("");
  const tone =
    slot.status === "active"
      ? "border-accent/40 bg-accent/5"
      : slot.status === "disabled"
        ? "border-border bg-muted/30 opacity-70"
        : "border-border bg-background/40";
  return (
    <div className={`border rounded-md p-2.5 ${tone} space-y-2`}>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="font-bold">{slot.label}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-secondary uppercase">
          {slot.status}
        </span>
        {slot.buyer_username && (
          <span className="text-[10px] text-muted-foreground">
            held by {slot.buyer_username}
          </span>
        )}
        {slot.expires_at && (
          <span className="text-[10px] text-muted-foreground">
            until {dateTime(slot.expires_at)}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {slot.status !== "disabled" ? (
            <Button size="sm" variant="ghost" onClick={() => onUpdate("disable")}>
              <X className="size-3" /> Disable
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onUpdate("enable")}>
              Re-enable
            </Button>
          )}
          {slot.status === "active" && (
            <Button size="sm" variant="ghost" onClick={() => onUpdate("reclaim")}>
              Reclaim
            </Button>
          )}
        </div>
      </div>

      {slot.status === "available" && (
        <div className="flex gap-2 items-center">
          <Input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="Paste paid order ID to assign"
            className="h-7 text-[11px] flex-1"
          />
          <Button
            size="sm"
            disabled={!orderId}
            onClick={() => {
              onAssign(orderId);
              setOrderId("");
            }}
          >
            Assign
          </Button>
        </div>
      )}

      <details className="text-[11px]">
        <summary className="cursor-pointer text-muted-foreground">Rotate credentials</summary>
        <div className="mt-2 flex gap-2 items-start">
          <Textarea
            value={newCreds}
            onChange={(e) => setNewCreds(e.target.value)}
            placeholder="New credentials"
            className="text-xs min-h-[50px]"
          />
          <Button
            size="sm"
            disabled={newCreds.length < 2}
            onClick={() => {
              onRefreshCreds(newCreds);
              setNewCreds("");
            }}
          >
            <RefreshCw className="size-3" /> Save
          </Button>
        </div>
      </details>
    </div>
  );
}
