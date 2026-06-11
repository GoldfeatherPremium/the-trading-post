import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listFlaggedMessages, moderateMessage } from "@/lib/api/admin";
import { dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/moderation")({
  component: AdminModeration,
});

function AdminModeration() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["adminFlagged"], queryFn: () => listFlaggedMessages() });
  const act = useMutation({
    mutationFn: (vars: { messageId: string; action: "dismiss" | "remove" }) =>
      moderateMessage({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminFlagged"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl">FLAGGED MESSAGES</h1>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Auto-moderation flags contact sharing and off-platform payment attempts (fee circumvention /
        scam vectors).
      </p>
      {data?.messages.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">Queue is empty 🎉</p>
      )}
      {data?.messages.map((m) => (
        <div key={m.id as string} className="bg-card border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="font-bold">{m.sender_name ?? "unknown"}</span>
            <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
              {(m.flag_reason as string)?.toUpperCase() ?? "FLAGGED"}
            </span>
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
          {!m.moderated_at && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => act.mutate({ messageId: m.id as string, action: "dismiss" })}
                disabled={act.isPending}
              >
                Dismiss (false positive)
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => act.mutate({ messageId: m.id as string, action: "remove" })}
                disabled={act.isPending}
              >
                Remove message
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
