import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { listDisputes, resolveDispute } from "@/lib/api/admin";
import { aiAssistDispute } from "@/lib/api/ai";
import { GENERIC_STATUS_CLS, dateTime, usdt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/disputes")({
  component: AdminDisputes,
});

function AdminDisputes() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["adminDisputes"],
    queryFn: () => listDisputes(),
    refetchInterval: 15_000,
  });
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [partial, setPartial] = useState("");

  const resolve = useMutation({
    mutationFn: (vars: {
      disputeId: string;
      resolution: "refund_full" | "refund_partial" | "release_seller";
      partialRefundUsdt?: number;
      note: string;
    }) => resolveDispute({ data: vars }),
    onSuccess: () => {
      toast.success("Dispute resolved");
      setResolving(null);
      setNote("");
      setPartial("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl">DISPUTES CENTER</h1>
      {data?.disputes.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">No disputes 🎉</p>
      )}
      {data?.disputes.map((dd) => (
        <div
          key={dd.id as string}
          className="bg-card border border-border rounded-lg p-4 space-y-2"
        >
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Link
              to="/orders/$orderId"
              params={{ orderId: dd.order_id as string }}
              className="font-mono font-bold text-primary"
            >
              {dd.order_no}
            </Link>
            <span className="truncate">{dd.product_title}</span>
            <span
              className={`text-[9px] font-bold px-2 py-0.5 rounded ${GENERIC_STATUS_CLS[dd.status as string] ?? "bg-muted"}`}
            >
              {(dd.status as string).replaceAll("_", " ").toUpperCase()}
            </span>
            <Link
              to="/disputes/$orderId"
              params={{ orderId: dd.order_id as string }}
              className="text-[10px] font-bold text-primary underline"
            >
              Open vault →
            </Link>
            <span className="font-mono text-accent ml-auto">{usdt(dd.total_cents as number)}</span>
          </div>

          <p className="text-[10px] text-muted-foreground">
            buyer {dd.buyer_name} vs seller {dd.seller_name} · opened{" "}
            {dateTime(dd.created_at as number)} · reason:{" "}
            <b className="text-foreground">{(dd.reason as string).replaceAll("_", " ")}</b>
          </p>
          {dd.description && (
            <p className="text-xs bg-secondary/60 rounded-md p-2">
              <b>Buyer:</b> {dd.description}
            </p>
          )}
          {dd.seller_response && (
            <p className="text-xs bg-secondary/60 rounded-md p-2">
              <b>Seller:</b> {dd.seller_response}
            </p>
          )}
          <AiAssist orderId={dd.order_id as string} onCopy={(reply) => setNote(reply.slice(0, 200))} />
          {dd.status !== "resolved" ? (
            resolving === dd.id ? (
              <div className="flex gap-2 flex-wrap items-center pt-1">
                <Input
                  placeholder="Decision note (mandatory)"
                  className="h-8 text-xs w-56"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={resolve.isPending || note.length < 5}
                  onClick={() =>
                    resolve.mutate({ disputeId: dd.id as string, resolution: "refund_full", note })
                  }
                >
                  Full refund
                </Button>
                <Input
                  placeholder="USDT"
                  type="number"
                  className="h-8 text-xs w-20"
                  value={partial}
                  onChange={(e) => setPartial(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={resolve.isPending || note.length < 5 || !partial}
                  onClick={() =>
                    resolve.mutate({
                      disputeId: dd.id as string,
                      resolution: "refund_partial",
                      partialRefundUsdt: parseFloat(partial),
                      note,
                    })
                  }
                >
                  Partial refund
                </Button>
                <Button
                  size="sm"
                  disabled={resolve.isPending || note.length < 5}
                  onClick={() =>
                    resolve.mutate({
                      disputeId: dd.id as string,
                      resolution: "release_seller",
                      note,
                    })
                  }
                >
                  Release to seller
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setResolving(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setResolving(dd.id as string);
                  setNote("");
                }}
              >
                Resolve…
              </Button>
            )
          ) : (
            <p className="text-xs text-accent font-bold">
              Resolved: {(dd.resolution as string)?.replaceAll("_", " ")}
              {dd.resolution_cents ? ` · ${usdt(dd.resolution_cents as number)}` : ""} ·{" "}
              {dateTime(dd.resolved_at as number)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
