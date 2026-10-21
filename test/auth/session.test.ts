import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/crypto";
import { MAX_LOGIN_ATTEMPTS } from "../../src/services/users";
import { count, insertUser, loginCookie, PASSWORD, seedUsers, webGet, webPost } from "../helpers";

function sidFrom(res: Response): string {
  const cookie = res.headers.get("Set-Cookie") ?? "";
  const match = /sid=([^;]+)/.exec(cookie);
  if (!match?.[1]) throw new Error(`Tidak ada cookie sid: ${cookie}`);
  return match[1];
}

describe("login web", () => {
  it("login sukses memasang cookie sesi aman dan hanya hash yang disimpan di DB", async () => {
    await seedUsers();
    const res = await webPost("/login", undefined, { email: "Sales.A@ops.test", password: PASSWORD });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/claims");
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const sid = sidFrom(res);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE id = ?", sid)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE id = ?", await sha256Hex(sid))).toBe(1);

    const page = await webGet("/claims", `sid=${sid}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Klaim saya");
  });

  it("redirect ke parameter next hanya untuk path lokal", async () => {
    await seedUsers();
    const ok = await webPost("/login", undefined, { email: "admin@ops.test", password: PASSWORD, next: "/admin/users" });
    expect(ok.headers.get("Location")).toBe("/admin/users");
    const evil = await webPost("/login", undefined, { email: "admin@ops.test", password: PASSWORD, next: "//evil.example" });
    expect(evil.headers.get("Location")).toBe("/claims");
  });

  it("password salah ditolak tanpa cookie", async () => {
    await seedUsers();
    const res = await webPost("/login", undefined, { email: "sales.a@ops.test", password: "salah-salah-123" });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(await res.text()).toContain("Email atau password salah");
  });

  it("user nonaktif tidak bisa login", async () => {
    await insertUser("off@ops.test", "sales", { active: false });
    const res = await webPost("/login", undefined, { email: "off@ops.test", password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("percobaan login dibatasi per email", async () => {
    await seedUsers();
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      await webPost("/login", undefined, { email: "sales.a@ops.test", password: "salah-salah-123" });
    }
    const res = await webPost("/login", undefined, { email: "sales.a@ops.test", password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it("halaman terproteksi tanpa sesi diarahkan ke /login", async () => {
    const res = await webGet("/claims");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login?next=%2Fclaims");
  });

  it("sesi kedaluwarsa ditolak", async () => {
    const { salesA } = await seedUsers();
    const cookie = await loginCookie(salesA);
    await env.DB.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    const res = await webGet("/claims", cookie);
    expect(res.status).toBe(302);
  });

  it("sesi user yang dinonaktifkan langsung tidak berlaku", async () => {
    const { salesA } = await seedUsers();
    const cookie = await loginCookie(salesA);
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?").bind(salesA.id).run();
    expect((await webGet("/claims", cookie)).status).toBe(302);
  });

  it("logout menghapus sesi", async () => {
    const { salesA } = await seedUsers();
    const cookie = await loginCookie(salesA);
    const res = await webPost("/logout", cookie, {});
    expect(res.status).toBe(302);
    expect(await count("SELECT COUNT(*) AS n FROM sessions")).toBe(0);
    expect((await webGet("/claims", cookie)).status).toBe(302);
  });
});
