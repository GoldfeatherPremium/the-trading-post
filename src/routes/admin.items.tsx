import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { adminListItems, adminSaveItem, reviewItemSuggestion } from "@/lib/api/admin";
import { getHomeData } from "@/lib/api/catalog";
import { dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/items")({
  component: AdminItems,
});

const EMPTY = {
  itemId: undefined as string | undefined,
  name: "",
  isActive: true,
  categoryIds: [] as string[],
};

function AdminItems() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["adminItems"], queryFn: () => adminListItems() });
  const { data: home } = useQuery({ queryKey: ["home"], queryFn: () => getHomeData() });
  const [form, setForm] = useState(EMPTY);

  const done = (msg: string) => {
    toast.success(msg);
    setForm(EMPTY);
    qc.invalidateQueries();
  };
  const save = useMutation({
    mutationFn: () => adminSaveItem({ data: form }),
    onSuccess: () => done("Item saved"),
    onError: (e: Error) => toast.error(e.message),
  });
  const review = useMutation({
    mutationFn: (vars: { suggestionId: string; approve: boolean }) =>
      reviewItemSuggestion({ data: vars }),
    onSuccess: () => done("Suggestion reviewed"),
    onError: (e: Error) => toast.error(e.message),
  });

  const catName = (id: string) => home?.categories.find((c) => c.id === id)?.name ?? "?";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">SELLING ITEMS</h1>
        <p className="text-[11px] text-muted-foreground">
          Games, brands and services sellers can list under (e.g. LinkedIn, PUBG, Netflix). Pick
          which sub-categories each one allows — none selected = all allowed.
        </p>
      </div>

      {/* seller suggestions queue */}
      {(data?.suggestions.length ?? 0) > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-bold tracking-widest text-yellow-400">SELLER REQUESTS</h2>
          {data?.suggestions.map((s) => (
            <div
              key={s.id as string}
              className="bg-card border border-border rounded-lg p-3 flex items-center gap-3 text-xs flex-wrap"
            >
              <span className="font-bold">{s.name}</span>
              <span className="text-[10px] text-muted-foreground">
                by {s.username} · {dateTime(s.created_at as number)}
                {s.note ? ` · "${s.note}"` : ""}
              </span>
              <span
                className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                  s.status === "pending"
                    ? "bg-yellow-500/15 text-yellow-400"
                    : s.status === "approved"
                      ? "bg-accent/15 text-accent"
                      : "bg-destructive/15 text-destructive"
                }`}
              >
                {(s.status as string).toUpperCase()}
              </span>
              {s.status === "pending" && (
                <span className="ml-auto flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 text-[10px]"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ suggestionId: s.id as string, approve: true })}
                  >
                    Approve & add
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-[10px]"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ suggestionId: s.id as string, approve: false })}
                  >
                    Reject
                  </Button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* items list */}
      <div className="space-y-2">
        {data?.items.map((i) => (
          <div
            key={i.id}
            className="bg-card border border-border rounded-lg p-3 flex items-center gap-3 text-xs flex-wrap"
          >
            <span className="font-bold">{i.name}</span>
            {!i.is_active && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-muted">DISABLED</span>
            )}
            <span className="text-[10px] text-muted-foreground flex-1">
              {i.categoryIds.length === 0
                ? "all sub-categories"
                : i.categoryIds.map(catName).join(" · ")}
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[10px]"
              onClick={() =>
                setForm({
                  itemId: i.id,
                  name: i.name,
                  isActive: !!i.is_active,
                  categoryIds: i.categoryIds,
                })
              }
            >
              Edit
            </Button>
          </div>
        ))}
      </div>

      {/* create/edit form */}
      <form
        className="bg-card border border-border rounded-lg p-4 space-y-3 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h2 className="text-xs font-bold tracking-widest">
          {form.itemId ? "EDIT ITEM" : "NEW ITEM"}
        </h2>
        <Input
          required
          placeholder="Name (e.g. LinkedIn)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div>
          <p className="text-[10px] font-bold text-muted-foreground tracking-widest mb-1.5">
            ALLOWED SUB-CATEGORIES (none = all)
          </p>
          <div className="flex flex-wrap gap-2">
            {home?.categories.map((c) => {
              const on = form.categoryIds.includes(c.id);
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() =>
                    setForm({
                      ...form,
                      categoryIds: on
                        ? form.categoryIds.filter((x) => x !== c.id)
                        : [...form.categoryIds, c.id],
                    })
                  }
                  className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                    on ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-border"
                  }`}
                >
                  {c.icon} {c.name}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Active (visible to sellers and buyers)
        </label>
        <div className="flex gap-2">
          <Button size="sm" type="submit" disabled={save.isPending}>
            {form.itemId ? "Save changes" : "Create item"}
          </Button>
          {form.itemId && (
            <Button size="sm" variant="ghost" type="button" onClick={() => setForm(EMPTY)}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
