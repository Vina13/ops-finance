#!/usr/bin/env node
// Membuat file SQL untuk admin pertama. Password di-hash di sini (PBKDF2-SHA256, 100k iterasi)
// dengan format yang sama seperti src/lib/crypto.ts; plaintext tidak ditulis ke file.
//
// Pakai:
//   npm run create-admin -- --email admin@contoh.co.id --name "Admin Ops"
//   npx wrangler d1 execute ops-finance --local --file .wrangler/create-admin.sql
// (ganti --local dengan --remote untuk database di Cloudflare)
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { webcrypto as crypto } from "node:crypto";
import { parseArgs } from "node:util";

const ITERATIONS = 100_000;

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, out: { type: "string" } },
});
if (!values.email || !values.name) {
  console.error('Pakai: npm run create-admin -- --email <email> --name "<nama>"');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const password = process.env.ADMIN_PASSWORD ?? (await askHidden("Password admin (min. 10 karakter): "));
if (password.length < 10) {
  console.error("Password minimal 10 karakter.");
  process.exit(1);
}

const toHex = (bytes) => Buffer.from(bytes).toString("hex");
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const now = new Date().toISOString();
const sql = `INSERT INTO users (id, email, name, role, password_hash, password_salt, is_active, created_at, updated_at)
VALUES (${q(crypto.randomUUID())}, ${q(values.email.trim().toLowerCase())}, ${q(values.name.trim())}, 'admin',
        ${q(`pbkdf2_sha256$${ITERATIONS}$${toHex(new Uint8Array(bits))}`)}, ${q(toHex(salt))}, 1, ${q(now)}, ${q(now)});
`;

const out = values.out ?? ".wrangler/create-admin.sql";
mkdirSync(".wrangler", { recursive: true });
writeFileSync(out, sql);
console.log(`SQL ditulis ke ${out}. Jalankan:`);
console.log(`  npx wrangler d1 execute ops-finance --local --file ${out}`);
