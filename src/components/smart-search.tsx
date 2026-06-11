import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Clock,
  TrendingUp,
  Tag,
  Store,
  Zap,
  Package,
  X,
  CornerDownLeft,
  Command as CmdIcon,
  Sparkles,
} from "lucide-react";
import { quickSearch, getHomeData } from "@/lib/api/catalog";
import { productImage } from "@/lib/images";
import { usdtShort } from "@/lib/format";

const RECENT_KEY = "xv_recent_searches_v1";
const MAX_RECENT = 6;

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function pushRecent(term: string) {
  const t = term.trim();
  if (!t) return;
  const list = [t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(
    0,
    MAX_RECENT,
  );
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}
function clearRecent() {
  localStorage.removeItem(RECENT_KEY);
}

export type SmartSearchVariant = "header" | "hero";

export function SmartSearch({
  variant = "header",
  autoFocus = false,
}: {
  variant?: SmartSearchVariant;
  autoFocus?: boolean;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setRecent(readRecent()), [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Cmd/Ctrl+K to focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const { data: home } = useQuery({ queryKey: ["home"], queryFn: () => getHomeData() });
  const { data: results, isFetching } = useQuery({
    queryKey: ["quickSearch", debounced],
    queryFn: () => quickSearch({ data: { q: debounced } }),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const showResults = debounced.length >= 2;
  const flatItems = useMemo(() => {
    if (!showResults) return [];
    const list: Array<{ kind: string; key: string; action: () => void; label: string }> = [];
    results?.products.forEach((p) =>
      list.push({
        kind: "product",
        key: `p-${p.id}`,
        label: p.title,
        action: () => navigate({ to: "/p/$slug", params: { slug: p.slug } }),
      }),
    );
    results?.categories.forEach((c) =>
      list.push({
        kind: "category",
        key: `c-${c.id}`,
        label: c.name,
        action: () => navigate({ to: "/browse", search: { category: c.slug } }),
      }),
    );
    results?.items.forEach((i) =>
      list.push({
        kind: "item",
        key: `i-${i.id}`,
        label: i.name,
        action: () => navigate({ to: "/browse", search: { item: i.id } }),
      }),
    );
    results?.sellers.forEach((s) =>
      list.push({
        kind: "seller",
        key: `s-${s.id}`,
        label: s.username,
        action: () => navigate({ to: "/s/$username", params: { username: s.username } }),
      }),
    );
    return list;
  }, [results, showResults, navigate]);

  useEffect(() => setActiveIdx(0), [debounced]);

  const submit = (term?: string) => {
    const value = (term ?? q).trim();
    if (!value) return;
    pushRecent(value);
    setOpen(false);
    setQ("");
    navigate({ to: "/browse", search: { q: value } });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && flatItems.length) {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % flatItems.length);
    } else if (e.key === "ArrowUp" && flatItems.length) {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showResults && flatItems[activeIdx]) {
        pushRecent(q.trim());
        setOpen(false);
        setQ("");
        flatItems[activeIdx].action();
      } else {
        submit();
      }
    }
  };

  const isHero = variant === "hero";

  return (
    <div ref={rootRef} className={`relative ${isHero ? "w-full" : "w-full max-w-md"}`}>
      <div
        className={`flex items-center gap-2 rounded-xl border transition-all ${
          isHero
            ? "bg-card/80 backdrop-blur border-border px-4 py-3 shadow-lg shadow-primary/5 focus-within:border-primary/60 focus-within:shadow-primary/20"
            : "bg-secondary/60 border-border px-3 py-2 focus-within:border-primary/50"
        }`}
      >
        <Search
          className={`shrink-0 text-muted-foreground ${isHero ? "size-5" : "size-4"}`}
        />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={
            isHero
              ? "Search for game currency, gift cards, accounts, sellers…"
              : "Search products, games, sellers…"
          }
          className={`flex-1 bg-transparent focus:outline-none placeholder:text-muted-foreground ${
            isHero ? "text-base" : "text-sm"
          }`}
        />
        {q && (
          <button
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
        {!isHero && (
          <kbd className="hidden lg:flex items-center gap-0.5 text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            <CmdIcon className="size-2.5" />K
          </kbd>
        )}
        {isHero && (
          <button
            onClick={() => submit()}
            className="bg-primary text-primary-foreground text-xs font-bold tracking-widest px-4 py-2 rounded-lg hover:bg-primary/90"
          >
            SEARCH
          </button>
        )}
      </div>

      {open && (
        <div
          className={`absolute left-0 right-0 top-full mt-2 z-50 bg-popover border border-border rounded-xl shadow-2xl shadow-black/40 overflow-hidden ${
            isHero ? "max-h-[70vh]" : "max-h-[75vh]"
          } overflow-y-auto`}
        >
          {!showResults && (
            <div className="p-3 space-y-4">
              {recent.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-[10px] font-bold text-muted-foreground tracking-widest flex items-center gap-1.5">
                      <Clock className="size-3" /> RECENT
                    </span>
                    <button
                      onClick={() => {
                        clearRecent();
                        setRecent([]);
                      }}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {recent.map((r) => (
                      <button
                        key={r}
                        onClick={() => submit(r)}
                        className="text-xs px-2.5 py-1 rounded-full bg-secondary hover:bg-border"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="px-1 mb-2 text-[10px] font-bold text-muted-foreground tracking-widest flex items-center gap-1.5">
                  <Sparkles className="size-3" /> BROWSE CATEGORIES
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {home?.categories.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setOpen(false);
                        navigate({ to: "/browse", search: { category: c.slug } });
                      }}
                      className="text-xs px-2.5 py-1 rounded-full bg-secondary hover:bg-border flex items-center gap-1"
                    >
                      <span>{c.icon}</span> {c.name}
                    </button>
                  ))}
                </div>
              </div>
              {home?.trending && home.trending.length > 0 && (
                <div>
                  <div className="px-1 mb-2 text-[10px] font-bold text-muted-foreground tracking-widest flex items-center gap-1.5">
                    <TrendingUp className="size-3" /> TRENDING
                  </div>
                  <div className="space-y-1">
                    {home.trending.slice(0, 4).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setOpen(false);
                          navigate({ to: "/p/$slug", params: { slug: p.slug } });
                        }}
                        className="w-full flex items-center gap-2 p-1.5 rounded-md hover:bg-secondary text-left"
                      >
                        <div className="size-8 rounded bg-secondary overflow-hidden shrink-0">
                          <img
                            src={productImage(p.image_key)}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <span className="text-xs truncate flex-1">{p.title}</span>
                        <span className="font-mono text-accent text-xs">
                          {usdtShort(p.price_cents)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {showResults && (
            <div className="p-2">
              {isFetching && !results && (
                <div className="p-4 text-center text-xs text-muted-foreground">Searching…</div>
              )}
              {results && flatItems.length === 0 && !isFetching && (
                <div className="p-4 text-center text-xs text-muted-foreground space-y-2">
                  <p>No matches for "{debounced}"</p>
                  <button
                    onClick={() => submit()}
                    className="text-primary font-bold text-xs"
                  >
                    Search all listings →
                  </button>
                </div>
              )}

              {results?.products && results.products.length > 0 && (
                <Section icon={<Package className="size-3" />} label="PRODUCTS">
                  {results.products.map((p, i) => {
                    const idx = flatItems.findIndex((f) => f.key === `p-${p.id}`);
                    return (
                      <ResultRow
                        key={p.id}
                        active={idx === activeIdx}
                        onClick={() => {
                          pushRecent(q);
                          setOpen(false);
                          setQ("");
                          navigate({ to: "/p/$slug", params: { slug: p.slug } });
                        }}
                      >
                        <div className="size-9 rounded bg-secondary overflow-hidden shrink-0">
                          <img
                            src={productImage(p.image_key)}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate">{p.title}</p>
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            {p.delivery_type === "auto" && (
                              <Zap className="size-2.5 text-accent" />
                            )}
                            {p.category_name}
                          </p>
                        </div>
                        <span className="font-mono text-accent text-xs">
                          {usdtShort(p.price_cents)}
                        </span>
                      </ResultRow>
                    );
                  })}
                </Section>
              )}

              {results?.categories && results.categories.length > 0 && (
                <Section icon={<Tag className="size-3" />} label="CATEGORIES">
                  {results.categories.map((c) => {
                    const idx = flatItems.findIndex((f) => f.key === `c-${c.id}`);
                    return (
                      <ResultRow
                        key={c.id}
                        active={idx === activeIdx}
                        onClick={() => {
                          setOpen(false);
                          setQ("");
                          navigate({ to: "/browse", search: { category: c.slug } });
                        }}
                      >
                        <span className="text-base w-9 text-center">{c.icon}</span>
                        <span className="text-xs flex-1">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground">Category</span>
                      </ResultRow>
                    );
                  })}
                </Section>
              )}

              {results?.items && results.items.length > 0 && (
                <Section icon={<Sparkles className="size-3" />} label="GAMES & ITEMS">
                  {results.items.map((it) => {
                    const idx = flatItems.findIndex((f) => f.key === `i-${it.id}`);
                    return (
                      <ResultRow
                        key={it.id}
                        active={idx === activeIdx}
                        onClick={() => {
                          setOpen(false);
                          setQ("");
                          navigate({ to: "/browse", search: { item: it.id } });
                        }}
                      >
                        <span className="w-9 text-center text-muted-foreground">
                          <Sparkles className="size-4 mx-auto" />
                        </span>
                        <span className="text-xs flex-1">{it.name}</span>
                      </ResultRow>
                    );
                  })}
                </Section>
              )}

              {results?.sellers && results.sellers.length > 0 && (
                <Section icon={<Store className="size-3" />} label="SELLERS">
                  {results.sellers.map((s) => {
                    const idx = flatItems.findIndex((f) => f.key === `s-${s.id}`);
                    return (
                      <ResultRow
                        key={s.id}
                        active={idx === activeIdx}
                        onClick={() => {
                          setOpen(false);
                          setQ("");
                          navigate({ to: "/s/$username", params: { username: s.username } });
                        }}
                      >
                        <div className="size-9 rounded-full bg-primary/20 border border-primary/40 grid place-items-center text-[10px] font-bold text-primary uppercase">
                          {s.username.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate">{s.username}</p>
                          <p className="text-[10px] text-muted-foreground">
                            ⭐ {s.rating > 0 ? s.rating.toFixed(1) : "new"} ·{" "}
                            {s.total_sales.toLocaleString()} sales
                          </p>
                        </div>
                      </ResultRow>
                    );
                  })}
                </Section>
              )}

              <button
                onClick={() => submit()}
                className="w-full mt-2 flex items-center justify-center gap-2 text-xs font-bold text-primary py-2.5 border-t border-border hover:bg-secondary"
              >
                See all results for "{debounced}"
                <CornerDownLeft className="size-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <div className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground tracking-widest flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ResultRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`w-full flex items-center gap-2 p-1.5 rounded-md text-left ${
        active ? "bg-secondary" : "hover:bg-secondary/60"
      }`}
    >
      {children}
    </button>
  );
}
