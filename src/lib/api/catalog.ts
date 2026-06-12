import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { buildSearchClause, didYouMean, tokenize } from "../server/search.server";

export interface PublicSeller {
  id: string;
  username: string;
  seller_level: number;
  rating: number;
  rating_count: number;
  total_sales: number;
  completion_rate: number;
  vacation_mode: number;
  created_at: number;
  verification_tier: "unverified" | "verified" | "business" | "premium";
  trust_score: number;
  refund_count: number;
  dispute_count: number;
}

export interface StoreProfile extends PublicSeller {
  store_banner_url: string | null;
  store_logo_url: string | null;
  store_description: string | null;
  store_socials: Record<string, string>;
  store_announcement: string | null;
  avg_response_minutes: number;
  avg_delivery_minutes: number;
  refund_count: number;
  dispute_count: number;
}

export interface PublicProduct {
  id: string;
  title: string;
  slug: string;
  description: string;
  image_key: string | null;
  delivery_type: "auto" | "manual";
  delivery_sla_minutes: number;
  warranty_hours: number;
  price_cents: number;
  min_qty: number;
  max_qty: number;
  stock_count: number;
  region: string | null;
  platform: string | null;
  required_info: string | null;
  sold_count: number;
  views: number;
  status: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  risk_tier: string;
  item_id: string | null;
  item_name: string | null;
  insurance_days: number;
  expires_at: number | null;
  seller: PublicSeller;
}

const productSelect = `
  select p.id, p.title, p.slug, p.description, p.image_key, p.delivery_type, p.delivery_sla_minutes,
         coalesce(p.warranty_hours, c.default_warranty_hours) as warranty_hours,
         p.price_cents, p.min_qty, p.max_qty, p.stock_count, p.region, p.platform, p.required_info,
         p.sold_count, p.views, p.status, p.category_id, c.name as category_name, c.slug as category_slug,
         c.risk_tier,
         u.id as s_id, u.username as s_username, u.seller_level as s_level, u.rating as s_rating,
         u.rating_count as s_rating_count, u.total_sales as s_total_sales,
         u.completion_rate as s_completion, u.vacation_mode as s_vacation, u.created_at as s_created,
         u.verification_tier as s_verification, u.trust_score as s_trust,
         u.refund_count as s_refunds, u.dispute_count as s_disputes,
         p.item_id, ci.name as item_name, p.insurance_days, p.expires_at
  from products p
  join categories c on c.id = p.category_id
  join users u on u.id = p.seller_id
  left join catalog_items ci on ci.id = p.item_id`;

function mapProduct(r: Record<string, unknown>): PublicProduct {
  const {
    s_id,
    s_username,
    s_level,
    s_rating,
    s_rating_count,
    s_total_sales,
    s_completion,
    s_vacation,
    s_created,
    s_verification,
    s_trust,
    s_refunds,
    s_disputes,
    ...rest
  } = r;
  return {
    ...(rest as Omit<PublicProduct, "seller">),
    seller: {
      id: s_id as string,
      username: s_username as string,
      seller_level: s_level as number,
      rating: s_rating as number,
      rating_count: s_rating_count as number,
      total_sales: s_total_sales as number,
      completion_rate: s_completion as number,
      vacation_mode: s_vacation as number,
      created_at: s_created as number,
      verification_tier:
        (s_verification as PublicSeller["verification_tier"] | null) ?? "unverified",
      trust_score: (s_trust as number | null) ?? 0,
      refund_count: (s_refunds as number | null) ?? 0,
      dispute_count: (s_disputes as number | null) ?? 0,
    },
  };
}

