// Test karakterisasi (TRD R0): mengunci body error dan angka yang harus identik selama refactoring src/claims.
import { describe, expect, it } from "vitest";
import { apiFetch, makeClaim, makeToken, seedUsers, validClaim } from "../helpers";

describe("karakterisasi API klaim", () => {
  it("submit dua kali → 409 dengan body error persis", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin, ["submit"]);
    const res = await apiFetch(`/claims/${claim.id}/submit`, await makeToken(salesA), { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "conflict", message: "Klaim berstatus Diajukan tidak bisa di-submit" },
    });
  });

  it("PATCH klaim submitted oleh sales → 409 dengan pesan persis", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin, ["submit"]);
    const res = await apiFetch(`/claims/${claim.id}`, await makeToken(salesA), { method: "PATCH", json: { amount: 1 } });
    expect(await res.json()).toEqual({
      error: { code: "conflict", message: "Klaim berstatus Diajukan tidak bisa diubah" },
    });
  });

  it("klaim tidak ada → 404 dengan pesan persis", async () => {
    const { salesA } = await seedUsers();
    const res = await apiFetch("/claims/tidak-ada", await makeToken(salesA));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Klaim tidak ditemukan" } });
  });

  it("validasi → 400 dengan details per field", async () => {
    const { salesA } = await seedUsers();
    const res = await apiFetch("/claims", await makeToken(salesA), {
      method: "POST",
      json: validClaim({ amount: 0, category: "pesawat" as never }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "validation",
        message: "Data klaim tidak valid",
        details: { category: ["Kategori tidak dikenal"], amount: ["Nominal harus lebih dari 0"] },
      },
    });
  });

  it("total_amount mengikuti filter status, bukan halaman", async () => {
    const { admin, salesA } = await seedUsers();
    const token = await makeToken(salesA);
    for (const amount of [1000, 2000, 3000]) {
      await apiFetch("/claims", token, { method: "POST", json: validClaim({ amount, submit: true }) });
    }
    await apiFetch("/claims", token, { method: "POST", json: validClaim({ amount: 50_000 }) }); // draft
    await makeClaim(salesA, admin); // draft 150.000
    const res = (await (await apiFetch("/claims?status=submitted&limit=1", token)).json()) as {
      items: unknown[];
      total_amount: number;
      next_cursor: string | null;
    };
    expect(res.items).toHaveLength(1);
    expect(res.total_amount).toBe(6000);
    expect(res.next_cursor).not.toBeNull();
  });

  it("bentuk objek klaim di respons API tidak berubah", async () => {
    const { salesA } = await seedUsers();
    const res = await apiFetch("/claims", await makeToken(salesA), { method: "POST", json: validClaim() });
    expect(Object.keys((await res.json()) as object).sort()).toEqual(
      [
        "amount",
        "attachment_count",
        "category",
        "created_at",
        "created_by",
        "currency",
        "decided_at",
        "decided_by",
        "decision_note",
        "description",
        "expense_date",
        "id",
        "owner_email",
        "owner_name",
        "paid_at",
        "status",
        "submitted_at",
        "title",
        "updated_at",
        "user_id",
      ].sort(),
    );
  });
});
