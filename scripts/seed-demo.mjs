#!/usr/bin/env node
// Data demo untuk lab (dummy). MENGHAPUS semua data di D1 lokal, lalu mengisi:
//   - Dewi (Finance)  admin  dewi@ops.local
//   - Rina (Sales JKT) sales rina@ops.local  → klaim Taksi Biru (approved), Resto Padang Sederhana (submitted)
//   - Budi (Sales BDG) sales budi@ops.local  → klaim Hotel Dago Indah (submitted)
// Semua akun memakai password dari env DEMO_PASSWORD (min. 10 karakter); tidak ada password di repo.
//
// Pakai (PowerShell):
//   $env:DEMO_PASSWORD = "<password-lab>"; npm run db:seed
import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const ITERATIONS = 100_000; // sama dengan src/lib/crypto.ts
const password = process.env.DEMO_PASSWORD ?? "";
if (password.length < 10) {
  console.error("Set env DEMO_PASSWORD (min. 10 karakter) dulu.");
  process.exit(1);
}

const toHex = (bytes) => Buffer.from(bytes).toString("hex");
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return { hash: `pbkdf2_sha256$${ITERATIONS}$${toHex(new Uint8Array(bits))}`, salt: toHex(salt) };
}

const q = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const id = () => crypto.randomUUID();

const users = {
  dewi: { id: id(), email: "dewi@ops.local", name: "Dewi (Finance)", role: "admin" },
  rina: { id: id(), email: "rina@ops.local", name: "Rina (Sales JKT)", role: "sales" },
  budi: { id: id(), email: "budi@ops.local", name: "Budi (Sales BDG)", role: "sales" },
};

// [pemilik, tanggal, kategori, judul/merchant, nominal, status, catatan]
const claims = [
  ["rina", "2026-10-14", "transport", "Taksi Biru", 85_000, "approved", "Ke kantor klien Bank A"],
  ["rina", "2026-10-15", "meal", "Resto Padang Sederhana", 420_000, "submitted", "Makan siang tim + klien"],
  ["budi", "2026-10-16", "lodging", "Hotel Dago Indah", 650_000, "submitted", "Kunjungan cabang Bandung"],
];

const lines = [
  "DELETE FROM claim_events;",
  "DELETE FROM claim_attachments;",
  "DELETE FROM claims;",
  "DELETE FROM api_tokens;",
  "DELETE FROM sessions;",
  "DELETE FROM login_attempts;",
  "DELETE FROM users;",
];

for (const u of Object.values(users)) {
  const { hash, salt } = await hashPassword(password);
  const now = new Date().toISOString();
  lines.push(
    `INSERT INTO users (id, email, name, role, password_hash, password_salt, is_active, created_at, updated_at) VALUES (${[
      u.id, u.email, u.name, u.role, hash, salt, 1, now, now,
    ].map(q).join(", ")});`,
  );
}

for (const [owner, date, category, title, amount, status, note] of claims) {
  const claimId = id();
  const userId = users[owner].id;
  const created = `${date}T09:00:00.000Z`;
  const submitted = `${date}T09:05:00.000Z`;
  const decided = status === "approved" ? `${date}T15:00:00.000Z` : null;
  lines.push(
    `INSERT INTO claims (id, user_id, title, category, expense_date, amount, description, status, submitted_at, decided_by, decided_at, created_by, created_at, updated_at) VALUES (${[
      claimId, userId, title, category, date, amount, note, status, submitted,
      decided ? users.dewi.id : null, decided, userId, created, decided ?? submitted,
    ].map(q).join(", ")});`,
  );
  const events = [
    ["created", null, "draft", userId, created],
    ["submitted", "draft", "submitted", userId, submitted],
  ];
  if (decided) events.push(["approved", "submitted", "approved", users.dewi.id, decided]);
  for (const [action, from, to, actor, at] of events) {
    lines.push(
      `INSERT INTO claim_events (id, claim_id, actor_id, action, from_status, to_status, note, created_at) VALUES (${[
        id(), claimId, actor, action, from, to, null, at,
      ].map(q).join(", ")});`,
    );
  }
}

mkdirSync(".wrangler", { recursive: true });
const out = ".wrangler/seed-demo.sql";
writeFileSync(out, `${lines.join("\n")}\n`);
execFileSync("npx", ["wrangler", "d1", "execute", "ops-finance", "--local", "--file", out], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log("\nData demo siap. Login: dewi@ops.local (admin), rina@ops.local, budi@ops.local (sales).");
