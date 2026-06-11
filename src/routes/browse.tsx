import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  getHomeData,
  browseProducts,
  listCatalogItems,
  browseFacets,
  quickSearch,
} from "@/lib/api/catalog";
import { PageShell } from "@/components/shell";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { SmartSearch } from "@/components/smart-search";
import { useState, useEffect } from "react";
import { Sparkles, X } from "lucide-react";

const searchSchema = z.object({
  category: z.string().optional(),
  item: z.string().optional(),
  q: z.string().optional(),
  delivery: z.enum(["auto", "manual"]).optional(),
  sort: z.enum(["popular", "price_asc", "price_desc", "newest", "rating"]).optional(),
  inStock: z.boolean().optional(),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  page: z.number().int().min(1).optional(),
});

export const Route = createFileRoute("/browse")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Browse — X-VAULT" }] }),
  component: BrowsePage,
});

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-primary/15 text-primary border border-primary/30 rounded-full pl-2 pr-1 py-0.5">
      {label}
      <button
        onClick={onClear}
        aria-label="Remove filter"
        className="size-3.5 rounded-full hover:bg-primary/20 grid place-items-center"
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}

function BrowsePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/browse" });
  const { data: home } = useQuery({ queryKey: ["home"], queryFn: () => getHomeData() });
  const { data: catalog } = useQuery({
    queryKey: ["catalogItems"],
    queryFn: () => listCatalogItems(),
  });
  const { data, isLoading } = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ["browse", search],
    queryFn: () =>
      browseProducts({
        data: {
          category: search.category,
          item: search.item,
          q: search.q,
          delivery: search.delivery,
          sort: search.sort ?? "popular",
          inStock: search.inStock,
          minPrice: search.minPrice,
          maxPrice: search.maxPrice,
          page: search.page ?? 1,
        },
      }),
  });

  const { data: facets } = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ["browseFacets", search.q, search.category, search.item, search.delivery, search.inStock, search.minPrice, search.maxPrice],
    queryFn: () =>
      browseFacets({
        data: {
          category: search.category,
          item: search.item,
          q: search.q,
          delivery: search.delivery,
          inStock: search.inStock,
          minPrice: search.minPrice,
          maxPrice: search.maxPrice,
        },
      }),
  });

  // Did-you-mean: only fire when a query is set and results are sparse.
  const { data: suggestData } = useQuery({
    queryKey: ["dym", search.q],
    queryFn: () => quickSearch({ data: { q: search.q ?? "" } }),
    enabled: !!search.q && (data?.total ?? 0) < 3,
    staleTime: 60_000,
  });

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({ search: { ...search, page: undefined, ...patch } });

  const [minP, setMinP] = useState(search.minPrice?.toString() ?? "");
  const [maxP, setMaxP] = useState(search.maxPrice?.toString() ?? "");
  useEffect(() => {
    setMinP(search.minPrice?.toString() ?? "");
    setMaxP(search.maxPrice?.toString() ?? "");
  }, [search.minPrice, search.maxPrice]);
  const applyPrice = () => {
    const min = minP ? Number(minP) : undefined;
    const max = maxP ? Number(maxP) : undefined;
    setSearch({
      minPrice: Number.isFinite(min) ? min : undefined,
      maxPrice: Number.isFinite(max) ? max : undefined,
    });
  };
  const hasFilters =
    !!search.q ||
    !!search.category ||
    !!search.item ||
    !!search.delivery ||
    !!search.inStock ||
    search.minPrice !== undefined ||
    search.maxPrice !== undefined;
  const activeItemName = catalog?.items.find((i) => i.id === search.item)?.name;

  return (
    <PageShell>
      <h1 className="font-display text-3xl mb-3">
        {search.q
          ? `SEARCH: "${search.q}"`
          : (home?.categories.find((c) => c.slug === search.category)?.name.toUpperCase() ??
            "ALL PRODUCTS")}
      </h1>

      <div className="mb-4">
        <SmartSearch variant="hero" />
      </div>

      {/* category pills */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3">
        <button
          onClick={() => setSearch({ category: undefined })}
          className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold ${!search.category ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-border"}`}
        >
          All
        </button>
        {home?.categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setSearch({ category: c.slug })}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold ${search.category === c.slug ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-border"}`}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 py-3 border-y border-border mb-4 text-xs">
        <select
          value={search.item ?? ""}
          onChange={(e) => setSearch({ item: e.target.value || undefined })}
          className="bg-secondary border border-border rounded-md px-2 py-1.5"
        >
          <option value="">All items</option>
          {catalog?.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <select
          value={search.sort ?? "popular"}
          onChange={(e) => setSearch({ sort: e.target.value as never })}
          className="bg-secondary border border-border rounded-md px-2 py-1.5"
        >
          <option value="popular">Most popular</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low → high</option>
          <option value="price_desc">Price: high → low</option>
          <option value="rating">Seller rating</option>
        </select>
        <select
          value={search.delivery ?? ""}
          onChange={(e) => setSearch({ delivery: (e.target.value || undefined) as never })}
          className="bg-secondary border border-border rounded-md px-2 py-1.5"
        >
          <option value="">Any delivery</option>
          <option value="auto">⚡ Instant only</option>
          <option value="manual">🕐 Manual</option>
        </select>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={!!search.inStock}
            onChange={(e) => setSearch({ inStock: e.target.checked || undefined })}
          />
          In stock
        </label>
        <div className="flex items-center gap-1 bg-secondary border border-border rounded-md px-2 py-1">
          <span className="text-muted-foreground text-[10px]">$</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="min"
            value={minP}
            onChange={(e) => setMinP(e.target.value)}
            onBlur={applyPrice}
            onKeyDown={(e) => e.key === "Enter" && applyPrice()}
            className="w-14 bg-transparent focus:outline-none text-xs"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="max"
            value={maxP}
            onChange={(e) => setMaxP(e.target.value)}
            onBlur={applyPrice}
            onKeyDown={(e) => e.key === "Enter" && applyPrice()}
            className="w-14 bg-transparent focus:outline-none text-xs"
          />
        </div>
        {hasFilters && (
          <button
            onClick={() =>
              navigate({
                search: {
                  category: undefined,
                  item: undefined,
                  q: undefined,
                  delivery: undefined,
                  sort: undefined,
                  inStock: undefined,
                  minPrice: undefined,
                  maxPrice: undefined,
                  page: undefined,
                },
              })
            }
            className="text-[10px] font-bold text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="size-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-muted-foreground">{data?.total ?? "…"} results</span>
      </div>

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {search.q && (
            <FilterChip label={`"${search.q}"`} onClear={() => setSearch({ q: undefined })} />
          )}
          {search.category && (
            <FilterChip
              label={
                home?.categories.find((c) => c.slug === search.category)?.name ?? search.category
              }
              onClear={() => setSearch({ category: undefined })}
            />
          )}
          {activeItemName && (
            <FilterChip label={activeItemName} onClear={() => setSearch({ item: undefined })} />
          )}
          {search.delivery && (
            <FilterChip
              label={search.delivery === "auto" ? "⚡ Instant" : "🕐 Manual"}
              onClear={() => setSearch({ delivery: undefined })}
            />
          )}
          {(search.minPrice !== undefined || search.maxPrice !== undefined) && (
            <FilterChip
              label={`$${search.minPrice ?? 0} – $${search.maxPrice ?? "∞"}`}
              onClear={() => setSearch({ minPrice: undefined, maxPrice: undefined })}
            />
          )}
          {search.inStock && (
            <FilterChip label="In stock" onClear={() => setSearch({ inStock: undefined })} />
          )}
        </div>
      )}

      {search.q && suggestData?.suggestion && (
        <div className="mb-4 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs flex items-center gap-2">
          <Sparkles className="size-3.5 text-primary" />
          <span className="text-muted-foreground">Did you mean</span>
          <button
            onClick={() => setSearch({ q: suggestData.suggestion! })}
            className="font-bold text-primary underline underline-offset-2"
          >
            {suggestData.suggestion}
          </button>
          ?
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5">
        {/* Facet rail */}
        <aside className="hidden lg:block space-y-5 sticky top-20 self-start">
          {facets?.categories && facets.categories.length > 1 && (
            <FacetGroup title="Category">
              {facets.categories.map((c) => (
                <FacetButton
                  key={c.slug}
                  active={search.category === c.slug}
                  onClick={() =>
                    setSearch({ category: search.category === c.slug ? undefined : c.slug })
                  }
                  label={`${c.icon} ${c.name}`}
                  count={c.c}
                />
              ))}
            </FacetGroup>
          )}
          {facets?.delivery && facets.delivery.length > 1 && (
            <FacetGroup title="Delivery">
              {facets.delivery.map((d) => (
                <FacetButton
                  key={d.delivery_type}
                  active={search.delivery === d.delivery_type}
                  onClick={() =>
                    setSearch({
                      delivery:
                        search.delivery === d.delivery_type
                          ? undefined
                          : (d.delivery_type as "auto" | "manual"),
                    })
                  }
                  label={d.delivery_type === "auto" ? "⚡ Instant" : "🕐 Manual"}
                  count={d.c}
                />
              ))}
            </FacetGroup>
          )}
          {facets?.tiers && facets.tiers.filter((t) => t.verification_tier !== "unverified").length > 0 && (
            <FacetGroup title="Seller tier">
              {facets.tiers.map((t) => (
                <div
                  key={t.verification_tier}
                  className="flex items-center justify-between text-[11px] py-0.5"
                >
                  <span className="capitalize text-muted-foreground">{t.verification_tier}</span>
                  <span className="font-mono text-muted-foreground">{t.c}</span>
                </div>
              ))}
            </FacetGroup>
          )}
          {facets?.items && facets.items.length > 0 && (
            <FacetGroup title="Game / Item">
              {facets.items.slice(0, 12).map((it) => (
                <FacetButton
                  key={it.id}
                  active={search.item === it.id}
                  onClick={() =>
                    setSearch({ item: search.item === it.id ? undefined : it.id })
                  }
                  label={it.name}
                  count={it.c}
                />
              ))}
            </FacetGroup>
          )}
        </aside>

        <div>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-lg h-56 animate-pulse" />
              ))}
            </div>
          ) : data?.items.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No products match your filters.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
              {data?.items.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </div>

      {data && data.pageCount > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          <Button
            variant="secondary"
            size="sm"
            disabled={(search.page ?? 1) <= 1}
            onClick={() => navigate({ search: { ...search, page: (search.page ?? 1) - 1 } })}
          >
            Previous
          </Button>
          <span className="text-xs self-center text-muted-foreground">
            Page {data.page} / {data.pageCount}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={data.page >= data.pageCount}
            onClick={() => navigate({ search: { ...search, page: (search.page ?? 1) + 1 } })}
          >
            Next
          </Button>
        </div>
      )}
    </PageShell>
  );
}

