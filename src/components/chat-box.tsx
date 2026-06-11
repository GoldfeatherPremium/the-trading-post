import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SendHorizonal, ShieldAlert } from "lucide-react";
import { getMessages, sendMessage } from "@/lib/api/chat";
import { dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

export function ChatBox({
  conversationId,
  className,
}: {
  conversationId: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => getMessages({ data: { conversationId } }),
    refetchInterval: 3000,
  });

  const send = useMutation({
    mutationFn: (text: string) => sendMessage({ data: { conversationId, body: text } }),
    onSuccess: (r) => {
      if (r.flagged)
        toast.warning(
          "Message sent, but flagged by auto-moderation (sharing contacts / off-platform payment is prohibited).",
        );
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages.length]);

  return (
    <div
      className={`flex flex-col bg-card border border-border rounded-lg overflow-hidden ${className ?? ""}`}
    >
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-48 max-h-96">
        {data?.messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            No messages yet. Say hi 👋
          </p>
        )}
        {data?.messages.map((m) =>
          m.is_system ? (
            <div key={m.id} className="text-center">
              <span className="inline-block text-[10px] text-muted-foreground bg-secondary/70 rounded-full px-3 py-1">
                {m.body} · {dateTime(m.created_at)}
              </span>
            </div>
          ) : (
            <div
              key={m.id}
              className={`flex ${m.sender_id === data.myId ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  m.sender_id === data.myId ? "bg-primary text-primary-foreground" : "bg-secondary"
                }`}
              >
                {m.sender_id !== data.myId && (
                  <p className="text-[9px] font-bold opacity-70 mb-0.5">
                    {m.sender_name ?? "staff"}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className="text-[9px] opacity-60 mt-1 flex items-center gap-1">
                  {dateTime(m.created_at)}
                  {!!m.is_flagged && <ShieldAlert className="size-2.5" />}
                </p>
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>
      <form
        className="flex gap-2 p-2 border-t border-border"
        onSubmit={(e) => {
          e.preventDefault();
          const text = body.trim();
          if (!text || send.isPending) return;
          setBody("");
          send.mutate(text);
        }}
      >
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 bg-secondary border border-border rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <Button type="submit" size="sm" disabled={send.isPending}>
          <SendHorizonal className="size-4" />
        </Button>
      </form>
    </div>
  );
}