export const getHomeData = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const [
    categoryRows,
    trendingRows,
    newestRows,
    topSellers,
    recentSales,
    stats,
    last24h,
    trendingSearches,
  ] = await Promise.all([
    q<{
      id: string;
      name: string;
      slug: string;
      icon: string;
      default_warranty_hours: number;
      commission_pct: number;
      risk_tier: string;
      product_count: number;
    }>(
      `select c.id, c.name, c.slug, c.icon, c.default_warranty_hours, c.commission_pct, c.risk_tier,
              (select count(*) from products p where p.category_id = c.id and p.status = 'active') as product_count
       from categories c where c.is_active = 1 order by c.sort`,
    ),
    q(
      `${productSelect} where p.status = 'active' order by p.sold_count desc, p.views desc limit 8`,
    ),
    q(`${productSelect} where p.status = 'active' order by p.created_at desc limit 8`),
    q<PublicSeller>(
      `select id, username, seller_level, rating, rating_count, total_sales, completion_rate, vacation_mode, created_at,
              verification_tier, trust_score
       from users where seller_status = 'approved' and is_banned = 0 order by trust_score desc, total_sales desc limit 6`,
    ),
    q<{ product_title: string; total_cents: number; created_at: number; buyer: string }>(
      `select o.product_title, o.total_cents, o.created_at, u.username as buyer
       from orders o join users u on u.id = o.buyer_id
       where o.status in ('delivered','completed','released') order by o.created_at desc limit 8`,
    ),
    q1<{ sellers: number; products: number; orders: number; reviews: number }>(
      `select
         (select count(*) from users where seller_status = 'approved' and is_banned = 0) as sellers,
         (select count(*) from products where status = 'active') as products,
         (select count(*) from orders where status in ('delivered','completed','released')) as orders,
         (select count(*) from reviews) as reviews`,
    ),
    q1<{ orders24h: number; gmv24h: number }>(
      `select count(*) as orders24h, coalesce(sum(total_cents),0) as gmv24h from orders
         where status in ('delivered','completed','released') and created_at >= ?`,
      [dayAgo],
    ),
    q<{ query: string; uses: number }>(
      `select query, count(*) as uses from search_queries
         where created_at >= ? and length(query) >= 2 and results > 0
         group by query order by uses desc limit 8`,
      [weekAgo],
    ),
  ]);
  const trending = trendingRows.map(mapProduct);
  const newest = newestRows.map(mapProduct);
  return {
    categories: categoryRows,
    trending,
    newest,
    topSellers,
    recentSales,
    stats: stats ?? { sellers: 0, products: 0, orders: 0, reviews: 0 },
    last24h: last24h ?? { orders24h: 0, gmv24h: 0 },
    trendingSearches,
  };
});

export const browseProducts = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      category: z.string().optional(),
      item: z.string().optional(),
      q: z.string().max(100).optional(),
      delivery: z.enum(["auto", "manual"]).optional(),
      minPrice: z.number().optional(),
      maxPrice: z.number().optional(),
      inStock: z.boolean().optional(),
      sort: z.enum(["popular", "price_asc", "price_desc", "newest", "rating"]).default("popular"),
      page: z.number().int().min(1).default(1),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const where: string[] = [`p.status = 'active'`];
    const params: Array<string | number> = [];
    if (data.category) {
      where.push(`c.slug = ?`);
      params.push(data.category);
    }
    if (data.item) {
      where.push(`p.item_id = ?`);
      params.push(data.item);
    }
    if (data.q) {
      const tokens = tokenize(data.q);
      const cols = ["p.title", "p.description", "coalesce(p.platform,'')", "u.username", "c.name", "coalesce(ci.name,'')"];
      const { sql, params: sp } = buildSearchClause(tokens, cols);
      if (tokens.length > 0) {
        where.push(`(${sql})`);
        params.push(...sp);
      } else {
        const like = `%${data.q.toLowerCase()}%`;
        where.push(`(lower(p.title) like ? or lower(p.description) like ?)`);
        params.push(like, like);
      }
    }
    if (data.delivery) {
      where.push(`p.delivery_type = ?`);
      params.push(data.delivery);
    }
    if (data.minPrice !== undefined) {
      where.push(`p.price_cents >= ?`);
      params.push(Math.round(data.minPrice * 100));
    }
    if (data.maxPrice !== undefined) {
      where.push(`p.price_cents <= ?`);
      params.push(Math.round(data.maxPrice * 100));
    }
    if (data.inStock) {
      where.push(`(p.delivery_type = 'manual' or p.stock_count > 0)`);
    }
    const order = {
      popular: `p.insurance_days desc, p.sold_count desc, p.views desc`,
      price_asc: `p.price_cents asc`,
      price_desc: `p.price_cents desc`,
      newest: `p.created_at desc`,
      rating: `u.rating desc, p.sold_count desc`,
    }[data.sort];
    const PAGE = 24;
    const whereSql = where.join(" and ");
    const [totalRow, itemRows] = await Promise.all([
      q1<{ c: number }>(
        `select count(*) c from products p
           join categories c on c.id = p.category_id
           join users u on u.id = p.seller_id
           left join catalog_items ci on ci.id = p.item_id
         where ${whereSql}`,
        params,
      ),
      q(
        `${productSelect} where ${whereSql} order by ${order} limit ${PAGE} offset ${(data.page - 1) * PAGE}`,
        params,
      ),
    ]);
    const total = totalRow!.c;
    const items = itemRows.map(mapProduct);
    // Log non-empty queries for analytics. Cap query length and best-effort
    // (never block search if logging fails).
    if (data.q && data.q.trim().length >= 2) {
      run(
        `insert into search_queries (query, results, created_at) values (?,?,?)`,
        [data.q.trim().slice(0, 100).toLowerCase(), total, Date.now()],
      ).catch(() => {});
    }
    return { items, total, page: data.page, pageCount: Math.max(1, Math.ceil(total / PAGE)) };
  });

