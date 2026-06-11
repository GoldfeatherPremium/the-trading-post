import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listSellerApplications, reviewSellerApplication } from "@/lib/api/admin";
import { GENERIC_STATUS_CLS, dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/sellers")({
  component: AdminSellers,
});

function AdminSellers() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["adminSellerApps"],
    queryFn: () => listSellerApplications(),
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const review = useMutation({
    mutationFn: (vars: { applicationId: string; approve: boolean; note?: string }) =>
      reviewSellerApplication({ data: vars }),
    onSuccess: () => {
      toast.success("Application reviewed");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl">SELLER APPLICATIONS</h1>
      {data?.applications.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">No applications.</p>
      )}
      {data?.applications.map((a) => (
        <div key={a.id as string} className="bg-card border border-border rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-bold">{a.username}</span>
            <span className="text-muted-foreground">{a.email}</span>
            <span
              className={`text-[9px] font-bold px-2 py-0.5 rounded ${GENERIC_STATUS_CLS[a.status as string] ?? "bg-muted"}`}
            >
              {(a.status as string).toUpperCase()}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {dateTime(a.created_at as number)}
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <p>
              <b>Legal name:</b> {a.full_name}
            </p>
            <p>
              <b>Country:</b> {a.country}
            </p>
            <p className="sm:col-span-2">
              <b>Experience:</b> {a.experience}
            </p>
            <p className="sm:col-span-2 font-mono text-[11px]">
              <b className="font-body">Payout:</b> {a.usdt_payout_address} ({a.usdt_network})
            </p>
            {a.admin_note && (
              <p className="sm:col-span-2 text-muted-foreground">
                <b>Staff note:</b> {a.admin_note}
              </p>
            )}
          </div>
          {a.status === "pending" && (
            <div className="flex gap-2 items-center pt-1">
              <Input
                placeholder="Note (required for rejection)"
                className="max-w-xs h-8 text-xs"
                value={notes[a.id as string] ?? ""}
                onChange={(e) => setNotes({ ...notes, [a.id as string]: e.target.value })}
              />
              <Button
                size="sm"
                onClick={() =>
                  review.mutate({
                    applicationId: a.id as string,
                    approve: true,
                    note: notes[a.id as string] || undefined,
                  })
                }
                disabled={review.isPending}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  const note = notes[a.id as string];
                  if (!note) return toast.error("Add a note explaining the rejection.");
                  review.mutate({ applicationId: a.id as string, approve: false, note });
                }}
                disabled={review.isPending}
              >
                Reject
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
