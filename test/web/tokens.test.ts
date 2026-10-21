import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/crypto";
import { apiFetch, count, loginCookie, makeToken, seedUsers, webGet, webPost } from "../helpers";

function tokenFrom(html: string): string {
  const match = /opsf_[0-9a-f]{8}_[A-Za-z0-9_-]{43}/.exec(html);
  if (!match) throw new Error("Token tidak ada di halaman");
  return match[0];
}

describe("web: token API", () => {
  it("token baru ditampilkan sekali, tersimpan sebagai hash, dan bisa dipakai di API", async () => {
    const { salesA } = await seedUsers();
    const cookie = await loginCookie(salesA);
    const res = await webPost("/settings/tokens", cookie, {
      name: "Integrasi",
      scopes: ["claims:read", "claims:write"],
      expires_in_days: "90",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const token = tokenFrom(await res.text());

    const row = await env.DB.prepare("SELECT token_hash, scopes, expires_at FROM api_tokens").first<{
      token_hash: string;
      scopes: string;
      expires_at: string;
    }>();
    expect(row!.token_hash).toBe(await sha256Hex(token));
    expect(row!.scopes).toBe("claims:read claims:write");
    expect(row!.expires_at).not.toBeNull();

    const list = await (await webGet("/settings/tokens", cookie)).text();
    expect(list).not.toContain(token);
    expect(list).toContain(`opsf_${token.slice(5, 13)}_`);

    expect((await apiFetch("/me", token)).status).toBe(200);
  });

  it("token tanpa scope ditolak", async () => {
    const { salesA } = await seedUsers();
    const res = await webPost("/settings/tokens", await loginCookie(salesA), { name: "Kosong" });
    expect(res.status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM api_tokens")).toBe(0);
  });

  it("revoke membuat token langsung ditolak API", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA);
    const id = await env.DB.prepare("SELECT id FROM api_tokens").first<string>("id");
    expect((await apiFetch("/me", token)).status).toBe(200);
    const res = await webPost(`/settings/tokens/${id}/revoke`, await loginCookie(salesA), {});
    expect(res.status).toBe(302);
    expect((await apiFetch("/me", token)).status).toBe(401);
  });

  it("user tidak bisa mencabut token milik orang lain", async () => {
    const { salesA, salesB } = await seedUsers();
    const token = await makeToken(salesA);
    const id = await env.DB.prepare("SELECT id FROM api_tokens").first<string>("id");
    const res = await webPost(`/settings/tokens/${id}/revoke`, await loginCookie(salesB), {});
    expect(res.status).toBe(404);
    expect((await apiFetch("/me", token)).status).toBe(200);
  });

  it("token API tidak bisa dipakai untuk membuka halaman kelola token", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA);
    const res = await webGet("/settings/tokens", undefined);
    expect(res.status).toBe(302);
    const withBearer = await apiFetch("/../settings/tokens", token);
    expect([302, 401, 404]).toContain(withBearer.status);
  });
});
