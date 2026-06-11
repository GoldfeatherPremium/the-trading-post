import { randomBytes } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { db } from "./db.server";
import { fail, now } from "./core.server";

const SESSION_COOKIE = "xv_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  role: "buyer" | "seller" | "support" | "finance" | "admin";
  seller_status: "none" | "pending" | "approved" | "suspended" | "rejected";
  seller_level: number;
  rating: number;
  rating_count: number;
  total_sales: number;
  completion_rate: number;
  is_banned: number;
  wallet_frozen: number;
  vacation_mode: number;
  created_at: number;
}

export function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  db()
    .prepare(`insert into sessions (token, user_id, expires_at, created_at) values (?,?,?,?)`)
    .run(token, userId, now() + SESSION_TTL_MS, now());
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function destroySession() {
  const token = getCookie(SESSION_COOKIE);
  if (token) db().prepare(`delete from sessions where token = ?`).run(token);
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

export function currentUser(): SessionUser | null {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const row = db()
    .prepare(
      `select u.id, u.email, u.username, u.role, u.seller_status, u.seller_level, u.rating,
              u.rating_count, u.total_sales, u.completion_rate, u.is_banned, u.wallet_frozen,
              u.vacation_mode, u.created_at, s.expires_at
       from sessions s join users u on u.id = s.user_id where s.token = ?`,
    )
    .get(token) as (SessionUser & { expires_at: number }) | undefined;
  if (!row) return null;
  if (row.expires_at < now()) {
    db().prepare(`delete from sessions where token = ?`).run(token);
    return null;
  }
  if (row.is_banned) return null;
  const { expires_at: _drop, ...user } = row;
  return user as SessionUser;
}

export function requireUser(): SessionUser {
  const user = currentUser();
  if (!user) return fail("You must be signed in to do that.") as never;
  return user;
}

export function requireSeller(): SessionUser {
  const user = requireUser();
  if (user.seller_status !== "approved" && !isStaff(user)) {
    fail("Seller account required.");
  }
  return user;
}

export function isStaff(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "support" || user.role === "finance";
}

export function requireStaff(roles?: Array<SessionUser["role"]>): SessionUser {
  const user = requireUser();
  const allowed = roles ?? ["support", "finance", "admin"];
  if (user.role !== "admin" && !allowed.includes(user.role)) {
    fail("You don't have permission to do that.");
  }
  if (!isStaff(user)) fail("You don't have permission to do that.");
  return user;
}

export function requireAdmin(): SessionUser {
  const user = requireUser();
  if (user.role !== "admin") fail("Admin access required.");
  return user;
}
