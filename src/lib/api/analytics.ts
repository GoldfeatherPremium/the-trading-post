import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1 } from "../server/db.server";
import { appContext } from "../server/app.server";
import { now } from "../server/core.server";
import { requireSeller, requireStaff } from "../server/auth.server";

const DAY = 86_400_000;
const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
type Range = keyof typeof RANGES;

function buildDaily(
  rows: Array<{ paid_at: number; v: number; n: number }>,
  days: number,
  t: number,
) {
  const out: Array<{ day: string; v: number; n: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(t - i * DAY);
    out.push({ day: `${d.getMonth() + 1}/${d.getDate()}`, v: 0, n: 0 });
  }
  for (const r of rows) {
    const idx = days - 1 - Math.min(days - 1, Math.max(0, Math.floor((t - r.paid_at) / DAY)));
    out[idx].v += r.v;
    out[idx].n += r.n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seller analytics
// ---------------------------------------------------------------------------
export const getSellerAnalytics = createServerFn({ method: "GET" })
  .inputValidator(z.object({ range: z.enum(["7d", "30d", "90d"]).default("30d") }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const days = RANGES[data.range as Range];
    const t = now();
    const since = t - days * DAY;
    const prevSince = since - days * DAY;

    const [
      paidRows,
      summary,
      prevSummary,
      topProducts,
      categoryMix,
      hourly,
      buyerStats,
      productCounts,
    ] = await Promise.all([
      q<{ paid_at: number; v: number; n: number }>(
        `select paid_at, seller_net_cents as v, 1 as n from orders
         where seller_id = ? and paid_at > ? and status not in ('cancelled','expired','refunded')`,
        [user.id, since],
      ),
      q1<{ n: number; gross: number; net: number; qty: number; buyers: number }>(
        `select count(*) n, coalesce(sum(total_cents),0) gross, coalesce(sum(seller_net_cents),0) net,
                coalesce(sum(qty),0) qty, count(distinct buyer_id) buyers
         from orders where seller_id = ? and paid_at > ? and status not in ('cancelled','expired','refunded')`,
        [user.id, since],
      ),
      q1<{ n: number; net: number }>(
        `select count(*) n, coalesce(sum(seller_net_cents),0) net from orders
         where seller_id = ? and paid_at > ? and paid_at <= ? and status not in ('cancelled','expired','refunded')`,
        [user.id, prevSince, since],
      ),
      q<{
        id: string;
        title: string;
        orders: number;
        revenue: number;
        views: number;
        sold_count: number;
      }>(
        `select p.id, p.title, count(o.id) orders, coalesce(sum(o.seller_net_cents),0) revenue,
                p.views, p.sold_count
         from products p left join orders o
           on o.product_id = p.id and o.paid_at > ? and o.status not in ('cancelled','expired','refunded')
         where p.seller_id = ?
         group by p.id, p.title, p.views, p.sold_count
         order by revenue desc limit 8`,
        [since, user.id],
      ),
      q<{ name: string; orders: number; revenue: number }>(
        `select c.name, count(o.id) orders, coalesce(sum(o.seller_net_cents),0) revenue
         from orders o join products p on p.id = o.product_id join categories c on c.id = p.category_id
         where o.seller_id = ? and o.paid_at > ? and o.status not in ('cancelled','expired','refunded')
         group by c.id, c.name order by revenue desc limit 8`,
        [user.id, since],
      ),
      q<{ paid_at: number }>(
        `select paid_at from orders where seller_id = ? and paid_at > ?
         and status not in ('cancelled','expired','refunded')`,
        [user.id, since],
      ),
      q1<{ total_buyers: number; repeat_buyers: number }>(
        `select count(*) total_buyers, sum(case when c > 1 then 1 else 0 end) repeat_buyers from (
           select buyer_id, count(*) c from orders
           where seller_id = ? and paid_at > ? and status not in ('cancelled','expired','refunded')
           group by buyer_id
         ) x`,
        [user.id, since],
      ),
      q1<{ active: number; paused: number; oos: number }>(
        `select
           sum(case when status = 'active' then 1 else 0 end) active,
           sum(case when status = 'paused' then 1 else 0 end) paused,
           sum(case when status = 'out_of_stock' then 1 else 0 end) oos
         from products where seller_id = ?`,
        [user.id],
      ),
    ]);

    const daily = buildDaily(paidRows, days, t);
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, n: 0 }));
    for (const r of hourly) hours[new Date(r.paid_at).getHours()].n += 1;

    const totalViews = topProducts.reduce((s, p) => s + (p.views || 0), 0);
    const totalSold = topProducts.reduce((s, p) => s + (p.sold_count || 0), 0);
    const conversion = totalViews > 0 ? (totalSold / totalViews) * 100 : 0;
    const aov = summary!.n > 0 ? summary!.gross / summary!.n / 100 : 0;
    const prevNet = prevSummary?.net ?? 0;
    const growth = prevNet > 0 ? ((summary!.net - prevNet) / prevNet) * 100 : null;
    const repeatRate =
      buyerStats && buyerStats.total_buyers > 0
        ? (buyerStats.repeat_buyers / buyerStats.total_buyers) * 100
        : 0;

    return {
      range: data.range,
      daily,
      hours,
      topProducts,
      categoryMix,
      summary: {
        orders: summary!.n,
        gross: summary!.gross,
        net: summary!.net,
        qty: summary!.qty,
        uniqueBuyers: summary!.buyers,
        aov,
        conversion,
        repeatRate,
        growth,
      },
      productCounts: productCounts!,
    };
  });

