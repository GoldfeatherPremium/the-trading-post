import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { adminForceOrderAction, adminListOrders, adminEscrowAction } from "@/lib/api/admin";
import { ORDER_STATUS_META, dateTime, usdt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldAlert, ShieldCheck, Clock } from "lucide-react";

const ESCROW_CLS: Record<string, string> = {
  held: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  on_hold: "bg-destructive/15 text-destructive border-destructive/40",
  released: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  refunded: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  none: "bg-muted/30 text-muted-foreground border-border",
};

export const Route = createFileRoute("/admin/orders")({
  component: AdminOrders,
});

function AdminOrders() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [actionFor, setActionFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { data } = useQuery({
    queryKey: ["adminOrders", q, status],
    queryFn: () => adminListOrders({ data: { q: q || undefined, status: status || undefined } }),
  });
  const force = useMutation({
    mutationFn: (vars: {
      orderId: string;
      action: "refund" | "release" | "cancel";
      note: string;
    }) => adminForceOrderAction({ data: vars }),
    onSuccess: () => {
      toast.success("Action applied");
      setActionFor(null);
      setNote("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const escrow = useMutation({
    mutationFn: (vars: {
      orderId: string;
      action: "hold" | "unhold" | "extend";
      hours?: number;
      reason: string;
    }) => adminEscrowAction({ data: vars }),
    onSuccess: () => {
      toast.success("Escrow updated");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl">ALL ORDERS</h1>
      <div className="flex gap-2 flex-wrap">
        <Input
          placeholder="Search order no / product / user…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs h-9"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-secondary border border-border rounded-md px-2 text-xs"
        >
          <option value="">All statuses</option>
          {Object.entries(ORDER_STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        {data?.orders.map((o) => {
          const meta = ORDER_STATUS_META[o.status as string] ?? {
            label: o.status as string,
            cls: "bg-muted",
          };
          return (
            <div
              key={o.id as string}
              className="bg-card border border-border rounded-lg p-3 space-y-2"
            >
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: o.id as string }}
                  className="font-mono font-bold text-primary"
                >
                  {o.order_no}
                </Link>
                <span className="truncate flex-1">{o.product_title}</span>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${meta.cls}`}>
                  {meta.label.toUpperCase()}
                </span>
                {o.escrow_status && o.escrow_status !== "none" && (
                  <span
                    className={`inline-flex items-center gap-1 text-[9px] font-bold border px-1.5 py-0.5 rounded ${
                      ESCROW_CLS[o.escrow_status as string] ?? ESCROW_CLS.none
                    }`}
                    title={(o.escrow_hold_reason as string) ?? "Escrow state"}
                  >
                    {o.escrow_status === "on_hold" ? (
                      <ShieldAlert className="size-2.5" />
                    ) : o.escrow_status === "released" ? (
                      <ShieldCheck className="size-2.5" />
                    ) : (
                      <Clock className="size-2.5" />
                    )}
                    {(o.escrow_status as string).replace("_", " ").toUpperCase()}
                  </span>
                )}
                <span className="font-mono text-accent">{usdt(o.total_cents as number)}</span>
              </div>
              {o.escrow_status === "on_hold" && o.escrow_hold_reason && (
                <p className="text-[10px] text-destructive bg-destructive/5 border border-destructive/20 rounded px-2 py-1">
                  Hold: {o.escrow_hold_reason as string}
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                <span>buyer {o.buyer_name}</span>·<span>seller {o.seller_name}</span>·
                <span>{dateTime(o.created_at as number)}</span>
                <span className="ml-auto flex gap-1">
                  {actionFor === o.id ? (
                    <>
                      <Input
                        placeholder="Mandatory note (audited)"
                        className="h-7 text-[11px] w-52"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      {(["refund", "release", "cancel"] as const).map((act) => (
                        <Button
                          key={act}
                          size="sm"
                          variant={act === "refund" ? "destructive" : "secondary"}
                          className="h-7 text-[10px]"
                          disabled={force.isPending || note.length < 5}
                          onClick={() =>
                            force.mutate({ orderId: o.id as string, action: act, note })
                          }
                        >
                          {act}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[10px]"
                        onClick={() => setActionFor(null)}
                      >
                        ×
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 text-[10px]"
                      onClick={() => {
                        setActionFor(o.id as string);
                        setNote("");
                      }}
                    >
                      Force action
                    </Button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        {data?.orders.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">No orders found.</p>
        )}
      </div>
    </div>
  );
}
