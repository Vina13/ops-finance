import { describe, expect, it } from "vitest";
import { TOKEN_PREFIX } from "../../src/auth/apiToken";
import { hashPassword, sha256Hex, timingSafeEqual, verifyPassword } from "../../src/lib/crypto";
import { seedUsers, makeToken } from "../helpers";

describe("crypto", () => {
  it("hash password PBKDF2 bisa diverifikasi dan menolak password salah", async () => {
    const { hash, salt } = await hashPassword("password-benar-123");
    expect(hash).toMatch(/^pbkdf2_sha256\$100000\$[0-9a-f]{64}$/);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(await verifyPassword("password-benar-123", hash, salt)).toBe(true);
    expect(await verifyPassword("password-salah-123", hash, salt)).toBe(false);
  });

  it("salt acak membuat hash berbeda untuk password yang sama", async () => {
    const a = await hashPassword("sama-sama-123");
    const b = await hashPassword("sama-sama-123");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("menolak format hash yang tidak dikenal", async () => {
    expect(await verifyPassword("x", "md5$1$abc", "00")).toBe(false);
  });

  it("sha256Hex deterministik", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("timingSafeEqual", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("token API acak, unik, dan berformat opsf_<prefix>_<secret>", async () => {
    const { salesA } = await seedUsers();
    const a = await makeToken(salesA);
    const b = await makeToken(salesA);
    expect(a).not.toBe(b);
    expect(a.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(a).toMatch(/^opsf_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
  });
});
