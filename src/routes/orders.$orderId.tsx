import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Star, AlertTriangle, CheckCircle2, PackageCheck } from "lucide-react";
import {
  buyerCancelSlaBreach,
  buyerConfirmReceived,
  getOrder,
  openDispute,
  sellerMarkDelivered,
  sellerRespondDispute,
} from "@/lib/api/orders";
import { leaveReview } from "@/lib/api/reviews";
import { PageShell } from "@/components/shell";
import { ChatBox } from "@/components/chat-box";
import { ORDER_STATUS_META, countdown, dateTime, usdt } from "@/lib/format";
import { productImage } from "@/lib/images";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/orders/$orderId")({
  head: () => ({ meta: [{ title: "Order — X-VAULT" }] }),
  component: OrderPage,
});

const TIMELINE_STEPS = ["awaiting_payment", "paid", "delivered", "completed", "released"];

function OrderPage() {
  const { orderId } = Route.useParams();
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => getOrder({ data: { orderId } }),
    refetchInterval: 5000,
  });

  const onDone = () => {
    qc.invalidateQueries();
    refetch();
  };
  const err = (e: Error) => toast.error(e.message);

  const confirm = useMutation({
    mutationFn: () => buyerConfirmReceived({ data: { orderId } }),
    onSuccess: onDone,
    onError: err,
  });
  const cancelSla = useMutation({
    mutationFn: () => buyerCancelSlaBreach({ data: { orderId } }),
    onSuccess: onDone,
    onError: err,
  });

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("not_delivered");
  const [disputeDesc, setDisputeDesc] = useState("");
  const dispute = useMutation({
    mutationFn: () =>
      openDispute({ data: { orderId, reason: disputeReason as never, description: disputeDesc } }),
    onSuccess: () => {
      setDisputeOpen(false);
      onDone();
    },
    onError: err,
  });

  const [proofNote, setProofNote] = useState("");
  const [manualPayload, setManualPayload] = useState("");
  const deliver = useMutation({
    mutationFn: () =>
      sellerMarkDelivered({ data: { orderId, proofNote, payload: manualPayload || undefined } }),
    onSuccess: onDone,
    onError: err,
  });

  const [disputeResponse, setDisputeResponse] = useState("");
  const respond = useMutation({
    mutationFn: () => sellerRespondDispute({ data: { orderId, response: disputeResponse } }),
    onSuccess: onDone,
    onError: err,
  });

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const review = useMutation({
    mutationFn: () => leaveReview({ data: { orderId, rating, comment: comment || undefined } }),
    onSuccess: onDone,
    onError: err,
  });

  if (!data)
    return (
      <PageShell>
        <div className="py-20 text-center text-muted-foreground">Loading…</div>
      </PageShell>
    );
  const { order: o, deliveries, dispute: disp, review: rev, viewerIsBuyer, viewerIsSeller } = data;
  const meta = ORDER_STATUS_META[o.status] ?? { label: o.status, cls: "bg-muted" };
  const stepIdx = TIMELINE_STEPS.indexOf(o.status === "delivering" ? "paid" : o.status);
  const slaDeadline = (o.paid_at ?? o.created_at) + o.delivery_sla_minutes * 60_000;
  const slaBreached = ["paid", "delivering"].includes(o.status) && Date.now() > slaDeadline;

  return (
    <PageShell>
      <div className="grid lg:grid-cols-[1fr_380px] gap-6">
        <div className="space-y-4">
          {/* header */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="size-14 rounded-md overflow-hidden bg-secondary shrink-0">
                <img
                  src={productImage(o.image_key)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-sm font-bold">{o.product_title}</h1>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${meta.cls}`}>
                    {meta.label.toUpperCase()}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {o.order_no} · qty {o.qty} · {dateTime(o.created_at)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {viewerIsBuyer ? (
                    <>
                      Seller: <b className="text-foreground">{data.sellerName}</b>
                    </>
                  ) : (
                    <>
                      Buyer: <b className="text-foreground">{data.buyerName}</b>
                    </>
                  )}
                </p>
              </div>
              <span className="font-mono text-accent text-lg whitespace-nowrap">
                {usdt(o.total_cents)}
              </span>
            </div>

            {/* timeline */}
            {!["disputed", "refunded", "cancelled", "expired"].includes(o.status) && (
              <div className="flex items-center mt-4">
                {TIMELINE_STEPS.map((s, i) => (
                  <div key={s} className="flex items-center flex-1 last:flex-none">
                    <div
                      className={`size-6 rounded-full grid place-items-center text-[9px] font-bold shrink-0 ${
                        i <= stepIdx
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {i + 1}
                    </div>
                    {i < TIMELINE_STEPS.length - 1 && (
                      <div
                        className={`h-0.5 flex-1 mx-1 ${i < stepIdx ? "bg-primary" : "bg-secondary"}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between text-[8.5px] text-muted-foreground mt-1 font-bold tracking-wide">
              <span>PAYMENT</span>
              <span>PAID</span>
              <span>DELIVERED</span>
              <span>CONFIRMED</span>
              <span>RELEASED</span>
            </div>

            {/* countdowns */}
            <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
              {o.status === "awaiting_payment" && o.expires_at && (
                <span className="bg-yellow-500/15 text-yellow-400 px-2 py-1 rounded font-bold">
                  PAYMENT WINDOW: {countdown(o.expires_at)} ·{" "}
                  <Link to="/pay/$orderId" params={{ orderId }} className="underline">
                    pay now
                  </Link>
                </span>
              )}
              {["paid", "delivering"].includes(o.status) && (
                <span
                  className={`px-2 py-1 rounded font-bold ${slaBreached ? "bg-destructive/15 text-destructive" : "bg-blue-500/15 text-blue-400"}`}
                >
                  DELIVERY SLA: {slaBreached ? "BREACHED" : countdown(slaDeadline)}
                </span>
              )}
              {o.status === "delivered" && o.auto_confirm_at && (
                <span className="bg-blue-500/15 text-blue-400 px-2 py-1 rounded font-bold">
                  AUTO-CONFIRM IN {countdown(o.auto_confirm_at)}
                </span>
              )}
              {o.status === "completed" && o.warranty_ends_at && (
                <span className="bg-accent/15 text-accent px-2 py-1 rounded font-bold">
                  WARRANTY: {countdown(o.warranty_ends_at)} REMAINING
                </span>
              )}
              {o.escrow_status === "on_hold" && (
                <span className="bg-destructive/15 text-destructive px-2 py-1 rounded font-bold">
                  ESCROW ON HOLD
                </span>
              )}
            </div>
          </div>

          {o.escrow_status === "on_hold" && o.escrow_hold_reason && (
            <div className="bg-destructive/5 border border-destructive/30 rounded-lg p-3 text-xs">
              <p className="font-bold text-destructive mb-0.5">Escrow on administrative hold</p>
              <p className="text-muted-foreground">{o.escrow_hold_reason}</p>
            </div>
          )}

          {/* buyer info for seller */}
          {viewerIsSeller && o.buyer_info && (
            <div className="bg-card border border-blue-500/30 rounded-lg p-4">
              <h2 className="text-xs font-bold tracking-widest text-blue-400 mb-1">
                BUYER DELIVERY INFO
              </h2>
              <p className="text-xs whitespace-pre-wrap">{o.buyer_info}</p>
            </div>
          )}

          {/* deliveries */}
          {deliveries.map((del) => (
            <div key={del.id} className="bg-card border border-accent/30 rounded-lg p-4 space-y-2">
              <h2 className="text-xs font-bold tracking-widest text-accent flex items-center gap-1.5">
                <PackageCheck className="size-4" />{" "}
                {del.type === "auto" ? "DELIVERED CODES" : "DELIVERY PROOF"} ·{" "}
                {dateTime(del.created_at)}
              </h2>
              {del.note && <p className="text-xs text-muted-foreground">{del.note}</p>}
              {del.payload &&
                del.payload.split("\n").map((code, i) => (
                  <button
                    key={i}
                    className="w-full bg-secondary rounded-md px-3 py-2 text-left font-mono text-xs flex items-center justify-between gap-2 hover:bg-border group"
                    onClick={() => {
                      navigator.clipboard.writeText(code);
                      toast.success("Code copied");
                    }}
                  >
                    <span className="break-all">{code}</span>
                    <Copy className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  </button>
                ))}
            </div>
          ))}

          {/* dispute panel */}
          {disp && (
            <div className="bg-card border border-destructive/40 rounded-lg p-4 space-y-2">
              <h2 className="text-xs font-bold tracking-widest text-destructive flex items-center gap-1.5">
                <AlertTriangle className="size-4" /> DISPUTE ·{" "}
                {disp.status.replaceAll("_", " ").toUpperCase()}
                <Link
                  to="/disputes/$orderId"
                  params={{ orderId }}
                  className="ml-auto text-[10px] font-bold text-primary underline"
                >
                  Open evidence vault →
                </Link>
              </h2>

              <p className="text-xs">
                <b>Reason:</b> {disp.reason.replaceAll("_", " ")}
              </p>
              {disp.description && (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {disp.description}
                </p>
              )}
              {disp.seller_response && (
                <p className="text-xs bg-secondary rounded-md p-2">
                  <b>Seller response:</b> {disp.seller_response}
                </p>
              )}
              {disp.resolution && (
                <p className="text-xs text-accent font-bold">
                  Resolved: {disp.resolution.replaceAll("_", " ")}
                  {disp.resolution_cents ? ` (${usdt(disp.resolution_cents)})` : ""}
                </p>
              )}
              {viewerIsSeller && disp.status === "open" && (
                <div className="space-y-2 pt-1">
                  <Textarea
                    value={disputeResponse}
                    onChange={(e) => setDisputeResponse(e.target.value)}
                    placeholder="Respond with your evidence (delivery proof, timestamps…)"
                    className="text-xs"
                  />
                  <Button
                    size="sm"
                    onClick={() => respond.mutate()}
                    disabled={respond.isPending || disputeResponse.length < 10}
                  >
                    Submit response
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* actions */}
          <div className="flex flex-wrap gap-2">
            {viewerIsBuyer && o.status === "delivered" && (
              <Button
                onClick={() => confirm.mutate()}
                disabled={confirm.isPending}
                className="font-bold"
              >
                <CheckCircle2 className="size-4" /> Confirm received
              </Button>
            )}
            {viewerIsBuyer && slaBreached && (
              <Button
                variant="destructive"
                onClick={() => cancelSla.mutate()}
                disabled={cancelSla.isPending}
              >
                Cancel — SLA breached (full refund)
              </Button>
            )}
            {viewerIsBuyer &&
              ["delivered", "completed", "delivering", "paid"].includes(o.status) &&
              !disp && (
                <Button variant="secondary" onClick={() => setDisputeOpen(!disputeOpen)}>
                  <AlertTriangle className="size-4" /> Report a problem
                </Button>
              )}
          </div>

          {disputeOpen && !disp && (
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <h2 className="text-xs font-bold tracking-widest">OPEN A DISPUTE</h2>
              <select
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                className="w-full bg-secondary border border-border rounded-md px-2 py-2 text-xs"
              >
                <option value="not_delivered">Not delivered</option>
                <option value="invalid_code">Code invalid / already used</option>
                <option value="not_as_described">Not as described</option>
                <option value="stopped_working">Stopped working</option>
                <option value="other">Other</option>
              </select>
              <Textarea
                value={disputeDesc}
                onChange={(e) => setDisputeDesc(e.target.value)}
                placeholder="Describe the problem in detail (min. 10 characters). Escrow freezes while staff review."
                className="text-xs"
              />
              <Button
                variant="destructive"
                size="sm"
                onClick={() => dispute.mutate()}
                disabled={dispute.isPending || disputeDesc.length < 10}
              >
                Open dispute
              </Button>
            </div>
          )}

          {/* review */}
          {viewerIsBuyer && ["completed", "released"].includes(o.status) && !rev && (
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <h2 className="text-xs font-bold tracking-widest">RATE THIS ORDER</h2>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setRating(n)}>
                    <Star
                      className={`size-6 ${n <= rating ? "text-yellow-400 fill-current" : "text-muted-foreground"}`}
                    />
                  </button>
                ))}
              </div>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Optional comment…"
                className="text-xs"
              />
              <Button size="sm" onClick={() => review.mutate()} disabled={review.isPending}>
                Submit review
              </Button>
            </div>
          )}
          {rev && (
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-xs font-bold tracking-widest mb-1">YOUR REVIEW</h2>
              <span className="text-yellow-400 flex gap-0.5">
                {Array.from({ length: rev.rating }).map((_, i) => (
                  <Star key={i} className="size-3.5 fill-current" />
                ))}
              </span>
              {rev.comment && <p className="text-xs mt-1">{rev.comment}</p>}
            </div>
          )}

          {/* seller deliver form */}
          {viewerIsSeller && ["paid", "delivering"].includes(o.status) && (
            <div className="bg-card border border-blue-500/30 rounded-lg p-4 space-y-3">
              <h2 className="text-xs font-bold tracking-widest text-blue-400">MARK AS DELIVERED</h2>
              <Textarea
                value={proofNote}
                onChange={(e) => setProofNote(e.target.value)}
                placeholder="Delivery proof note — what/how you delivered (visible to buyer & staff)…"
                className="text-xs"
              />
              <Textarea
                value={manualPayload}
                onChange={(e) => setManualPayload(e.target.value)}
                placeholder="Optional: codes / credentials to hand over (revealed to buyer)…"
                className="text-xs"
              />
              <Button
                size="sm"
                onClick={() => deliver.mutate()}
                disabled={deliver.isPending || proofNote.length < 5}
              >
                Mark delivered
              </Button>
            </div>
          )}
        </div>

        {/* order chat */}
        <div className="space-y-2 lg:sticky lg:top-20 self-start">
          <h2 className="text-xs font-bold tracking-widest text-muted-foreground">ORDER CHAT</h2>
          <ChatBox conversationId={data.conversationId} />
          <p className="text-[10px] text-muted-foreground">
            Keep all communication here — it's the evidence staff use in disputes. Sharing contacts
            or paying off-platform is prohibited.
          </p>
        </div>
      </div>
    </PageShell>
  );
}