export const getRelatedProducts = createServerFn({ method: "GET" })
  .inputValidator(z.object({ productId: z.string(), limit: z.number().int().min(1).max(12).default(8) }))
  .handler(async ({ data }) => {
    await appContext();
    const seed = await q1<{ category_id: string; item_id: string | null; seller_id: string }>(
      `select category_id, item_id, seller_id from products where id = ?`,
      [data.productId],
    );
    if (!seed) return { items: [] as PublicProduct[] };
    // Prefer same catalog item, then same category. Exclude self & out-of-stock.
    const rows = await q(
      `${productSelect}
       where p.status = 'active' and p.id <> ?
         and (p.item_id = ? or p.category_id = ?)
       order by (case when p.item_id = ? then 0 else 1 end),
                p.sold_count desc, u.rating desc
       limit ?`,
      [data.productId, seed.item_id ?? "", seed.category_id, seed.item_id ?? "", data.limit],
    );
    return { items: rows.map(mapProduct) };
  });

/**
 * Personalized "For You" recommendations. Builds a signal set from the user's
 * favorites + past orders (categories & catalog items they've engaged with)
 * and surfaces highly-rated active listings in those buckets, excluding
 * products they already bought. Falls back to empty when there's no signal —
 * the caller decides whether to hide or show a generic carousel instead.
 */
export const getMyRecommendations = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ limit: z.number().int().min(1).max(24).default(8) }).default({ limit: 8 }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const { currentUser } = await import("../server/auth.server");
    const user = await currentUser();
    if (!user) return { items: [] as PublicProduct[] };
    const signals = await q<{ category_id: string | null; item_id: string | null; product_id: string }>(
      `select p.category_id, p.item_id, p.id as product_id
         from favorites f join products p on p.id = f.product_id where f.user_id = ?
       union all
       select p.category_id, p.item_id, p.id as product_id
         from orders o join products p on p.id = o.product_id where o.buyer_id = ?`,
      [user.id, user.id],
    );
    if (signals.length === 0) return { items: [] as PublicProduct[] };
    const cats = Array.from(new Set(signals.map((s) => s.category_id).filter(Boolean))) as string[];
    const items = Array.from(new Set(signals.map((s) => s.item_id).filter(Boolean))) as string[];
    const owned = Array.from(new Set(signals.map((s) => s.product_id)));
    const where: string[] = [`p.status = 'active'`];
    const params: Array<string | number> = [];
    if (owned.length) {
      where.push(`p.id not in (${owned.map(() => "?").join(",")})`);
      params.push(...owned);
    }
    const orParts: string[] = [];
    if (items.length) {
      orParts.push(`p.item_id in (${items.map(() => "?").join(",")})`);
      params.push(...items);
    }
    if (cats.length) {
      orParts.push(`p.category_id in (${cats.map(() => "?").join(",")})`);
      params.push(...cats);
    }
    if (orParts.length === 0) return { items: [] as PublicProduct[] };
    where.push(`(${orParts.join(" or ")})`);
    // Weight: same catalog item > same category, then trust, then sales.
    const itemBoost = items.length
      ? `case when p.item_id in (${items.map(() => "?").join(",")}) then 0 else 1 end`
      : `1`;
    if (items.length) params.push(...items);
    params.push(data.limit);
    const rows = await q(
      `${productSelect} where ${where.join(" and ")}
         order by ${itemBoost}, u.trust_score desc, p.sold_count desc, p.created_at desc
         limit ?`,
      params,
    );
    return { items: rows.map(mapProduct) };
  });


export const getProduct = createServerFn({ method: "GET" })
  .inputValidator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const row = await q1(`${productSelect} where p.slug = ?`, [data.slug]);
    if (!row) return { product: null, reviews: [], variants: [] };
    const product = mapProduct(row);
    if (product.status !== "active" && product.status !== "out_of_stock")
      return { product: null, reviews: [], variants: [] };
    const [, reviews, variants] = await Promise.all([
      run(`update products set views = views + 1 where id = ?`, [product.id]),
      q<{
        rating: number;
        comment: string | null;
        seller_reply: string | null;
        created_at: number;
        buyer: string;
      }>(
        `select r.rating, r.comment, r.seller_reply, r.created_at, u.username as buyer
       from reviews r join users u on u.id = r.buyer_id where r.product_id = ? order by r.created_at desc limit 30`,
        [product.id],
      ),
      q<{ id: string; title: string; price_cents: number }>(
        `select id, title, price_cents from product_variants where product_id = ? order by sort`,
        [product.id],
      ),
    ]);
    return { product, reviews, variants };
  });

