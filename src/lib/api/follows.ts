import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { requireUser, currentUser } from "../server/auth.server";
import { fail, now } from "../server/core.server";

/**
 * Follow / unfollow a seller. Returns the new follow state and current
 * follower count so the UI can update without a separate roundtrip.
 */
export const toggleFollowSeller = createServerFn({ method: "POST" })
  .inputValidator(z.object({ sellerId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    if (user.id === data.sellerId) fail("You can't follow yourself.");
    const seller = await q1<{ id: string }>(
      `select id from users where id = ? and seller_status = 'approved' and is_banned = 0`,
      [data.sellerId],
    );
    if (!seller) fail("Seller not found.");
    const existing = await q1(
      `select 1 as x from seller_follows where user_id = ? and seller_id = ?`,
      [user.id, data.sellerId],
    );
    if (existing) {
      await run(`delete from seller_follows where user_id = ? and seller_id = ?`, [
        user.id,
        data.sellerId,
      ]);
    } else {
      await run(
        `insert into seller_follows (user_id, seller_id, created_at) values (?,?,?)`,
        [user.id, data.sellerId, now()],
      );
    }
    const cnt = await q1<{ c: number }>(
      `select count(*) c from seller_follows where seller_id = ?`,
      [data.sellerId],
    );
    return { following: !existing, followers: cnt?.c ?? 0 };
  });

/** Lightweight: is the current user following this seller + total followers. */
export const getFollowState = createServerFn({ method: "GET" })
  .inputValidator(z.object({ sellerId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await currentUser();
    const cnt = await q1<{ c: number }>(
      `select count(*) c from seller_follows where seller_id = ?`,
      [data.sellerId],
    );
    let following = false;
    if (user) {
      const row = await q1(
        `select 1 as x from seller_follows where user_id = ? and seller_id = ?`,
        [user.id, data.sellerId],
      );
      following = !!row;
    }
    return { following, followers: cnt?.c ?? 0 };
  });

/** Sellers the current user follows, with their latest active listings. */
export const getFollowedFeed = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireUser();
  const sellers = await q<{
    id: string;
    username: string;
    seller_level: number;
    rating: number;
    verification_tier: string;
    trust_score: number;
    followed_at: number;
  }>(
    `select u.id, u.username, u.seller_level, u.rating, u.verification_tier, u.trust_score,
            f.created_at as followed_at
       from seller_follows f
       join users u on u.id = f.seller_id
      where f.user_id = ? and u.is_banned = 0
      order by f.created_at desc limit 50`,
    [user.id],
  );
  if (sellers.length === 0) return { sellers: [], newListings: [] };
  const ids = sellers.map((s) => s.id);
  const placeholders = ids.map(() => "?").join(",");
  const newListings = await q<{
    id: string;
    title: string;
    slug: string;
    image_key: string | null;
    price_cents: number;
    delivery_type: string;
    sold_count: number;
    created_at: number;
    seller_id: string;
    seller_username: string;
  }>(
    `select p.id, p.title, p.slug, p.image_key, p.price_cents, p.delivery_type,
            p.sold_count, p.created_at, p.seller_id, u.username as seller_username
       from products p join users u on u.id = p.seller_id
      where p.status = 'active' and p.seller_id in (${placeholders})
      order by p.created_at desc limit 24`,
    ids,
  );
  return { sellers, newListings };
});
