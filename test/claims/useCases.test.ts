// Unit test use case klaim dengan repository in-memory: cepat, tanpa D1/Miniflare (TRD R3).
import { describe, expect, it } from "vitest";
import { createClaim, deleteClaim, transitionClaim, updateClaim } from "../../src/claims/application/commands";
import type { CreateClaimInput } from "../../src/claims/application/dto";
import { getClaim, getClaimDetail, listClaims } from "../../src/claims/application/queries";
import type { Actor } from "../../src/claims/domain/actor";
import { ClaimError } from "../../src/claims/domain/errors";
import { inMemoryClaims } from "./inMemoryClaimRepository";

const admin: Actor = { id: "admin", role: "admin" };
const rina: Actor = { id: "rina", role: "sales" };
const budi: Actor = { id: "budi", role: "sales" };

const input = (over: Partial<CreateClaimInput> = {}): CreateClaimInput => ({
  title: "Taksi",
  category: "transport",
  expense_date: "2026-10-01",
  amount: 100_000,
  description: "",
  submit: false,
  ...over,
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ClaimError);
  return (err as ClaimError).code;
}

describe("use case klaim (in-memory)", () => {
  it("sales membuat klaim milik sendiri; user_id diabaikan", async () => {
    const { deps } = inMemoryClaims(["rina", "budi"]);
    const claim = await createClaim(deps, rina, input({ user_id: "budi" }));
    expect(claim).toMatchObject({ user_id: "rina", created_by: "rina", status: "draft", submitted_at: null });
  });

  it("admin wajib memilih sales aktif", async () => {
    const { deps } = inMemoryClaims(["rina"]);
    expect(await codeOf(createClaim(deps, admin, input()))).toBe("validation");
    expect(await codeOf(createClaim(deps, admin, input({ user_id: "nonaktif" })))).toBe("validation");
    expect((await createClaim(deps, admin, input({ user_id: "rina" }))).user_id).toBe("rina");
  });

  it("submit langsung menulis event created + submitted", async () => {
    const { deps, events } = inMemoryClaims();
    const claim = await createClaim(deps, rina, input({ submit: true }));
    expect(claim.status).toBe("submitted");
    expect(events.map((e) => e.action)).toEqual(["created", "submitted"]);
  });

  it("klaim orang lain → not_found, bukan forbidden", async () => {
    const { deps } = inMemoryClaims();
    const claim = await createClaim(deps, rina, input());
    expect(await codeOf(getClaim(deps, budi, claim.id))).toBe("not_found");
    expect(await codeOf(updateClaim(deps, budi, claim.id, { amount: 1 }))).toBe("not_found");
    expect(await codeOf(deleteClaim(deps, budi, claim.id))).toBe("not_found");
    expect(await codeOf(transitionClaim(deps, budi, claim.id, "submit"))).toBe("not_found");
  });

  it("state machine lengkap dan transisi tidak valid", async () => {
    const { deps } = inMemoryClaims();
    const claim = await createClaim(deps, rina, input());
    expect(await codeOf(transitionClaim(deps, admin, claim.id, "approve"))).toBe("conflict");
    await transitionClaim(deps, rina, claim.id, "submit");
    expect(await codeOf(transitionClaim(deps, rina, claim.id, "approve"))).toBe("forbidden");
    expect(await codeOf(transitionClaim(deps, admin, claim.id, "reject", "  "))).toBe("validation");
    const approved = await transitionClaim(deps, admin, claim.id, "approve");
    expect(approved).toMatchObject({ status: "approved", decided_by: "admin", decision_note: null });
    const paid = await transitionClaim(deps, admin, claim.id, "pay");
    expect(paid.status).toBe("paid");
    expect(paid.paid_at).not.toBeNull();
    expect(await codeOf(deleteClaim(deps, admin, claim.id))).toBe("conflict");
  });

  it("aturan edit: sales hanya draft, admin draft/submitted", async () => {
    const { deps } = inMemoryClaims();
    const claim = await createClaim(deps, rina, input({ submit: true }));
    expect(await codeOf(updateClaim(deps, rina, claim.id, { amount: 1 }))).toBe("conflict");
    expect((await updateClaim(deps, admin, claim.id, { amount: 1 })).amount).toBe(1);
  });

  it("update mencatat field yang berubah", async () => {
    const { deps } = inMemoryClaims();
    const claim = await createClaim(deps, rina, input());
    await updateClaim(deps, rina, claim.id, { amount: 2, title: "Baru" });
    const { events } = await getClaimDetail(deps, rina, claim.id);
    expect(events.at(-1)).toMatchObject({ action: "updated", note: "Field: amount, title" });
  });

  it("update yang kalah balapan (status berubah) → conflict", async () => {
    const { deps, rows } = inMemoryClaims();
    const claim = await createClaim(deps, rina, input());
    const original = deps.claims.findById;
    // Simulasikan klaim berubah status di antara load dan update.
    deps.claims.findById = async (id) => {
      const c = await original(id);
      rows.get(id)!.status = "submitted";
      return c;
    };
    expect(await codeOf(updateClaim(deps, rina, claim.id, { amount: 5 }))).toBe("conflict");
  });

  it("listClaims memaksa user_id sales dan menghormati filter admin", async () => {
    const { deps } = inMemoryClaims(["rina", "budi"]);
    await createClaim(deps, rina, input());
    await createClaim(deps, budi, input({ amount: 7 }));
    const own = await listClaims(deps, rina, { user_id: "budi", limit: 50 });
    expect(own.items.map((c) => c.user_id)).toEqual(["rina"]);
    const all = await listClaims(deps, admin, { limit: 50 });
    expect(all.totalAmount).toBe(100_007);
    const onlyBudi = await listClaims(deps, admin, { user_id: "budi", limit: 50 });
    expect(onlyBudi.items.map((c) => c.user_id)).toEqual(["budi"]);
  });

  it("soft delete menyembunyikan klaim", async () => {
    const { deps } = inMemoryClaims();
    const claim = await createClaim(deps, rina, input());
    await deleteClaim(deps, rina, claim.id);
    expect(await codeOf(getClaim(deps, rina, claim.id))).toBe("not_found");
    expect((await listClaims(deps, admin, { limit: 50 })).items).toEqual([]);
  });
});
