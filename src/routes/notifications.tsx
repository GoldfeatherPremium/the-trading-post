import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listNotifications, markNotificationsRead } from "@/lib/api/notifications";
import { PageShell } from "@/components/shell";
import { timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications — X-VAULT" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => listNotifications() });
  const markAll = useMutation({
    mutationFn: () => markNotificationsRead({ data: {} }),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-3xl">NOTIFICATIONS</h1>
        <Button variant="secondary" size="sm" onClick={() => markAll.mutate()}>
          Mark all read
        </Button>
      </div>
      <div className="space-y-1.5">
        {data?.notifications.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        )}
        {data?.notifications.map((n) => {
          const inner = (
            <div
              className={`bg-card border rounded-lg p-3 ${n.read_at ? "border-border opacity-60" : "border-primary/40"}`}
            >
              <div className="flex items-center gap-2">
                {!n.read_at && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
                <p className="text-xs font-bold flex-1">{n.title}</p>
                <span className="text-[10px] text-muted-foreground">{timeAgo(n.created_at)}</span>
              </div>
              {n.body && <p className="text-[11px] text-muted-foreground mt-0.5">{n.body}</p>}
            </div>
          );
          return n.link ? (
            <Link key={n.id} to={n.link} className="block">
              {inner}
            </Link>
          ) : (
            <div key={n.id}>{inner}</div>
          );
        })}
      </div>
    </PageShell>
  );
}