export const getSellerStore = createServerFn({ method: "GET" })
  .inputValidator(z.object({ username: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const sellerRow = await q1<StoreProfile & { store_socials: unknown }>(
      `select id, username, seller_level, rating, rating_count, total_sales, completion_rate, vacation_mode, created_at,
              verification_tier, trust_score, store_banner_url, store_logo_url, store_description,
              store_socials, store_announcement, avg_response_minutes, avg_delivery_minutes,
              refund_count, dispute_count
       from users where lower(username) = lower(?) and seller_status = 'approved' and is_banned = 0`,
      [data.username],
    );
    if (!sellerRow) return { seller: null, products: [], reviews: [] };
    const seller: StoreProfile = {
      ...sellerRow,
      store_socials:
        typeof sellerRow.store_socials === "string"
          ? JSON.parse(sellerRow.store_socials)
          : ((sellerRow.store_socials as Record<string, string> | null) ?? {}),
    };
    const [productRows, reviews] = await Promise.all([
      q(
        `${productSelect} where p.seller_id = ? and p.status in ('active','out_of_stock') order by p.sold_count desc`,
        [seller.id],
      ),
      q<{
        rating: number;
        comment: string | null;
        seller_reply: string | null;
        created_at: number;
        buyer: string;
        product_title: string;
      }>(
        `select r.rating, r.comment, r.seller_reply, r.created_at, u.username as buyer, o.product_title
       from reviews r join users u on u.id = r.buyer_id join orders o on o.id = r.order_id
       where r.seller_id = ? order by r.created_at desc limit 50`,
        [seller.id],
      ),
    ]);
    const products = productRows.map(mapProduct);
    return { seller, products, reviews };
  });

export interface CatalogItem {
  id: string;
  name: string;
  slug: string;
  is_active: number;
  categoryIds: string[];
}

export const listCatalogItems = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const [items, maps] = await Promise.all([
    q<{ id: string; name: string; slug: string; is_active: number }>(
      `select id, name, slug, is_active from catalog_items where is_active = 1 order by sort, name`,
    ),
    q<{ item_id: string; category_id: string }>(
      `select item_id, category_id from catalog_item_categories`,
    ),
  ]);
  const byItem: Record<string, string[]> = {};
  for (const m of maps) (byItem[m.item_id] ??= []).push(m.category_id);
  return { items: items.map((i) => ({ ...i, categoryIds: byItem[i.id] ?? [] })) };
});

export const quickSearch = createServerFn({ method: "GET" })
  .inputValidator(z.object({ q: z.string().max(100) }))
  .handler(async ({ data }) => {
    await appContext();
    const term = data.q.trim().toLowerCase();
    if (!term) return { products: [], sellers: [], categories: [], items: [] };
    const like = `%${term}%`;
    const [products, sellers, categories, items] = await Promise.all([
      q<{
        id: string;
        title: string;
        slug: string;
        image_key: string | null;
        price_cents: number;
        category_name: string;
        delivery_type: string;
      }>(
        `select p.id, p.title, p.slug, p.image_key, p.price_cents, c.name as category_name, p.delivery_type
         from products p join categories c on c.id = p.category_id
         where p.status = 'active' and (lower(p.title) like ? or lower(p.description) like ? or lower(coalesce(p.platform,'')) like ?)
         order by p.sold_count desc, p.views desc limit 6`,
        [like, like, like],
      ),
      q<{ id: string; username: string; rating: number; total_sales: number }>(
        `select id, username, rating, total_sales from users
         where seller_status = 'approved' and is_banned = 0 and lower(username) like ?
         order by total_sales desc limit 4`,
        [like],
      ),
      q<{ id: string; name: string; slug: string; icon: string }>(
        `select id, name, slug, icon from categories
         where is_active = 1 and lower(name) like ? order by sort limit 5`,
        [like],
      ),
      q<{ id: string; name: string; slug: string }>(
        `select id, name, slug from catalog_items
         where is_active = 1 and lower(name) like ? order by sort, name limit 5`,
        [like],
      ),
    ]);
    const suggestion = products.length === 0 ? await didYouMean(term) : null;
    return { products, sellers, categories, items, suggestion };
  });

