import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { listConversations } from "@/lib/api/chat";
import { PageShell } from "@/components/shell";
import { ChatBox } from "@/components/chat-box";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/chat")({
  validateSearch: z.object({ c: z.string().optional() }),
  head: () => ({ meta: [{ title: "Messages — X-VAULT" }] }),
  component: ChatPage,
});

function ChatPage() {
  const { c } = Route.useSearch();
  const navigate = useNavigate({ from: "/chat" });
  const { data } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConversations(),
    refetchInterval: 5000,
  });

  return (
    <PageShell>
      <h1 className="font-display text-3xl mb-4">MESSAGES</h1>
      <div className="grid md:grid-cols-[320px_1fr] gap-4">
        <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border max-h-[70vh] overflow-y-auto">
          {data?.conversations.length === 0 && (
            <p className="text-xs text-muted-foreground p-6 text-center">No conversations yet.</p>
          )}
          {data?.conversations.map((cv) => {
            const isBuyer = cv.buyer_id === data.myId;
            const other = isBuyer ? cv.seller_name : cv.buyer_name;
            return (
              <button
                key={cv.id as string}
                onClick={() => navigate({ search: { c: cv.id as string } })}
                className={`w-full text-left p-3 hover:bg-secondary/50 ${c === cv.id ? "bg-secondary" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-full bg-primary/20 border border-primary/40 grid place-items-center text-[10px] font-bold text-primary uppercase shrink-0">
                    {(other as string)?.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate flex items-center gap-1.5">
                      {other}
                      {(cv.unread as number) > 0 && (
                        <span className="bg-primary text-primary-foreground text-[8px] rounded-full px-1.5 py-0.5">
                          {cv.unread}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {cv.order_no ? `${cv.order_no} · ` : "pre-sale · "}
                      {(cv.last_body as string) ?? "…"}
                    </p>
                  </div>
                  <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                    {cv.last_message_at ? timeAgo(cv.last_message_at as number) : ""}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div>
          {c ? (
            <div className="space-y-2">
              <ChatBox
                conversationId={c}
                className="h-[70vh] max-h-none [&>div:first-child]:max-h-none"
              />
              {(() => {
                const cv = data?.conversations.find((x) => x.id === c);
                return cv?.order_id ? (
                  <Link
                    to="/orders/$orderId"
                    params={{ orderId: cv.order_id as string }}
                    className="text-primary text-xs font-bold"
                  >
                    View order {cv.order_no} →
                  </Link>
                ) : null;
              })()}
            </div>
          ) : (
            <div className="h-full min-h-64 grid place-items-center text-sm text-muted-foreground bg-card/50 border border-dashed border-border rounded-lg">
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
