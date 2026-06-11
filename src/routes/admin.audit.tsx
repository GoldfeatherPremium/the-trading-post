import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listAuditLogs } from "@/lib/api/admin";
import { dateTime } from "@/lib/format";

export const Route = createFileRoute("/admin/audit")({
  component: AdminAudit,
});

function AdminAudit() {
  const { data } = useQuery({ queryKey: ["adminAudit"], queryFn: () => listAuditLogs() });

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl">AUDIT LOG</h1>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Every staff and money action is recorded immutably.
      </p>
      <div className="bg-card border border-border rounded-lg p-3 space-y-1">
        {data?.logs.length === 0 && (
          <p className="text-sm text-muted-foreground p-2">No entries.</p>
        )}
        {data?.logs.map((l) => (
          <div
            key={l.id as number}
            className="flex items-center gap-2 text-xs border-b border-border/50 pb-1 last:border-0"
          >
            <span className="text-[10px] text-muted-foreground w-28 shrink-0">
              {dateTime(l.created_at as number)}
            </span>
            <span className="font-bold w-24 shrink-0 truncate">{l.actor_name ?? "system"}</span>
            <span className="text-[10px] font-bold bg-secondary px-1.5 py-0.5 rounded whitespace-nowrap">
              {l.action}
            </span>
            <span className="text-[10px] text-muted-foreground truncate">
              {l.entity ? `${l.entity}:${(l.entity_id as string)?.slice(0, 12)}` : ""}{" "}
              {l.meta ? `· ${l.meta}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
