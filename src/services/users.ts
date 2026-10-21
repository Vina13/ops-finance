import { z } from "zod";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { AppError, conflict, notFound, validation } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import type { Role, User } from "../types";

const USER_COLUMNS = "id, email, name, role, is_active, created_at, updated_at";

export const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const passwordSchema = z.string().min(10, "Password minimal 10 karakter").max(200);

export const userInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email tidak valid"),
  name: z.string().trim().min(1, "Nama wajib diisi").max(100),
  role: z.enum(["admin", "sales"]),
  password: passwordSchema,
});
export type UserInput = z.infer<typeof userInputSchema>;

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(100),
  role: z.enum(["admin", "sales"]),
  is_active: z.boolean(),
  /** Kosong = password tidak diubah. */
  password: passwordSchema.optional(),
});
export type UserUpdate = z.infer<typeof userUpdateSchema>;

export async function listUsers(db: D1Database, role?: Role): Promise<User[]> {
  const sql = `SELECT ${USER_COLUMNS} FROM users ${role ? "WHERE role = ?" : ""} ORDER BY name`;
  const stmt = role ? db.prepare(sql).bind(role) : db.prepare(sql);
  return (await stmt.all<User>()).results;
}

export async function getUser(db: D1Database, id: string): Promise<User> {
  const user = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<User>();
  if (!user) throw notFound("User");
  return user;
}

export async function createUser(db: D1Database, input: UserInput): Promise<User> {
  const exists = await db.prepare("SELECT 1 FROM users WHERE email = ?").bind(input.email).first();
  if (exists) throw conflict("Email sudah terdaftar");
  const { hash, salt } = await hashPassword(input.password);
  const now = nowIso();
  const id = newId();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, role, password_hash, password_salt, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, input.email, input.name, input.role, hash, salt, now, now)
    .run();
  return getUser(db, id);
}

export async function updateUser(db: D1Database, actorId: string, id: string, input: UserUpdate): Promise<User> {
  const current = await getUser(db, id);
  if (id === actorId && (input.role !== current.role || !input.is_active)) {
    throw validation("Tidak bisa mengubah role atau menonaktifkan akun sendiri");
  }
  const now = nowIso();
  const stmts = [
    db
      .prepare("UPDATE users SET name = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?")
      .bind(input.name, input.role, input.is_active ? 1 : 0, now, id),
  ];
  if (input.password) {
    const { hash, salt } = await hashPassword(input.password);
    stmts.push(
      db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, id),
    );
  }
  // Nonaktif atau password direset: semua sesi web user itu dihapus.
  if (!input.is_active || input.password) {
    stmts.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  }
  await db.batch(stmts);
  return getUser(db, id);
}

export async function changePassword(
  db: D1Database,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const row = await db
    .prepare("SELECT password_hash, password_salt FROM users WHERE id = ?")
    .bind(userId)
    .first<{ password_hash: string; password_salt: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash, row.password_salt))) {
    throw validation("Password lama salah");
  }
  const parsed = passwordSchema.safeParse(newPassword);
  if (!parsed.success) throw validation(parsed.error.issues[0]?.message ?? "Password baru tidak valid");
  const { hash, salt } = await hashPassword(parsed.data);
  await db
    .prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
    .bind(hash, salt, nowIso(), userId)
    .run();
}

function loginWindowStart(now = Date.now()): string {
  return new Date(Math.floor(now / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS).toISOString();
}

type UserWithPassword = User & { password_hash: string; password_salt: string };

/** Mengembalikan user aktif jika email dan password cocok; gagal login dihitung per email. */
export async function authenticate(db: D1Database, rawEmail: string, password: string): Promise<User> {
  const email = rawEmail.trim().toLowerCase();
  const windowStart = loginWindowStart();
  const attempts = await db
    .prepare("SELECT count FROM login_attempts WHERE email = ? AND window_start = ?")
    .bind(email, windowStart)
    .first<number>("count");
  if ((attempts ?? 0) >= MAX_LOGIN_ATTEMPTS) {
    throw new AppError(429, "rate_limited", "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.");
  }

  const row = await db
    .prepare(`SELECT ${USER_COLUMNS}, password_hash, password_salt FROM users WHERE email = ?`)
    .bind(email)
    .first<UserWithPassword>();
  const ok =
    row !== null && row.is_active === 1 && (await verifyPassword(password, row.password_hash, row.password_salt));
  if (!row || !ok) {
    await db
      .prepare(
        `INSERT INTO login_attempts (email, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT (email, window_start) DO UPDATE SET count = count + 1`,
      )
      .bind(email, windowStart)
      .run();
    throw new AppError(401, "unauthorized", "Email atau password salah");
  }
  const { password_hash: _hash, password_salt: _salt, ...user } = row;
  return user;
}