// ---------------------------------------------------------------------------
// Admin analytics — marketplace wide
// ---------------------------------------------------------------------------
export const getAdminAnalytics = createServerFn({ method: "GET" })
  .inputValidator(z.object({ range: z.enum(["7d", "30d", "90d"]).default("30d") }))
  .handler(async ({ data }) => {
    await appContext();
    await requireStaff();
    const days = RANGES[data.range as Range];
    const t = now();
    const since = t - days * DAY;
    const prevSince = since - days * DAY;

    const [
      paidRows,
      summary,
      prev,
      categoryPerf,
      topSellers,
      topProducts,
      newSignups,
      conversionRow,
    ] = await Promise.all([
      q<{ paid_at: number; v: number; n: number }>(
        `select paid_at, total_cents as v, 1 as n from orders
         where paid_at > ? and status not in ('cancelled','expired','refunded')`,
        [since],
      ),
      q1<{ n: number; gmv: number; commission: number; buyers: number; sellers: number }>(
        `select count(*) n, coalesce(sum(total_cents),0) gmv, coalesce(sum(commission_cents),0) commission,
                count(distinct buyer_id) buyers, count(distinct seller_id) sellers
         from orders where paid_at > ? and status not in ('cancelled','expired','refunded')`,
        [since],
      ),
      q1<{ gmv: number; n: number }>(
        `select count(*) n, coalesce(sum(total_cents),0) gmv from orders
         where paid_at > ? and paid_at <= ? and status not in ('cancelled','expired','refunded')`,
        [prevSince, since],
      ),
      q<{ name: string; orders: number; gmv: number; sellers: number }>(
        `select c.name, count(o.id) orders, coalesce(sum(o.total_cents),0) gmv,
                count(distinct o.seller_id) sellers
         from orders o join products p on p.id = o.product_id join categories c on c.id = p.category_id
         where o.paid_at > ? and o.status not in ('cancelled','expired','refunded')
         group by c.id, c.name order by gmv desc limit 10`,
        [since],
      ),
      q<{ username: string; orders: number; gmv: number; net: number }>(
        `select u.username, count(o.id) orders, coalesce(sum(o.total_cents),0) gmv,
                coalesce(sum(o.seller_net_cents),0) net
         from orders o join users u on u.id = o.seller_id
         where o.paid_at > ? and o.status not in ('cancelled','expired','refunded')
         group by o.seller_id, u.username order by gmv desc limit 10`,
        [since],
      ),
      q<{ id: string; title: string; seller: string; orders: number; gmv: number }>(
        `select p.id, p.title, u.username as seller, count(o.id) orders,
                coalesce(sum(o.total_cents),0) gmv
         from orders o join products p on p.id = o.product_id join users u on u.id = p.seller_id
         where o.paid_at > ? and o.status not in ('cancelled','expired','refunded')
         group by p.id, p.title, u.username order by gmv desc limit 10`,
        [since],
      ),
      q1<{ buyers: number; sellers: number }>(
        `select
           sum(case when role = 'buyer' then 1 else 0 end) buyers,
           sum(case when role = 'seller' or seller_status = 'approved' then 1 else 0 end) sellers
         from users where created_at > ?`,
        [since],
      ),
      q1<{ views: number; sold: number }>(
        `select coalesce(sum(views),0) views, coalesce(sum(sold_count),0) sold from products`,
      ),
    ]);

    const daily = buildDaily(paidRows, days, t);
    const prevGmv = prev?.gmv ?? 0;
    const gmvGrowth = prevGmv > 0 ? ((summary!.gmv - prevGmv) / prevGmv) * 100 : null;
    const aov = summary!.n > 0 ? summary!.gmv / summary!.n / 100 : 0;
    const conv =
      conversionRow && conversionRow.views > 0
        ? (conversionRow.sold / conversionRow.views) * 100
        : 0;

    return {
      range: data.range,
      daily,
      summary: {
        orders: summary!.n,
        gmv: summary!.gmv,
        commission: summary!.commission,
        uniqueBuyers: summary!.buyers,
        activeSellers: summary!.sellers,
        aov,
        gmvGrowth,
        marketplaceConversion: conv,
      },
      categoryPerf,
      topSellers,
      topProducts,
      newSignups: newSignups ?? { buyers: 0, sellers: 0 },
    };
  });
