import { Hono } from "hono";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  getSessionUser,
  readSessionCookie,
  setSessionCookie,
} from "../../auth/session";
import { AppError } from "../../lib/errors";
import { authenticate } from "../../services/users";
import type { AppEnv } from "../../types";
import { LoginPage } from "../../views/pages";
import { readForm, str } from "./form";

export const authRoutes = new Hono<AppEnv>();

/**
 * Hanya path lokal yang boleh jadi tujuan redirect setelah login. Karakter kontrol/spasi/backslash
 * ditolak karena browser membuang tab/newline saat parsing ("/\t/evil.com" menjadi "//evil.com").
 */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || /[\x00-\x20\\]/.test(next)) return "/claims";
  const base = "http://local.invalid";
  const url = new URL(next, base);
  return url.origin === base ? `${url.pathname}${url.search}` : "/claims";
}

authRoutes.get("/login", async (c) => {
  const token = readSessionCookie(c);
  if (token && (await getSessionUser(c.env.DB, token))) return c.redirect("/claims");
  return c.html(<LoginPage next={c.req.query("next")} />);
});

authRoutes.post("/login", async (c) => {
  const body = await readForm(c);
  const email = str(body, "email");
  const next = str(body, "next");
  try {
    const user = await authenticate(c.env.DB, email, str(body, "password"));
    setSessionCookie(c, await createSession(c.env.DB, user.id));
    return c.redirect(safeNext(next));
  } catch (err) {
    if (err instanceof AppError && (err.code === "unauthorized" || err.code === "rate_limited")) {
      return c.html(<LoginPage email={email} next={next} error={err.message} />, err.status);
    }
    throw err;
  }
});

authRoutes.post("/logout", async (c) => {
  const token = readSessionCookie(c);
  if (token) await deleteSession(c.env.DB, token);
  clearSessionCookie(c);
  return c.redirect("/login");
});
