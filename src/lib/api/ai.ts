import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { appContext } from "../server/app.server";
import { requireSeller, requireStaff } from "../server/auth.server";
import { q, q1 } from "../server/db.server";
import { callAiJson } from "../server/ai.server";
import { fail } from "../server/core.server";

// ---------------------------------------------------------------------------
// AI Product Generator — fills title/description/tags/SEO from item + notes
// ---------------------------------------------------------------------------
export const generateProductContent = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      itemName: z.string().trim().min(2).max(120),
      categoryName: z.string().trim().max(120).optional(),
      hint: z.string().trim().max(500).optional(),
      field: z.enum(["all", "title", "description", "tags", "seo"]).default("all"),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    await requireSeller();
    const sys =
      "You are a marketplace listing copywriter for X-VAULT, a digital goods marketplace " +
      "(game items, accounts, gift cards, subscriptions). Write copy that is concise, " +
      "honest, conversion-focused, and avoids any prohibited content (no stolen/hacked/" +
      "carded items, no shared credentials, no policy violations). Return ONLY valid JSON.";
    const ask =
      data.field === "all"
        ? `Generate a complete listing for:
Item: ${data.itemName}
${data.categoryName ? `Category: ${data.categoryName}` : ""}
${data.hint ? `Seller notes: ${data.hint}` : ""}

Return JSON: { "title": string (60-90 chars), "description": string (180-400 chars, plain text, no markdown), "tags": string[] (5-8 lowercase keywords), "seoTitle": string (<=60 chars), "seoDescription": string (<=155 chars) }`
        : `Generate the "${data.field}" field for a marketplace listing.
Item: ${data.itemName}
${data.categoryName ? `Category: ${data.categoryName}` : ""}
${data.hint ? `Seller notes: ${data.hint}` : ""}

Return JSON: { "${data.field === "tags" ? "tags" : data.field}": ${data.field === "tags" ? "string[]" : "string"} }`;

    type Result = {
      title?: string;
      description?: string;
      tags?: string[];
      seoTitle?: string;
      seoDescription?: string;
    };
    const out = await callAiJson<Result>({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: ask },
      ],
      temperature: 0.7,
    });
    return out;
  });

// ---------------------------------------------------------------------------
// AI Support Assistant — classify dispute + suggest reply
// ---------------------------------------------------------------------------
export const aiAssistDispute = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    await requireStaff(["admin", "support"]);
    const dispute = await q1<{
      id: string;
      reason: string;
      description: string | null;
      seller_response: string | null;
      status: string;
      product_title: string;
      total_cents: number;
    }>(
      `select d.id, d.reason, d.description, d.seller_response, d.status,
              o.product_title, o.total_cents
         from disputes d join orders o on o.id = d.order_id
         where d.order_id = ?`,
      [data.orderId],
    );
    if (!dispute) fail("No dispute found.");
    const messages = await q<{ author_role: string; body: string }>(
      `select author_role, body from dispute_messages where dispute_id = ? and is_internal = 0
       order by created_at asc limit 30`,
      [dispute!.id],
    );
    const transcript = messages.map((m) => `[${m.author_role}] ${m.body}`).join("\n") || "(no messages)";

    type Out = {
      category: string;
      severity: "low" | "medium" | "high";
      summary: string;
      suggestedReply: string;
      suggestedResolution: "refund_buyer" | "release_seller" | "partial_refund" | "needs_info";
    };
    const out = await callAiJson<Out>({
      messages: [
        {
          role: "system",
          content:
            "You are X-VAULT's senior support assistant. Triage marketplace disputes. " +
            "Be neutral and concise. Return ONLY valid JSON.",
        },
        {
          role: "user",
          content: `Product: ${dispute!.product_title}
Order value: $${(dispute!.total_cents / 100).toFixed(2)}
Reason code: ${dispute!.reason}
Buyer description: ${dispute!.description ?? "(none)"}
Seller response: ${dispute!.seller_response ?? "(none)"}

Conversation:
${transcript}

Return JSON: {
  "category": one of ["non_delivery","wrong_item","account_recovered","quality","fraud_buyer","other"],
  "severity": "low" | "medium" | "high",
  "summary": 2-sentence neutral summary,
  "suggestedReply": professional reply staff can send to both parties,
  "suggestedResolution": "refund_buyer" | "release_seller" | "partial_refund" | "needs_info"
}`,
        },
      ],
      temperature: 0.3,
    });
    return out;
  });

// ---------------------------------------------------------------------------
// AI Fraud Risk Score — analyses user pattern
// ---------------------------------------------------------------------------
export const aiRiskScoreUser = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    await requireStaff(["admin", "support"]);
    const u = await q1<{
      id: string;
      username: string;
      role: string;
      created_at: number;
      is_banned: number;
      trust_score: number | null;
    }>(`select id, username, role, created_at, is_banned, trust_score from users where id = ?`, [
      data.userId,
    ]);
    if (!u) fail("User not found.");

    const [orders, refunds, disputes, reviews] = await Promise.all([
      q1<{ c: number; total: number }>(
        `select count(*) c, coalesce(sum(total_cents),0) total from orders where buyer_id = ? or seller_id = ?`,
        [u!.id, u!.id],
      ),
      q1<{ c: number }>(
        `select count(*) c from orders where (buyer_id = ? or seller_id = ?) and status in ('refunded','cancelled')`,
        [u!.id, u!.id],
      ),
      q1<{ c: number }>(`select count(*) c from disputes where opened_by = ?`, [u!.id]),
      q1<{ avg: number; c: number }>(
        `select coalesce(avg(rating),0) avg, count(*) c from product_reviews where seller_id = ? or buyer_id = ?`,
        [u!.id, u!.id],
      ),
    ]);

    const ageDays = Math.floor((Date.now() - u!.created_at) / 86_400_000);
    type Out = {
      riskScore: number;
      band: "low" | "medium" | "high";
      reasons: string[];
      recommendation: string;
    };
    const out = await callAiJson<Out>({
      messages: [
        {
          role: "system",
          content:
            "You are a fraud-risk analyst for a digital goods marketplace. Score risk from 0 (safe) to 100 (high-risk fraud). Return ONLY valid JSON.",
        },
        {
          role: "user",
          content: `Analyse this account:
Username: ${u!.username}
Role: ${u!.role}
Account age (days): ${ageDays}
Already banned: ${u!.is_banned ? "yes" : "no"}
Trust score: ${u!.trust_score ?? "n/a"}
Total orders (as buyer or seller): ${orders?.c ?? 0}
GMV (cents): ${orders?.total ?? 0}
Refunded/cancelled orders: ${refunds?.c ?? 0}
Disputes opened by user: ${disputes?.c ?? 0}
Reviews count: ${reviews?.c ?? 0}, average rating: ${(reviews?.avg ?? 0).toFixed(2)}

Return JSON: { "riskScore": 0-100 int, "band": "low"|"medium"|"high", "reasons": string[] (3-5 bullets), "recommendation": short string for staff action }`,
        },
      ],
      temperature: 0.2,
    });
    return { ...out, ageDays };
  });
