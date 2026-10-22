import { describe, expect, it } from "vitest";
import type { Claim } from "../../src/claims";
import { apiFetch, makeClaim, makeToken, seedUsers, validClaim } from "../helpers";

describe("API klaim /api/claims", () => {
  it("sales: buat, lihat, ubah, ajukan klaim lewat API", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA);

    const created = await apiFetch("/claims", token, { method: "POST", json: validClaim() });
    expect(created.status).toBe(201);
    const claim = (await created.json()) as Claim;
    expect(claim).toMatchObject({ user_id: salesA.id, status: "draft", amount: 150_000, currency: "IDR" });

    const patched = await apiFetch(`/claims/${claim.id}`, token, { method: "PATCH", json: { amount: 175_000 } });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as Claim).amount).toBe(175_000);

    const submitted = await apiFetch(`/claims/${claim.id}/submit`, token, { method: "POST" });
    expect(submitted.status).toBe(200);
    expect(((await submitted.json()) as Claim).status).toBe("submitted");

    const detail = await apiFetch(`/claims/${claim.id}`, token);
    const body = (await detail.json()) as Claim & { events: { action: string }[]; attachments: unknown[] };
    expect(body.events.map((e) => e.action)).toEqual(["created", "updated", "submitted"]);
    expect(body.attachments).toEqual([]);

    const again = await apiFetch(`/claims/${claim.id}`, token, { method: "PATCH", json: { amount: 1 } });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "conflict" } });
  });

  it("sales: hapus draft → 204 lalu 404", async () => {
    const { admin, salesA } = await seedUsers();
    const token = await makeToken(salesA);
    const claim = await makeClaim(salesA, admin);
    expect((await apiFetch(`/claims/${claim.id}`, token, { method: "DELETE" })).status).toBe(204);
    expect((await apiFetch(`/claims/${claim.id}`, token)).status).toBe(404);
  });

  it("sales tidak bisa mengakses klaim sales lain lewat API", async () => {
    const { admin, salesA, salesB } = await seedUsers();
    const claim = await makeClaim(salesA, admin);
    const tokenB = await makeToken(salesB);
    expect((await apiFetch(`/claims/${claim.id}`, tokenB)).status).toBe(404);
    expect((await apiFetch(`/claims/${claim.id}`, tokenB, { method: "PATCH", json: { title: "x" } })).status).toBe(404);
    expect((await apiFetch(`/claims/${claim.id}`, tokenB, { method: "DELETE" })).status).toBe(404);
    const list = (await (await apiFetch("/claims", tokenB)).json()) as { items: Claim[] };
    expect(list.items).toEqual([]);
  });

  it("admin: CRUD klaim atas nama sales", async () => {
    const { admin, salesA } = await seedUsers();
    const token = await makeToken(admin);
    const missingOwner = await apiFetch("/claims", token, { method: "POST", json: validClaim() });
    expect(missingOwner.status).toBe(400);

    const res = await apiFetch("/claims", token, { method: "POST", json: validClaim({ user_id: salesA.id, submit: true }) });
    expect(res.status).toBe(201);
    const claim = (await res.json()) as Claim;
    expect(claim).toMatchObject({ user_id: salesA.id, created_by: admin.id, status: "submitted" });

    const patched = await apiFetch(`/claims/${claim.id}`, token, { method: "PATCH", json: { title: "Koreksi" } });
    expect(patched.status).toBe(200);
    expect((await apiFetch(`/claims/${claim.id}`, token, { method: "DELETE" })).status).toBe(204);
  });

  it("validasi body: nominal, tanggal, kategori, JSON rusak", async () => {
    const { salesA } = await seedUsers();
    const token = await makeToken(salesA);
    for (const bad of [
      validClaim({ amount: 0 }),
      validClaim({ amount: -1000 }),
      validClaim({ amount: "150000" as never }),
      validClaim({ expense_date: "01-10-2026" }),
      validClaim({ expense_date: "2026-13-01" }),
      validClaim({ category: "pesawat" as never }),
    ]) {
      const res = await apiFetch("/claims", token, { method: "POST", json: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "validation" } });
    }
    const broken = await apiFetch("/claims", token, {
      method: "POST",
      body: "{bukan json",
      headers: { "Content-Type": "application/json" },
    });
    expect(broken.status).toBe(400);
    const emptyPatch = await apiFetch("/claims/abc", token, { method: "PATCH", json: {} });
    expect(emptyPatch.status).toBe(400);
  });

  it("filter status, rentang tanggal, user_id (admin), dan paginasi", async () => {
    const { admin, salesA, salesB } = await seedUsers();
    const tokenA = await makeToken(salesA);
    for (let i = 1; i <= 3; i++) {
      await apiFetch("/claims", tokenA, {
        method: "POST",
        json: validClaim({ expense_date: `2026-10-0${i}`, submit: i === 3 }),
      });
    }
    await makeClaim(salesB, admin);
    const adminToken = await makeToken(admin, ["claims:read"]);

    const submitted = (await (await apiFetch("/claims?status=submitted", adminToken)).json()) as { items: Claim[] };
    expect(submitted.items).toHaveLength(1);

    const range = (await (await apiFetch("/claims?from=2026-10-02&to=2026-10-03", tokenA)).json()) as { items: Claim[] };
    expect(range.items.map((c) => c.expense_date).sort()).toEqual(["2026-10-02", "2026-10-03"]);

    const onlyB = (await (await apiFetch(`/claims?user_id=${salesB.id}`, adminToken)).json()) as { items: Claim[] };
    expect(onlyB.items.every((c) => c.user_id === salesB.id)).toBe(true);
    expect(onlyB.items).toHaveLength(1);

    const page1 = (await (await apiFetch("/claims?limit=2", tokenA)).json()) as { items: Claim[]; next_cursor: string };
    expect(page1.items).toHaveLength(2);
    const page2 = (await (
      await apiFetch(`/claims?limit=2&cursor=${encodeURIComponent(page1.next_cursor)}`, tokenA)
    ).json()) as { items: Claim[]; next_cursor: string | null };
    expect(page2.items).toHaveLength(1);
    expect(page2.next_cursor).toBeNull();

    expect((await apiFetch("/claims?status=unknown", tokenA)).status).toBe(400);
    expect((await apiFetch("/claims?limit=1000", tokenA)).status).toBe(400);
  });

  it("approve/reject/pay tidak tersedia lewat API (404), bahkan untuk admin", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin, ["submit"]);
    const token = await makeToken(admin);
    for (const action of ["approve", "reject", "pay"]) {
      const res = await apiFetch(`/claims/${claim.id}/${action}`, token, { method: "POST" });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
    }
  });

  it("endpoint tak dikenal tanpa token → 401, bukan redirect login", async () => {
    const res = await apiFetch("/tidak-ada", undefined);
    expect(res.status).toBe(401);
  });
});
