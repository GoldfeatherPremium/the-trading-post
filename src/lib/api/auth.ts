import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "../server/db.server";
import { appContext } from "../server/app.server";
import { audit, fail, hashPassword, now, uid, verifyPassword } from "../server/core.server";
import { createSession, currentUser, destroySession, requireUser } from "../server/auth.server";

export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  const user = currentUser();
  if (!user) return { user: null, unreadNotifications: 0, unreadMessages: 0 };
  const unreadNotifications = (
    db()
      .prepare(`select count(*) c from notifications where user_id = ? and read_at is null`)
      .get(user.id) as { c: number }
  ).c;
  const unreadMessages = (
    db()
      .prepare(
        `select count(*) c from messages m join conversations cv on cv.id = m.conversation_id
         where m.created_at > case when cv.buyer_id = @id then cv.buyer_last_read_at else cv.seller_last_read_at end
           and (cv.buyer_id = @id or cv.seller_id = @id)
           and (m.sender_id is null or m.sender_id != @id)`,
      )
      .get({ id: user.id }) as { c: number }
  ).c;
  return { user, unreadNotifications, unreadMessages };
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
    }),
  )
  .handler(async ({ data }) => {
    appContext();
    const d = db();
    const email = data.email.toLowerCase().trim();
    if (d.prepare(`select 1 from users where email = ?`).get(email))
      fail("An account with that email already exists.");
    if (d.prepare(`select 1 from users where lower(username) = lower(?)`).get(data.username))
      fail("That username is taken.");
    const id = uid();
    d.prepare(
      `insert into users (id, email, username, password_hash, role, created_at) values (?,?,?,?, 'buyer', ?)`,
    ).run(id, email, data.username, hashPassword(data.password), now());
    d.prepare(`insert into wallets (user_id) values (?)`).run(id);
    createSession(id);
    audit(id, "user.register", "user", id);
    return { ok: true };
  });

export const login = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    appContext();
    const row = db()
      .prepare(`select id, password_hash, is_banned from users where email = ?`)
      .get(data.email.toLowerCase().trim()) as
      | { id: string; password_hash: string; is_banned: number }
      | undefined;
    if (!row || !verifyPassword(data.password, row.password_hash))
      fail("Invalid email or password.");
    if (row!.is_banned) fail("This account has been banned. Contact support.");
    createSession(row!.id);
    audit(row!.id, "user.login", "user", row!.id);
    return { ok: true };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  appContext();
  destroySession();
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
    appContext();
    const user = requireUser();
    const d = db();
    if (data.vacation_mode !== undefined) {
      d.prepare(`update users set vacation_mode = ? where id = ?`).run(
        data.vacation_mode ? 1 : 0,
        user.id,
      );
    }
    if (data.newPassword) {
      const row = d.prepare(`select password_hash from users where id = ?`).get(user.id) as {
        password_hash: string;
      };
      if (!data.currentPassword || !verifyPassword(data.currentPassword, row.password_hash))
        fail("Current password is incorrect.");
      d.prepare(`update users set password_hash = ? where id = ?`).run(
        hashPassword(data.newPassword),
        user.id,
      );
      audit(user.id, "user.password_change", "user", user.id);
    }
    return { ok: true };
  });
