import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes, sha256Hex, toBase64Url } from "../lib/crypto";
import { nowIso } from "../lib/ids";
import type { User } from "../types";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Membuat sesi baru dan mengembalikan token mentah untuk cookie. DB hanya menyimpan hash-nya. */
export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = toBase64Url(randomBytes(32));
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, expiresAt, nowIso())
    .run();
  return token;
}

export async function getSessionUser(db: D1Database, token: string): Promise<User | null> {
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.is_active, u.created_at, u.updated_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1`,
    )
    .bind(await sha256Hex(token), nowIso())
    .first<User>();
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}
