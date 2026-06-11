import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "../server/db.server";
import { appContext } from "../server/app.server";

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
         u.completion_rate as s_completion, u.vacation_mode as s_vacation, u.created_at as s_created
  from products p
  join categories c on c.id = p.category_id
  join users u on u.id = p.seller_id`;

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
    },
  };
}

export const getHomeData = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  const d = db();
  const categories = d
    .prepare(
      `select id, name, slug, icon, default_warranty_hours, commission_pct, risk_tier from categories where is_active = 1 order by sort`,
    )
    .all() as Array<{
    id: string;
    name: string;
    slug: string;
    icon: string;
    default_warranty_hours: number;
    commission_pct: number;
    risk_tier: string;
  }>;
  const trending = (
    d
      .prepare(
        `${productSelect} where p.status = 'active' order by p.sold_count desc, p.views desc limit 8`,
      )
      .all() as Record<string, unknown>[]
  ).map(mapProduct);
  const newest = (
    d
      .prepare(`${productSelect} where p.status = 'active' order by p.created_at desc limit 8`)
      .all() as Record<string, unknown>[]
  ).map(mapProduct);
  const topSellers = d
    .prepare(
      `select id, username, seller_level, rating, rating_count, total_sales, completion_rate, vacation_mode, created_at
       from users where seller_status = 'approved' and is_banned = 0 order by total_sales desc limit 6`,
    )
    .all() as PublicSeller[];
  const recentSales = d
    .prepare(
      `select o.product_title, o.total_cents, o.created_at, u.username as buyer
       from orders o join users u on u.id = o.buyer_id
       where o.status in ('delivered','completed','released') order by o.created_at desc limit 8`,
    )
    .all() as Array<{
    product_title: string;
    total_cents: number;
    created_at: number;
    buyer: string;
  }>;
  return { categories, trending, newest, topSellers, recentSales };
});

export const browseProducts = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      category: z.string().optional(),
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
    appContext();
    const d = db();
    const where: string[] = [`p.status = 'active'`];
    const params: Record<string, unknown> = {};
    if (data.category) {
      where.push(`c.slug = @category`);
      params.category = data.category;
    }
    if (data.q) {
      where.push(
        `(p.title like @q or p.description like @q or p.platform like @q or u.username like @q)`,
      );
      params.q = `%${data.q}%`;
    }
    if (data.delivery) {
      where.push(`p.delivery_type = @delivery`);
      params.delivery = data.delivery;
    }
    if (data.minPrice !== undefined) {
      where.push(`p.price_cents >= @minPrice`);
      params.minPrice = Math.round(data.minPrice * 100);
    }
    if (data.maxPrice !== undefined) {
      where.push(`p.price_cents <= @maxPrice`);
      params.maxPrice = Math.round(data.maxPrice * 100);
    }
    if (data.inStock) {
      where.push(`(p.delivery_type = 'manual' or p.stock_count > 0)`);
    }
    const order = {
      popular: `p.sold_count desc, p.views desc`,
      price_asc: `p.price_cents asc`,
      price_desc: `p.price_cents desc`,
      newest: `p.created_at desc`,
      rating: `u.rating desc, p.sold_count desc`,
    }[data.sort];
    const PAGE = 24;
    const whereSql = where.join(" and ");
    const total = (
      d
        .prepare(
          `select count(*) c from products p join categories c on c.id = p.category_id join users u on u.id = p.seller_id where ${whereSql}`,
        )
        .get(params) as { c: number }
    ).c;
    const items = (
      d
        .prepare(
          `${productSelect} where ${whereSql} order by ${order} limit ${PAGE} offset ${(data.page - 1) * PAGE}`,
        )
        .all(params) as Record<string, unknown>[]
    ).map(mapProduct);
    return { items, total, page: data.page, pageCount: Math.max(1, Math.ceil(total / PAGE)) };
  });

export const getProduct = createServerFn({ method: "GET" })
  .inputValidator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    appContext();
    const d = db();
    const row = d.prepare(`${productSelect} where p.slug = ?`).get(data.slug) as
      | Record<string, unknown>
      | undefined;
    if (!row) return { product: null, reviews: [] };
    const product = mapProduct(row);
    if (product.status !== "active" && product.status !== "out_of_stock")
      return { product: null, reviews: [] };
    d.prepare(`update products set views = views + 1 where id = ?`).run(product.id);
    const reviews = d
      .prepare(
        `select r.rating, r.comment, r.seller_reply, r.created_at, u.username as buyer
         from reviews r join users u on u.id = r.buyer_id where r.product_id = ? order by r.created_at desc limit 30`,
      )
      .all(product.id) as Array<{
      rating: number;
      comment: string | null;
      seller_reply: string | null;
      created_at: number;
      buyer: string;
    }>;
    return { product, reviews };
  });

export const getSellerStore = createServerFn({ method: "GET" })
  .inputValidator(z.object({ username: z.string() }))
  .handler(async ({ data }) => {
    appContext();
    const d = db();
    const seller = d
      .prepare(
        `select id, username, seller_level, rating, rating_count, total_sales, completion_rate, vacation_mode, created_at
         from users where lower(username) = lower(?) and seller_status = 'approved' and is_banned = 0`,
      )
      .get(data.username) as PublicSeller | undefined;
    if (!seller) return { seller: null, products: [], reviews: [] };
    const products = (
      d
        .prepare(
          `${productSelect} where p.seller_id = ? and p.status in ('active','out_of_stock') order by p.sold_count desc`,
        )
        .all(seller.id) as Record<string, unknown>[]
    ).map(mapProduct);
    const reviews = d
      .prepare(
        `select r.rating, r.comment, r.seller_reply, r.created_at, u.username as buyer, o.product_title
         from reviews r join users u on u.id = r.buyer_id join orders o on o.id = r.order_id
         where r.seller_id = ? order by r.created_at desc limit 50`,
      )
      .all(seller.id) as Array<{
      rating: number;
      comment: string | null;
      seller_reply: string | null;
      created_at: number;
      buyer: string;
      product_title: string;
    }>;
    return { seller, products, reviews };
  });
