import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createApiToken } from "../src/auth/apiToken";
import { createSession, SESSION_COOKIE } from "../src/auth/session";
import app from "../src/index";
import { hashPassword } from "../src/lib/crypto";
import { nowIso } from "../src/lib/ids";
import { createClaim, type ClaimCreateInput, type TransitionAction, transitionClaim } from "../src/claims";
import type { Role, Scope, User } from "../src/types";

export const BASE = "https://ops.test";
export const PASSWORD = "rahasia-123456";

// PBKDF2 100k iterasi cukup lambat; hash dihitung sekali lalu dipakai ulang untuk semua user test.
let passwordHash: Promise<{ hash: string; salt: string }> | undefined;

export async function insertUser(
  email: string,
  role: Role,
  opts: { name?: string; active?: boolean } = {},
): Promise<User> {
  passwordHash ??= hashPassword(PASSWORD);
  const { hash, salt } = await passwordHash;
  const now = nowIso();
  const user: User = {
    id: crypto.randomUUID(),
    email,
    name: opts.name ?? email.split("@")[0]!,
    role,
    is_active: opts.active === false ? 0 : 1,
    created_at: now,
    updated_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, password_salt, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(user.id, email, user.name, role, hash, salt, user.is_active, now, now)
    .run();
  return user;
}

export async function seedUsers() {
  return {
    admin: await insertUser("admin@ops.test", "admin", { name: "Admin" }),
    salesA: await insertUser("sales.a@ops.test", "sales", { name: "Sales A" }),
    salesB: await insertUser("sales.b@ops.test", "sales", { name: "Sales B" }),
  };
}

export const validClaim = (overrides: Partial<ClaimCreateInput> = {}): ClaimCreateInput => ({
  title: "Taksi ke klien",
  category: "transport",
  expense_date: "2026-10-01",
  amount: 150_000,
  description: "PP kantor - klien",
  ...overrides,
});

/** Membuat klaim milik `owner` lalu menjalankan transisi berurutan sebagai admin/owner sesuai kebutuhan. */
export async function makeClaim(owner: User, admin: User, path: TransitionAction[] = []) {
  let claim = await createClaim(env.DB, owner, validClaim());
  for (const action of path) {
    const actor = action === "submit" ? owner : admin;
    claim = await transitionClaim(env.DB, actor, claim.id, action, action === "reject" ? "Tidak ada bukti" : undefined);
  }
  return claim;
}

/** Memanggil Worker dan menunggu semua waitUntil selesai, supaya tidak bocor ke reset() antar test. */
export async function fetchApp(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`${BASE}${path}`, { redirect: "manual", ...init }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export async function loginCookie(user: User): Promise<string> {
  return `${SESSION_COOKIE}=${await createSession(env.DB, user.id)}`;
}

export function webGet(path: string, cookie?: string): Promise<Response> {
  return fetchApp(path, { headers: cookie ? { Cookie: cookie } : {} });
}

/** POST form seperti browser dari origin aplikasi sendiri (lolos CSRF). */
export function webPost(
  path: string,
  cookie: string | undefined,
  fields: Record<string, string | string[]> | FormData,
  headers: Record<string, string> = { Origin: BASE },
): Promise<Response> {
  let body: URLSearchParams | FormData;
  if (fields instanceof FormData) {
    body = fields;
  } else {
    body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) for (const item of [v].flat()) body.append(k, item);
  }
  return fetchApp(path, { method: "POST", body, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) } });
}

export async function makeToken(
  user: User,
  scopes: Scope[] = ["claims:read", "claims:write"],
  expiresInDays?: number,
): Promise<string> {
  const { token } = await createApiToken(env.DB, user.id, { name: "test", scopes, expires_in_days: expiresInDays });
  return token;
}

export function apiFetch(
  path: string,
  token: string | undefined,
  init: { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  return fetchApp(`/api${path}`, { method: init.method ?? "GET", headers, body });
}

export function pdfFile(name = "kwitansi.pdf", size = 1024, type = "application/pdf"): File {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-1.4\n"));
  return new File([bytes], name, { type });
}

export async function count(sql: string, ...params: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...params).first<number>("n")) ?? 0;
}
