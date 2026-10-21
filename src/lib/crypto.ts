const encoder = new TextEncoder();

/** Batas iterasi PBKDF2 yang didukung Workers runtime. */
export const PBKDF2_ITERATIONS = 100_000;
const HASH_SCHEME = "pbkdf2_sha256";

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

/** Perbandingan string dengan waktu konstan (untuk hash yang panjangnya sama). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/**
 * Menghasilkan `password_hash` berformat `pbkdf2_sha256$<iterasi>$<hex>` dan `password_salt` (hex).
 * Format ini juga dipakai scripts/create-admin.mjs; ubah keduanya bersamaan.
 */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { hash: `${HASH_SCHEME}$${PBKDF2_ITERATIONS}$${toHex(derived)}`, salt: toHex(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const [scheme, iterations, expected] = hash.split("$");
  if (scheme !== HASH_SCHEME || !iterations || !expected) return false;
  const derived = await pbkdf2(password, fromHex(salt), Number(iterations));
  return timingSafeEqual(toHex(derived), expected);
}
