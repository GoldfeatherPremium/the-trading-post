import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "node:crypto";
import { q, run } from "@/lib/server/db.server";
import { appContext } from "@/lib/server/app.server";
import { notify, now } from "@/lib/server/core.server";

/**
 * Daily-digest cron: for every user who follows ≥1 seller, notify them of
 * new active listings posted in the last 24h by sellers they follow.
 *
 * Auth: x-cron-secret header (sha256-compared against CRON_SECRET). When
 * CRON_SECRET is unset, the endpoint refuses to run — never silently open.
 *
 * Idempotency: each user's last-sent timestamp is stored in
 * follow_digest_state; running the cron twice within 12h is a no-op.
 */
export const Route = createFileRoute("/api/public/cron/follow-digest")({
  server: {
    handlers: {
      POST: handler,
      GET: handler,
    },
  },
});

async function handler({ request }: { request: Request }) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("Cron not configured", { status: 503 });
  }
  const supplied = request.headers.get("x-cron-secret") ?? "";
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(secret).digest();
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("Unauthorized", { status: 401 });
  }

  await appContext();
  const t = now();
  const since = t - 24 * 3_600_000;
  const cooldown = t - 12 * 3_600_000;

  // Aggregate per-follower: count of new listings + sample of seller usernames
  const rows = await q<{
    user_id: string;
    new_count: number;
    seller_sample: string;
    last_sent_at: number | null;
  }>(
    `select f.user_id,
            count(distinct p.id) as new_count,
            min(u.username) as seller_sample,
            max(s.last_sent_at) as last_sent_at
       from seller_follows f
       join products p on p.seller_id = f.seller_id and p.status = 'active' and p.created_at > ?
       join users u on u.id = f.seller_id
       left join follow_digest_state s on s.user_id = f.user_id
      group by f.user_id`,
    [since],
  );

  let sent = 0;
  for (const r of rows) {
    if (r.last_sent_at && r.last_sent_at > cooldown) continue;
    const title = `${r.new_count} new listing${r.new_count === 1 ? "" : "s"} from sellers you follow`;
    const body = `${r.seller_sample}${r.new_count > 1 ? ` and ${r.new_count - 1} more` : ""} just posted new items.`;
    await notify(r.user_id, "follow_digest", title, body, `/account/following`);
    await run(
      `insert into follow_digest_state (user_id, last_sent_at, last_count) values (?,?,?)
       on conflict (user_id) do update set last_sent_at = excluded.last_sent_at, last_count = excluded.last_count`,
      [r.user_id, t, r.new_count],
    ).catch(async () => {
      // SQLite older syntax / fallback
      await run(`delete from follow_digest_state where user_id = ?`, [r.user_id]);
      await run(
        `insert into follow_digest_state (user_id, last_sent_at, last_count) values (?,?,?)`,
        [r.user_id, t, r.new_count],
      );
    });
    sent++;
  }

  return new Response(JSON.stringify({ ok: true, candidates: rows.length, sent }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
