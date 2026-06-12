import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1 } from "../server/db.server";
import { appContext } from "../server/app.server";
import { requireStaff } from "../server/auth.server";

export type RiskBand = "low" | "medium" | "high";

export interface RiskEventRow {
  id: number;
  user_id: string | null;
  seller_id: string | null;
  order_id: string | null;
  kind: string;
  score: number;
  band: RiskBand;
  reasons: string[];
  action: string;
  created_at: number;
  buyer_username: string | null;
  seller_username: string | null;
  order_no: string | null;
  order_total_cents: number | null;
  order_status: string | null;
  escrow_status: string | null;
}

export const getRiskOverview = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  await requireStaff();
  const t = Date.now();
  const d1 = t - 86_400_000;
  const d7 = t - 7 * 86_400_000;
  const [held, last24, last7, highBand] = await Promise.all([
    q1<{ c: number; s: number }>(
      `select count(*) c, coalesce(sum(total_cents),0) s from orders where escrow_status = 'on_hold'`,
    ),
    q1<{ c: number }>(`select count(*) c from risk_events where created_at > ?`, [d1]),
    q1<{ c: number }>(`select count(*) c from risk_events where created_at > ?`, [d7]),
    q1<{ c: number }>(
      `select count(*) c from risk_events where band = 'high' and created_at > ?`,
      [d1],
    ),
  ]);
  return {
    heldOrders: held?.c ?? 0,
    heldGmvCents: held?.s ?? 0,
    events24h: last24?.c ?? 0,
    events7d: last7?.c ?? 0,
    highBand24h: highBand?.c ?? 0,
  };
});

export const listRiskEvents = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      band: z.enum(["all", "low", "medium", "high"]).default("all"),
      limit: z.number().int().min(1).max(200).default(50),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    await requireStaff();
    const where = data.band === "all" ? "" : `where r.band = ?`;
    const params: Array<string | number> = data.band === "all" ? [] : [data.band];
    params.push(data.limit);
    const rows = await q<RiskEventRow>(
      `select r.id, r.user_id, r.seller_id, r.order_id, r.kind, r.score, r.band,
              r.reasons as reasons, r.action, r.created_at,
              b.username as buyer_username, s.username as seller_username,
              o.order_no, o.total_cents as order_total_cents,
              o.status as order_status, o.escrow_status
         from risk_events r
         left join users b on b.id = r.user_id
         left join users s on s.id = r.seller_id
         left join orders o on o.id = r.order_id
         ${where}
         order by r.created_at desc
         limit ?`,
      params,
    );
    return {
      events: rows.map((r) => ({
        ...r,
        reasons: typeof r.reasons === "string" ? safeJson(r.reasons) : r.reasons,
      })),
    };
  });

function safeJson(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [String(v)];
  } catch {
    return [s];
  }
}
