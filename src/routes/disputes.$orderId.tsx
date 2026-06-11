import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, FileText, MessageSquare, Shield, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addDisputeEvidence,
  getDisputeThread,
  postDisputeMessage,
  staffSetDisputeStatus,
} from "@/lib/api/disputes";
import { GENERIC_STATUS_CLS, dateTime, usdt } from "@/lib/format";
import { useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/disputes/$orderId")({
  head: () => ({ meta: [{ title: "Dispute Vault — X-VAULT" }] }),
  component: DisputeVault,
});

function DisputeVault() {
  const { orderId } = Route.useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { me } = useMe();

  const { data, isLoading, error } = useQuery({
    queryKey: ["disputeThread", orderId],
    queryFn: () => getDisputeThread({ data: { orderId } }),
    enabled: !!me,
    refetchInterval: 15_000,
  });

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["disputeThread", orderId] });

  const [msg, setMsg] = useState("");
  const [internal, setInternal] = useState(false);
  const postMsg = useMutation({
    mutationFn: () =>
      postDisputeMessage({ data: { orderId, body: msg, internal } }),
    onSuccess: () => {
      setMsg("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [evKind, setEvKind] =
    useState<"screenshot" | "log" | "delivery_proof" | "chat_excerpt" | "other">(
      "screenshot",
    );
  const [evTitle, setEvTitle] = useState("");
  const [evBody, setEvBody] = useState("");
  const [evUrl, setEvUrl] = useState("");
  const addEv = useMutation({
    mutationFn: () =>
      addDisputeEvidence({
        data: {
          orderId,
          kind: evKind,
          title: evTitle,
          body: evBody || undefined,
          url: evUrl || undefined,
        },
      }),
    onSuccess: () => {
      setEvTitle("");
      setEvBody("");
      setEvUrl("");
      toast.success("Evidence added to vault");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: (vars: {
      status: "open" | "seller_responded" | "under_review" | "awaiting_buyer";
      priority?: "low" | "normal" | "high" | "urgent";
      claim?: boolean;
    }) => staffSetDisputeStatus({ data: { orderId, ...vars } }),
    onSuccess: () => {
      toast.success("Dispute updated");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!me)
    return (
      <PageShell>
        <p className="py-16 text-center text-sm text-muted-foreground">
          Sign in to view this dispute.
        </p>
      </PageShell>
    );
  if (isLoading || !data)
    return (
      <PageShell>
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      </PageShell>
    );
  if (error)
    return (
      <PageShell>
        <p className="py-16 text-center text-sm text-destructive">{(error as Error).message}</p>
      </PageShell>
    );

  const { dispute: d, evidence, messages, order: o, myRole } = data;

  return (
    <PageShell>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div>
          <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
            DISPUTE VAULT
          </p>
          <h1 className="font-display text-2xl flex items-center gap-2">
            <Shield className="size-5 text-primary" /> {o.order_no}
          </h1>
          <p className="text-[11px] text-muted-foreground truncate max-w-md">
            {o.product_title} · {usdt(o.total_cents)} · escrow {o.escrow_status.replaceAll("_", " ")}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => nav({ to: "/orders/$orderId", params: { orderId } })}
        >
          View order
        </Button>
      </div>

      {!d ? (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No dispute has been opened on this order. Open one from the order page if there's a
          problem.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status strip */}
          <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3 flex-wrap">
            <AlertTriangle className="size-4 text-destructive" />
            <span
              className={`text-[10px] font-bold px-2 py-1 rounded ${GENERIC_STATUS_CLS[d.status] ?? "bg-muted"}`}
            >
              {d.status.replaceAll("_", " ").toUpperCase()}
            </span>
            <span className="text-[10px] font-bold px-2 py-1 rounded bg-secondary">
              PRIORITY · {d.priority.toUpperCase()}
            </span>
            <span className="text-[10px] text-muted-foreground">
              opened {dateTime(d.created_at)} · last activity{" "}
              {dateTime(d.last_activity_at || d.created_at)}
            </span>
            {d.staff_owner && (
              <span className="text-[10px] text-muted-foreground ml-auto">
                owner: staff
              </span>
            )}
            {d.resolution && (
              <span className="text-[10px] font-bold text-accent ml-auto">
                RESOLVED · {d.resolution.replaceAll("_", " ")}
                {d.resolution_cents ? ` (${usdt(d.resolution_cents)})` : ""}
              </span>
            )}
          </div>

          {/* Staff controls */}
          {myRole === "staff" && d.status !== "resolved" && (
            <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold tracking-widest text-muted-foreground">
                STAFF
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setStatus.mutate({ status: "under_review", claim: true })}
              >
                Claim & investigate
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setStatus.mutate({ status: "awaiting_buyer" })}
              >
                Await buyer
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setStatus.mutate({ status: "open", priority: "high" })}
              >
                Flag high
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setStatus.mutate({ status: "open", priority: "urgent" })}
              >
                Urgent
              </Button>
              <Link
                to="/admin/disputes"
                className="ml-auto text-[10px] font-bold text-primary underline"
              >
                Resolution panel →
              </Link>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Evidence vault */}
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <h2 className="text-xs font-bold tracking-widest flex items-center gap-1.5">
                <FileText className="size-4 text-primary" /> EVIDENCE VAULT ({evidence.length})
              </h2>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {evidence.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    No evidence submitted yet.
                  </p>
                )}
                {evidence.map((e) => (
                  <div
                    key={String(e.id)}
                    className="border border-border rounded-md p-2.5 bg-background/40"
                  >
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-bold uppercase">{String(e.kind)}</span>
                      <span>·</span>
                      <span>
                        {String(e.author_role)} {String(e.author_name)}
                      </span>
                      <span className="ml-auto">{dateTime(Number(e.created_at))}</span>
                    </div>
                    <p className="text-xs font-bold mt-1">{String(e.title)}</p>
                    {e.body && (
                      <p className="text-[11px] text-muted-foreground whitespace-pre-wrap mt-1">
                        {String(e.body)}
                      </p>
                    )}
                    {e.url && (
                      <a
                        href={String(e.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-primary underline break-all"
                      >
                        {String(e.url)}
                      </a>
                    )}
                  </div>
                ))}
              </div>

              {d.status !== "resolved" && (
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
                    SUBMIT EVIDENCE
                  </p>
                  <div className="flex gap-2">
                    <select
                      value={evKind}
                      onChange={(e) => setEvKind(e.target.value as typeof evKind)}
                      className="bg-secondary border border-border rounded-md px-2 py-1.5 text-xs"
                    >
                      <option value="screenshot">Screenshot</option>
                      <option value="delivery_proof">Delivery proof</option>
                      <option value="log">Log / receipt</option>
                      <option value="chat_excerpt">Chat excerpt</option>
                      <option value="other">Other</option>
                    </select>
                    <Input
                      value={evTitle}
                      onChange={(e) => setEvTitle(e.target.value)}
                      placeholder="Short title"
                      className="h-8 text-xs flex-1"
                    />
                  </div>
                  <Input
                    value={evUrl}
                    onChange={(e) => setEvUrl(e.target.value)}
                    placeholder="Link (https://…)"
                    className="h-8 text-xs"
                  />
                  <Textarea
                    value={evBody}
                    onChange={(e) => setEvBody(e.target.value)}
                    placeholder="Details, timestamps, what staff should see"
                    className="text-xs min-h-[60px]"
                  />
                  <Button
                    size="sm"
                    onClick={() => addEv.mutate()}
                    disabled={addEv.isPending || evTitle.length < 2}
                  >
                    <Upload className="size-3.5" /> Add to vault
                  </Button>
                </div>
              )}
            </div>

            {/* Thread */}
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <h2 className="text-xs font-bold tracking-widest flex items-center gap-1.5">
                <MessageSquare className="size-4 text-primary" /> CASE THREAD
              </h2>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {messages.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    No messages yet.
                  </p>
                )}
                {messages.map((m) => (
                  <div
                    key={String(m.id)}
                    className={`rounded-md p-2.5 border ${
                      Number(m.is_internal) === 1
                        ? "border-yellow-500/40 bg-yellow-500/5"
                        : String(m.author_role) === "staff"
                          ? "border-primary/40 bg-primary/5"
                          : "border-border bg-background/40"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-bold uppercase">{String(m.author_role)}</span>
                      <span>·</span>
                      <span>{String(m.author_name)}</span>
                      {Number(m.is_internal) === 1 && (
                        <span className="text-yellow-400 font-bold">INTERNAL</span>
                      )}
                      <span className="ml-auto">{dateTime(Number(m.created_at))}</span>
                    </div>
                    <p className="text-xs whitespace-pre-wrap mt-1">{String(m.body)}</p>
                  </div>
                ))}
              </div>
              {d.status !== "resolved" && (
                <div className="border-t border-border pt-3 space-y-2">
                  <Textarea
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    placeholder="Write a case message…"
                    className="text-xs min-h-[60px]"
                  />
                  <div className="flex items-center gap-2">
                    {myRole === "staff" && (
                      <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={internal}
                          onChange={(e) => setInternal(e.target.checked)}
                        />
                        Internal staff note
                      </label>
                    )}
                    <Button
                      size="sm"
                      className="ml-auto"
                      onClick={() => postMsg.mutate()}
                      disabled={postMsg.isPending || msg.length < 2}
                    >
                      Post
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
