import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/crypto";
import { apiFetch, count, loginCookie, makeToken, seedUsers, validClaim } from "../helpers";

describe("autentikasi token API", () => {
  it("tanpa header Authorization → 401 dengan WWW-Authenticate", async () => {
    const res = await apiFetch("/me", undefined);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("token salah → 401", async () => {
    await seedUsers();
    expect((await apiFetch("/me", "opsf_deadbeef_bukan-token-asli")).status).toBe(401);
    expect((await apiFetch("/me", "bukan-format-opsf")).status).toBe(401);
  });

  it("token valid → 200 dan /me berisi role serta scope", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA, ["claims:read"]);
    const res = await apiFetch("/me", token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: salesA.id,
      email: salesA.email,
      name: salesA.name,
      role: "sales",
      scopes: ["claims:read"],
    });
  });

  it("DB hanya menyimpan hash token, bukan plaintext", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA);
    const row = await env.DB.prepare("SELECT * FROM api_tokens").first<Record<string, unknown>>();
    expect(Object.values(row!)).not.toContain(token);
    expect(row!.token_hash).toBe(await sha256Hex(token));
  });

  it("token dicabut → 401", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA);
    await env.DB.prepare("UPDATE api_tokens SET revoked_at = ?").bind(new Date().toISOString()).run();
    expect((await apiFetch("/me", token)).status).toBe(401);
  });

  it("token kedaluwarsa → 401", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA, ["claims:read"], 30);
    await env.DB.prepare("UPDATE api_tokens SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await apiFetch("/me", token)).status).toBe(401);
  });

  it("token milik user nonaktif → 401", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA);
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?").bind(salesA.id).run();
    expect((await apiFetch("/me", token)).status).toBe(401);
  });

  it("scope claims:read saja tidak bisa menulis → 403 invalid_scope", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA, ["claims:read"]);
    expect((await apiFetch("/claims", token)).status).toBe(200);
    const res = await apiFetch("/claims", token, { method: "POST", json: validClaim() });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_scope" } });
    expect(await count("SELECT COUNT(*) AS n FROM claims")).toBe(0);
  });

  it("scope claims:write saja tidak bisa membaca", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA, ["claims:write"]);
    expect((await apiFetch("/claims", token)).status).toBe(403);
  });

  it("cookie sesi web tidak berlaku di /api", async () => {
    const { salesA } = await seedUsers();
    const cookie = await loginCookie(salesA);
    const res = await apiFetch("/claims", undefined, { headers: { Cookie: cookie } });
    expect(res.status).toBe(401);
  });

  it("last_used_at terisi setelah token dipakai", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA);
    await apiFetch("/me", token);
    const used = await env.DB.prepare("SELECT last_used_at FROM api_tokens").first<string | null>("last_used_at");
    expect(used).not.toBeNull();
  });
});
