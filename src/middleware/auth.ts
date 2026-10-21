import { createMiddleware } from "hono/factory";
import { touchApiToken, verifyApiToken } from "../auth/apiToken";
import { getSessionUser, readSessionCookie } from "../auth/session";
import { AppError, forbidden } from "../lib/errors";
import type { AppEnv, Role, Scope } from "../types";

/** Web: wajib login lewat cookie sesi, kalau tidak diarahkan ke /login. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = readSessionCookie(c);
  const user = token ? await getSessionUser(c.env.DB, token) : null;
  if (!user) {
    const query = c.req.method === "GET" ? `?next=${encodeURIComponent(new URL(c.req.url).pathname)}` : "";
    return c.redirect(`/login${query}`);
  }
  c.set("user", user);
  c.set("scopes", []);
  await next();
});

export const requireRole = (role: Role) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.get("user").role !== role) throw forbidden();
    await next();
  });

/** API: wajib header `Authorization: Bearer opsf_...`. Cookie sesi tidak berlaku di sini. */
export const requireToken = createMiddleware<AppEnv>(async (c, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "");
  const verified = match?.[1] ? await verifyApiToken(c.env.DB, match[1]) : null;
  if (!verified) {
    c.header("WWW-Authenticate", 'Bearer realm="ops-finance"');
    throw new AppError(401, "unauthorized", "Token tidak valid, dicabut, atau kedaluwarsa");
  }
  c.set("user", verified.user);
  c.set("scopes", verified.scopes);
  c.executionCtx.waitUntil(touchApiToken(c.env.DB, verified.tokenId, verified.lastUsedAt));
  await next();
});

export const requireScope = (scope: Scope) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!c.get("scopes").includes(scope)) {
      throw new AppError(403, "invalid_scope", `Token tidak punya scope ${scope}`);
    }
    await next();
  });
