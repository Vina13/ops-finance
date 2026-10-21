import { z } from "zod";
import { randomBytes, sha256Hex, toBase64Url, toHex } from "../lib/crypto";
import { notFound } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { SCOPES, type Scope, type User } from "../types";

export const TOKEN_PREFIX = "opsf_";
const TOUCH_INTERVAL_MS = 60 * 1000;

export const tokenInputSchema = z.object({
  name: z.string().trim().min(1, "Nama token wajib diisi").max(100),
  scopes: z.array(z.enum(SCOPES)).min(1, "Pilih minimal satu scope"),
  expires_in_days: z.number().int().min(1).max(365).optional(),
});
export type TokenInput = z.infer<typeof tokenInputSchema>;

export interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  scopes: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function parseScopes(raw: string): Scope[] {
  return raw.split(" ").filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
}

/** Membuat token baru. Nilai `token` hanya dikembalikan sekali di sini dan tidak disimpan. */
export async function createApiToken(
  db: D1Database,
  userId: string,
  input: TokenInput,
): Promise<{ token: string; row: ApiTokenRow }> {
  const prefix = toHex(randomBytes(4));
  const token = `${TOKEN_PREFIX}${prefix}_${toBase64Url(randomBytes(32))}`;
  const row: ApiTokenRow = {
    id: newId(),
    user_id: userId,
    name: input.name,
    token_prefix: prefix,
    scopes: [...new Set(input.scopes)].join(" "),
    expires_at: input.expires_in_days
      ? new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString()
      : null,
    last_used_at: null,
    revoked_at: null,
    created_at: nowIso(),
  };
  await db
    .prepare(
      `INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, scopes, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, userId, row.name, prefix, await sha256Hex(token), row.scopes, row.expires_at, row.created_at)
    .run();
  return { token, row };
}

export interface VerifiedToken {
  tokenId: string;
  lastUsedAt: string | null;
  user: User;
  scopes: Scope[];
}

type TokenUserRow = User & { token_id: string; scopes: string; last_used_at: string | null };

export async function verifyApiToken(db: D1Database, token: string): Promise<VerifiedToken | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = await db
    .prepare(
      `SELECT t.id AS token_id, t.scopes, t.last_used_at,
              u.id, u.email, u.name, u.role, u.is_active, u.created_at, u.updated_at
       FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL
         AND (t.expires_at IS NULL OR t.expires_at > ?) AND u.is_active = 1`,
    )
    .bind(await sha256Hex(token), nowIso())
    .first<TokenUserRow>();
  if (!row) return null;
  const { token_id, scopes, last_used_at, ...user } = row;
  return { tokenId: token_id, lastUsedAt: last_used_at, user, scopes: parseScopes(scopes) };
}

/** Memperbarui last_used_at paling sering sekali per menit. */
export async function touchApiToken(db: D1Database, tokenId: string, lastUsedAt: string | null): Promise<void> {
  if (lastUsedAt && Date.now() - Date.parse(lastUsedAt) < TOUCH_INTERVAL_MS) return;
  await db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(nowIso(), tokenId).run();
}

export async function listApiTokens(db: D1Database, userId: string): Promise<ApiTokenRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at
       FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<ApiTokenRow>();
  return results;
}

/** Hanya pemilik yang bisa mencabut tokennya sendiri. */
export async function revokeApiToken(db: D1Database, userId: string, tokenId: string): Promise<void> {
  const res = await db
    .prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(nowIso(), tokenId, userId)
    .run();
  if (res.meta.changes === 0) throw notFound("Token");
}
