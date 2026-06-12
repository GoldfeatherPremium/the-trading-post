import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { listFlaggedMessages, moderateMessage } from "@/lib/api/admin";
import { aiScreenMessage } from "@/lib/api/copilot";
import { dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/moderation")({
  component: AdminModeration,
});

type MsgScreen = {
  verdict: "dismiss" | "warn" | "remove";
  confidence: number;
  categories: string[];
  explanation: string;
};

function AdminModeration() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["adminFlagged"], queryFn: () => listFlaggedMessages() });
  const [screens, setScreens] = useState<Record<string, MsgScreen>>({});
  const [pending, setPending] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: (vars: { messageId: string; action: "dismiss" | "remove" }) =>
      moderateMessage({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminFlagged"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  async function runScreen(messageId: string) {
    setPending(messageId);
    try {
      const out = await aiScreenMessage({ data: { messageId } });
      setScreens((s) => ({ ...s, [messageId]: out as MsgScreen }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  const verdictColor = (v: MsgScreen["verdict"]) =>
    v === "dismiss"
      ? "bg-emerald-500/15 text-emerald-400"
      : v === "remove"
        ? "bg-red-500/15 text-red-400"
        : "bg-yellow-500/15 text-yellow-400";

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl">FLAGGED MESSAGES</h1>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Auto-moderation flags contact sharing and off-platform payment attempts (fee circumvention /
        scam vectors). Use AI screen to triage faster — staff always makes the final call.
      </p>
      {data?.messages.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">Queue is empty 🎉</p>
      )}
      {data?.messages.map((m) => {
        const id = m.id as string;
        const screen = screens[id];
        return (
          <div key={id} className="bg-card border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="font-bold">{m.sender_name ?? "unknown"}</span>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                {(m.flag_reason as string)?.toUpperCase() ?? "FLAGGED"}
              </span>
              {screen && (
                <span
                  className={`text-[9px] font-bold px-2 py-0.5 rounded ${verdictColor(screen.verdict)}`}
                >
                  AI: {screen.verdict.toUpperCase()} · {screen.confidence}%
                </span>
              )}
              {m.moderated_at && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  HANDLED
                </span>
              )}
              <span className="text-[10px] text-muted-foreground ml-auto">
                {dateTime(m.created_at as number)}
              </span>
            </div>
            <p className="text-xs bg-secondary/60 rounded-md p-2 break-words">{m.body}</p>
            {screen && (
              <div className="rounded-md border border-border bg-secondary/30 p-2 space-y-1">
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
                  AI ASSESSMENT
                </p>
                <p className="text-[11px]">{screen.explanation}</p>
                {screen.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {screen.categories.map((c, i) => (
                      <span
                        key={i}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!m.moderated_at && (
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runScreen(id)}
                  disabled={pending === id}
                >
                  <Sparkles className="size-3 mr-1" />
                  {pending === id ? "Screening…" : screen ? "Re-screen" : "AI screen"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => act.mutate({ messageId: id, action: "dismiss" })}
                  disabled={act.isPending}
                >
                  Dismiss (false positive)
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => act.mutate({ messageId: id, action: "remove" })}
                  disabled={act.isPending}
                >
                  Remove message
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
