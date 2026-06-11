import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getHomeData, browseProducts, listCatalogItems } from "@/lib/api/catalog";
import { PageShell } from "@/components/shell";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { SmartSearch } from "@/components/smart-search";
import { useState, useEffect } from "react";
import { X } from "lucide-react";

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

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({ search: { ...search, page: undefined, ...patch } });

  return (
    <PageShell>
      <h1 className="font-display text-3xl mb-4">
        {search.q
          ? `SEARCH: "${search.q}"`
          : (home?.categories.find((c) => c.slug === search.category)?.name.toUpperCase() ??
            "ALL PRODUCTS")}
      </h1>

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
        <span className="ml-auto text-muted-foreground">{data?.total ?? "…"} results</span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-lg h-56 animate-pulse" />
          ))}
        </div>
      ) : data?.items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No products match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data?.items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}

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
