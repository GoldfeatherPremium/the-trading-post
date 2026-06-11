import { randomBytes } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { q1, run } from "./db.server";
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

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await run(`insert into sessions (token, user_id, expires_at, created_at) values (?,?,?,?)`, [
    token,
    userId,
    now() + SESSION_TTL_MS,
    now(),
  ]);
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE);
  if (token) await run(`delete from sessions where token = ?`, [token]);
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const row = await q1<SessionUser & { expires_at: number }>(
    `select u.id, u.email, u.username, u.role, u.seller_status, u.seller_level, u.rating,
            u.rating_count, u.total_sales, u.completion_rate, u.is_banned, u.wallet_frozen,
            u.vacation_mode, u.created_at, s.expires_at
     from sessions s join users u on u.id = s.user_id where s.token = ?`,
    [token],
  );
  if (!row) return null;
  if (row.expires_at < now()) {
    await run(`delete from sessions where token = ?`, [token]);
    return null;
  }
  if (row.is_banned) return null;
  const { expires_at: _drop, ...user } = row;
  return user as SessionUser;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) return fail("You must be signed in to do that.") as never;
  return user;
}

export async function requireSeller(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.seller_status !== "approved" && !isStaff(user)) {
    fail("Seller account required.");
  }
  return user;
}

export function isStaff(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "support" || user.role === "finance";
}

export async function requireStaff(roles?: Array<SessionUser["role"]>): Promise<SessionUser> {
  const user = await requireUser();
  const allowed = roles ?? ["support", "finance", "admin"];
  if (user.role !== "admin" && !allowed.includes(user.role)) {
    fail("You don't have permission to do that.");
  }
  if (!isStaff(user)) fail("You don't have permission to do that.");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") fail("Admin access required.");
  return user;
}
