import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, Output } from "ai";
import { appContext } from "../server/app.server";
import { requireSeller, requireStaff } from "../server/auth.server";
import { audit, fail } from "../server/core.server";
import { q1 } from "../server/db.server";
import { COPILOT_MODEL, getGatewayOrThrow } from "../server/ai-gateway.server";

// Marketplace policy summary kept short — token budget matters here.
const POLICY = `X-VAULT marketplace policy:
- Allowed: legitimately owned digital goods, gift cards bought with personal funds, in-game currency earned legitimately, services, downloads the seller has the right to distribute.
- Forbidden: stolen / carded / fraudulent gift cards, hacked accounts, unauthorized credentials, shared-credential subscriptions that violate the upstream provider's terms (Netflix, Spotify family, etc.), CSAM, weapons, drugs, malware, account boosting that violates game ToS in regions where it is illegal, anything illegal in the seller's country.
- Listings must clearly state delivery method, region locks, warranty terms.`;

async function runJson<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  system: string,
): Promise<T> {
  const gateway = getGatewayOrThrow();
  try {
    const { experimental_output } = await generateText({
      model: gateway(COPILOT_MODEL),
      system,
      prompt,
      experimental_output: Output.object({ schema }),
    });
    return experimental_output as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/402/.test(msg)) fail("AI credits exhausted — please add credits in workspace billing.");
    if (/429/.test(msg)) fail("AI is rate-limited — try again in a moment.");
    fail("AI request failed: " + msg);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// SELLER: draft a listing from a short brief
// ---------------------------------------------------------------------------
const DraftSchema = z.object({
  title: z.string().min(8).max(120),
  description: z.string().min(60).max(1200),
  tags: z.array(z.string()).max(8),
  warnings: z.array(z.string()).max(5),
  suggested_price_usdt: z.number().min(0).max(100000).optional(),
});

export const aiDraftListing = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      brief: z.string().min(10).max(2000),
      categoryHint: z.string().max(80).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const out = await runJson(
      `Seller brief: ${data.brief}\nCategory hint: ${data.categoryHint ?? "(none)"}`,
      DraftSchema,
      `You are X-VAULT's listing copilot. Write crisp, trustworthy product listings for a digital-goods marketplace.\nRespect this policy and never produce a listing that violates it. If the brief looks prohibited, return a listing whose 'warnings' explains why it cannot be listed and leave title/description generic.\n${POLICY}\nKeep description honest, mention delivery method and any region locks, never invent features.`,
    );
    await audit(user.id, "copilot.draft", "product", undefined, { len: data.brief.length });
    return out;
  });

// ---------------------------------------------------------------------------
// SELLER: polish / rewrite an existing description
// ---------------------------------------------------------------------------
const PolishSchema = z.object({
  description: z.string().min(40).max(1500),
  suggestions: z.array(z.string()).max(6),
});

export const aiPolishDescription = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      title: z.string().min(3).max(200),
      description: z.string().min(20).max(4000),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireSeller();
    const out = await runJson(
      `Title: ${data.title}\n\nCurrent description:\n${data.description}`,
      PolishSchema,
      `You polish marketplace product descriptions: improve clarity, structure into short paragraphs, surface delivery method / warranty / region info. Do not invent features. Return improved description and a short list of suggestions the seller should consider adding.\n${POLICY}`,
    );
    await audit(user.id, "copilot.polish", "product");
    return out;
  });

// ---------------------------------------------------------------------------
// STAFF: AI screen a pending product
// ---------------------------------------------------------------------------
const ScreenSchema = z.object({
  verdict: z.enum(["approve", "review", "reject"]),
  risk_score: z.number().min(0).max(100),
  reasons: z.array(z.string()).min(1).max(6),
  policy_flags: z.array(z.string()).max(8),
  suggested_rejection_message: z.string().max(400).optional(),
});

export const aiScreenListing = createServerFn({ method: "POST" })
  .inputValidator(z.object({ productId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const staff = await requireStaff();
    const p = await q1<{
      id: string;
      title: string;
      description: string;
      delivery_type: string;
      category_name: string;
      seller_username: string;
      seller_trust: number;
      seller_dispute_count: number;
      price_cents: number;
    }>(
      `select p.id, p.title, p.description, p.delivery_type,
              c.name as category_name, u.username as seller_username,
              u.trust_score as seller_trust, u.dispute_count as seller_dispute_count,
              p.price_cents
       from products p
       join categories c on c.id = p.category_id
       join users u on u.id = p.seller_id
       where p.id = ?`,
      [data.productId],
    );
    if (!p) fail("Product not found.");
    const prompt = `Product to screen:\nTitle: ${p!.title}\nCategory: ${p!.category_name}\nDelivery: ${p!.delivery_type}\nPrice (USDT cents): ${p!.price_cents}\nSeller: ${p!.seller_username} (trust ${p!.seller_trust}/100, ${p!.seller_dispute_count} past disputes)\n\nDescription:\n${p!.description}`;
    const out = await runJson(
      prompt,
      ScreenSchema,
      `You are a strict marketplace moderation copilot. Rate the listing's risk against this policy and recommend a verdict for human staff.\n${POLICY}\nVerdict 'approve' = clearly safe, 'review' = needs a human look, 'reject' = policy violation. Always list concrete reasons. If verdict is 'reject', provide a short rejection message the seller will see.`,
    );
    await audit(staff.id, "copilot.screen_listing", "product", data.productId, {
      verdict: out.verdict,
      risk: out.risk_score,
    });
    return out;
  });

// ---------------------------------------------------------------------------
// STAFF: AI screen a flagged chat message
// ---------------------------------------------------------------------------
const MessageScreenSchema = z.object({
  verdict: z.enum(["dismiss", "warn", "remove"]),
  confidence: z.number().min(0).max(100),
  categories: z.array(z.string()).max(6),
  explanation: z.string().max(400),
});

export const aiScreenMessage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ messageId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const staff = await requireStaff();
    const m = await q1<{ body: string; flag_reason: string | null; sender: string | null }>(
      `select m.body, m.flag_reason, u.username as sender
       from messages m left join users u on u.id = m.sender_id
       where m.id = ?`,
      [data.messageId],
    );
    if (!m) fail("Message not found.");
    const out = await runJson(
      `Sender: ${m!.sender ?? "unknown"}\nAuto-flag reason: ${m!.flag_reason ?? "(none)"}\nMessage:\n${m!.body}`,
      MessageScreenSchema,
      `You are a marketplace chat moderator. Decide whether a flagged message is a real policy issue.\nMain risks: off-platform payment attempts (fee circumvention / scam vector), contact sharing to move the deal off-platform, harassment, threats, scams.\nVerdict 'dismiss' = false positive, 'warn' = user should be warned but message can stay, 'remove' = clear violation, take it down.`,
    );
    await audit(staff.id, "copilot.screen_message", "message", data.messageId, {
      verdict: out.verdict,
    });
    return out;
  });
