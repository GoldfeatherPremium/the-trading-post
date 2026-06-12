import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q1, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { audit, fail, hashPassword, now, uid, verifyPassword } from "../server/core.server";
import { createSession, currentUser, destroySession, requireUser } from "../server/auth.server";
import { rateLimit } from "../server/rate-limit.server";

export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const settings = await q1<{ announcement: string | null; maintenance_mode: number }>(
    `select announcement, maintenance_mode from site_settings where id = 1`,
  );
  const banner = {
    announcement: settings?.announcement ?? null,
    maintenance: !!settings?.maintenance_mode,
  };
  const user = await currentUser();
  if (!user) return { user: null, unreadNotifications: 0, unreadMessages: 0, banner };
  const [n1, n2] = await Promise.all([
    q1<{ c: number }>(
      `select count(*) c from notifications where user_id = ? and read_at is null`,
      [user.id],
    ),
    q1<{ c: number }>(
      `select count(*) c from messages m join conversations cv on cv.id = m.conversation_id
       where m.created_at > case when cv.buyer_id = ? then cv.buyer_last_read_at else cv.seller_last_read_at end
         and (cv.buyer_id = ? or cv.seller_id = ?)
         and (m.sender_id is null or m.sender_id != ?)`,
      [user.id, user.id, user.id, user.id],
    ),
  ]);
  return { user, unreadNotifications: n1!.c, unreadMessages: n2!.c, banner };
});

export const register = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email().max(120),
      username: z
        .string()
        .min(3)
        .max(24)
        .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscore only"),
      password: z.string().min(8).max(100),
      refCode: z.string().trim().min(3).max(16).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const email = data.email.toLowerCase().trim();
    if (await q1(`select 1 as x from users where email = ?`, [email]))
      fail("An account with that email already exists.");
    if (await q1(`select 1 as x from users where lower(username) = lower(?)`, [data.username]))
      fail("That username is taken.");
    const id = uid();
    await run(
      `insert into users (id, email, username, password_hash, role, created_at) values (?,?,?,?, 'buyer', ?)`,
      [id, email, data.username, hashPassword(data.password), now()],
    );
    await run(`insert into wallets (user_id) values (?)`, [id]);
    await createSession(id);
    await audit(id, "user.register", "user", id);
    // Attribute to referral, if a code was carried from /r/<code>.
    if (data.refCode) {
      try {
        const ref = await q1<{ id: string; owner_user_id: string }>(
          `select id, owner_user_id from referrals where code = ?`,
          [data.refCode.toUpperCase()],
        );
        if (ref && ref.owner_user_id !== id) {
          await run(
            `insert into referral_attributions (user_id, referral_id, attributed_at) values (?,?,?)`,
            [id, ref.id, now()],
          );
          await run(`update referrals set signup_count = signup_count + 1 where id = ?`, [ref.id]);
        }
      } catch (e) {
        console.error("[referral] attribution failed", (e as Error)?.message);
      }
    }
    return { ok: true };
  });

export const login = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    await appContext();
    const row = await q1<{ id: string; password_hash: string; is_banned: number }>(
      `select id, password_hash, is_banned from users where email = ?`,
      [data.email.toLowerCase().trim()],
    );
    if (!row || !verifyPassword(data.password, row.password_hash))
      fail("Invalid email or password.");
    if (row!.is_banned) fail("This account has been banned. Contact support.");
    await createSession(row!.id);
    await audit(row!.id, "user.login", "user", row!.id);
    return { ok: true };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  await appContext();
  await destroySession();
  return { ok: true };
});

export const updateProfile = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      vacation_mode: z.boolean().optional(),
      currentPassword: z.string().optional(),
      newPassword: z.string().min(8).max(100).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    if (data.vacation_mode !== undefined) {
      await run(`update users set vacation_mode = ? where id = ?`, [
        data.vacation_mode ? 1 : 0,
        user.id,
      ]);
    }
    if (data.newPassword) {
      const row = (await q1<{ password_hash: string }>(
        `select password_hash from users where id = ?`,
        [user.id],
      ))!;
      if (!data.currentPassword || !verifyPassword(data.currentPassword, row.password_hash))
        fail("Current password is incorrect.");
      await run(`update users set password_hash = ? where id = ?`, [
        hashPassword(data.newPassword),
        user.id,
      ]);
      await audit(user.id, "user.password_change", "user", user.id);
    }
    return { ok: true };
  });