/**
 * Facets: counts per category / item / delivery / verification tier for the
 * currently-applied query. Drives the left rail on /browse so users always
 * know how many results each filter would yield.
 */
export const browseFacets = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      category: z.string().optional(),
      item: z.string().optional(),
      q: z.string().max(100).optional(),
      delivery: z.enum(["auto", "manual"]).optional(),
      minPrice: z.number().optional(),
      maxPrice: z.number().optional(),
      inStock: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    // Build a shared WHERE excluding the facet being counted, so the user
    // can switch between categories without losing the option list.
    const baseConds: string[] = [`p.status = 'active'`];
    const baseParams: Array<string | number> = [];
    if (data.q) {
      const tokens = tokenize(data.q);
      if (tokens.length > 0) {
        const { sql, params: sp } = buildSearchClause(tokens, [
          "p.title",
          "p.description",
          "coalesce(p.platform,'')",
          "u.username",
          "c.name",
          "coalesce(ci.name,'')",
        ]);
        baseConds.push(`(${sql})`);
        baseParams.push(...sp);
      }
    }
    if (data.minPrice !== undefined) {
      baseConds.push(`p.price_cents >= ?`);
      baseParams.push(Math.round(data.minPrice * 100));
    }
    if (data.maxPrice !== undefined) {
      baseConds.push(`p.price_cents <= ?`);
      baseParams.push(Math.round(data.maxPrice * 100));
    }
    if (data.inStock) {
      baseConds.push(`(p.delivery_type = 'manual' or p.stock_count > 0)`);
    }
    const FROM = `from products p
       join categories c on c.id = p.category_id
       join users u on u.id = p.seller_id
       left join catalog_items ci on ci.id = p.item_id`;

    const withCond = (extra: string[], extraParams: Array<string | number>) => ({
      where: [...baseConds, ...extra].join(" and "),
      params: [...baseParams, ...extraParams],
    });

    // Categories — count ignoring active category filter
    const catCond = withCond(
      data.item ? [`p.item_id = ?`] : [],
      data.item ? [data.item] : [],
    );
    const itemCond = withCond(
      data.category ? [`c.slug = ?`] : [],
      data.category ? [data.category] : [],
    );
    const fullCond = withCond(
      [
        ...(data.category ? [`c.slug = ?`] : []),
        ...(data.item ? [`p.item_id = ?`] : []),
      ],
      [
        ...(data.category ? [data.category] : []),
        ...(data.item ? [data.item] : []),
      ],
    );

    const [categories, items, delivery, tiers, priceRange] = await Promise.all([
      q<{ slug: string; name: string; icon: string; c: number }>(
        `select c.slug, c.name, c.icon, count(*) c ${FROM} where ${catCond.where}
           group by c.id order by c.sort`,
        catCond.params,
      ),
      q<{ id: string; name: string; c: number }>(
        `select ci.id, ci.name, count(*) c ${FROM} where ${itemCond.where} and ci.id is not null
           group by ci.id order by c desc limit 30`,
        itemCond.params,
      ),
      q<{ delivery_type: string; c: number }>(
        `select p.delivery_type, count(*) c ${FROM} where ${fullCond.where} group by p.delivery_type`,
        fullCond.params,
      ),
      q<{ verification_tier: string; c: number }>(
        `select u.verification_tier, count(*) c ${FROM} where ${fullCond.where} group by u.verification_tier`,
        fullCond.params,
      ),
      q1<{ lo: number | null; hi: number | null }>(
        `select min(p.price_cents) lo, max(p.price_cents) hi ${FROM} where ${fullCond.where}`,
        fullCond.params,
      ),
    ]);
    return { categories, items, delivery, tiers, priceRange: priceRange ?? { lo: 0, hi: 0 } };
  });

/**
 * Cheap autocomplete: returns up to 8 product title suggestions matching a
 * prefix. Used by the header SmartSearch for inline typeahead.
 */
export const searchSuggest = createServerFn({ method: "GET" })
  .inputValidator(z.object({ q: z.string().max(60) }))
  .handler(async ({ data }) => {
    await appContext();
    const term = data.q.trim().toLowerCase();
    if (term.length < 2) return { suggestions: [] as string[] };
    const rows = await q<{ s: string }>(
      `select distinct lower(title) s from products
         where status = 'active' and lower(title) like ?
         order by sold_count desc limit 8`,
      [`%${term}%`],
    );
    return { suggestions: rows.map((r) => r.s) };
  });
