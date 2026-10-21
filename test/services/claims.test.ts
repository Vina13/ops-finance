import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors";
import {
  allowedTransitions,
  createClaim,
  deleteClaim,
  getClaim,
  getClaimDetail,
  listClaims,
  transitionClaim,
  updateClaim,
} from "../../src/services/claims";
import { count, insertUser, makeClaim, seedUsers, validClaim } from "../helpers";

async function expectAppError(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
  if (code) expect((err as AppError).code).toBe(code);
}

describe("aturan akses klaim", () => {
  it("sales membuat klaim miliknya sendiri; user_id kiriman diabaikan", async () => {
    const { salesA, salesB } = await seedUsers();
    const claim = await createClaim(env.DB, salesA, validClaim({ user_id: salesB.id }));
    expect(claim.user_id).toBe(salesA.id);
    expect(claim.status).toBe("draft");
    expect(claim.created_by).toBe(salesA.id);
  });

  it("sales bisa langsung mengajukan saat membuat klaim", async () => {
    const { salesA } = await seedUsers();
    const claim = await createClaim(env.DB, salesA, validClaim({ submit: true }));
    expect(claim.status).toBe("submitted");
    expect(claim.submitted_at).not.toBeNull();
  });

  it("sales tidak bisa melihat, mengubah, atau menghapus klaim sales lain (404)", async () => {
    const { admin, salesA, salesB } = await seedUsers();
    const claim = await makeClaim(salesA, admin);
    await expectAppError(getClaim(env.DB, salesB, claim.id), 404, "not_found");
    await expectAppError(updateClaim(env.DB, salesB, claim.id, { title: "x" }), 404);
    await expectAppError(deleteClaim(env.DB, salesB, claim.id), 404);
    await expectAppError(transitionClaim(env.DB, salesB, claim.id, "submit"), 404);
  });

  it("daftar sales hanya berisi klaim miliknya walau filter user_id diisi", async () => {
    const { admin, salesA, salesB } = await seedUsers();
    await makeClaim(salesA, admin);
    await makeClaim(salesB, admin);
    const mine = await listClaims(env.DB, salesA, { user_id: salesB.id });
    expect(mine.items.map((c) => c.user_id)).toEqual([salesA.id]);
    const all = await listClaims(env.DB, admin);
    expect(all.items).toHaveLength(2);
    const filtered = await listClaims(env.DB, admin, { user_id: salesB.id });
    expect(filtered.items.map((c) => c.user_id)).toEqual([salesB.id]);
  });

  it("sales hanya bisa mengubah klaim selama draft", async () => {
    const { admin, salesA } = await seedUsers();
    const draft = await makeClaim(salesA, admin);
    const updated = await updateClaim(env.DB, salesA, draft.id, { amount: 99_000 });
    expect(updated.amount).toBe(99_000);

    const submitted = await makeClaim(salesA, admin, ["submit"]);
    await expectAppError(updateClaim(env.DB, salesA, submitted.id, { amount: 1 }), 409, "conflict");
    await expectAppError(deleteClaim(env.DB, salesA, submitted.id), 409);
  });

  it("admin bisa mengubah klaim submitted tapi tidak yang sudah approved", async () => {
    const { admin, salesA } = await seedUsers();
    const submitted = await makeClaim(salesA, admin, ["submit"]);
    expect((await updateClaim(env.DB, admin, submitted.id, { title: "Dikoreksi admin" })).title).toBe("Dikoreksi admin");
    const approved = await makeClaim(salesA, admin, ["submit", "approve"]);
    await expectAppError(updateClaim(env.DB, admin, approved.id, { title: "x" }), 409);
  });

  it("admin membuat klaim atas nama sales tertentu", async () => {
    const { admin, salesB } = await seedUsers();
    const claim = await createClaim(env.DB, admin, validClaim({ user_id: salesB.id }));
    expect(claim.user_id).toBe(salesB.id);
    expect(claim.created_by).toBe(admin.id);
  });

  it("admin wajib memilih sales aktif sebagai pemilik klaim", async () => {
    const { admin } = await seedUsers();
    const off = await insertUser("off@ops.test", "sales", { active: false });
    await expectAppError(createClaim(env.DB, admin, validClaim()), 400, "validation");
    await expectAppError(createClaim(env.DB, admin, validClaim({ user_id: off.id })), 400);
    await expectAppError(createClaim(env.DB, admin, validClaim({ user_id: admin.id })), 400);
  });

  it("validasi input klaim", async () => {
    const { salesA } = await seedUsers();
    await expectAppError(createClaim(env.DB, salesA, validClaim({ amount: 0 })), 400, "validation");
    await expectAppError(createClaim(env.DB, salesA, validClaim({ amount: -5 })), 400);
    await expectAppError(createClaim(env.DB, salesA, validClaim({ amount: 10.5 })), 400);
    await expectAppError(createClaim(env.DB, salesA, validClaim({ expense_date: "2026-02-30" })), 400);
    await expectAppError(createClaim(env.DB, salesA, validClaim({ category: "pesawat" as never })), 400);
    await expectAppError(createClaim(env.DB, salesA, validClaim({ title: "  " })), 400);
  });
});

describe("state machine klaim", () => {
  it("alur lengkap draft → submitted → approved → paid", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin, ["submit", "approve", "pay"]);
    expect(claim.status).toBe("paid");
    expect(claim.decided_by).toBe(admin.id);
    expect(claim.paid_at).not.toBeNull();
  });

  it("reject wajib dengan alasan", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin, ["submit"]);
    await expectAppError(transitionClaim(env.DB, admin, claim.id, "reject", "  "), 400, "validation");
    const rejected = await transitionClaim(env.DB, admin, claim.id, "reject", "Bukti tidak lengkap");
    expect(rejected.status).toBe("rejected");
    expect(rejected.decision_note).toBe("Bukti tidak lengkap");
  });

  it("transisi tidak valid → 409", async () => {
    const { admin, salesA } = await seedUsers();
    const draft = await makeClaim(salesA, admin);
    await expectAppError(transitionClaim(env.DB, admin, draft.id, "approve"), 409, "conflict");
    await expectAppError(transitionClaim(env.DB, admin, draft.id, "pay"), 409);
    const submitted = await makeClaim(salesA, admin, ["submit"]);
    await expectAppError(transitionClaim(env.DB, admin, submitted.id, "pay"), 409);
    await expectAppError(transitionClaim(env.DB, salesA, submitted.id, "submit"), 409);
    const rejected = await makeClaim(salesA, admin, ["submit", "reject"]);
    await expectAppError(transitionClaim(env.DB, admin, rejected.id, "approve"), 409);
  });

  it("sales tidak bisa approve/reject/pay klaimnya sendiri (403)", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin, ["submit"]);
    await expectAppError(transitionClaim(env.DB, salesA, claim.id, "approve"), 403, "forbidden");
    await expectAppError(transitionClaim(env.DB, salesA, claim.id, "reject", "x"), 403);
    expect(allowedTransitions(salesA, claim)).toEqual([]);
    expect(allowedTransitions(admin, claim)).toEqual(["approve", "reject"]);
  });

  it("setiap aksi menulis claim_events berurutan", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin);
    await updateClaim(env.DB, salesA, claim.id, { amount: 200_000 });
    await transitionClaim(env.DB, salesA, claim.id, "submit");
    await transitionClaim(env.DB, admin, claim.id, "approve");
    await transitionClaim(env.DB, admin, claim.id, "pay");
    const { events } = await getClaimDetail(env.DB, admin, claim.id);
    expect(events.map((e) => [e.action, e.actor_id])).toEqual([
      ["created", salesA.id],
      ["updated", salesA.id],
      ["submitted", salesA.id],
      ["approved", admin.id],
      ["paid", admin.id],
    ]);
  });

  it("transisi yang gagal tidak menulis event", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin);
    await expectAppError(transitionClaim(env.DB, admin, claim.id, "approve"), 409);
    expect(await count("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ?", claim.id)).toBe(1);
  });

  it("soft delete menyembunyikan klaim dari daftar dan detail, tapi barisnya tetap ada", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin);
    await deleteClaim(env.DB, salesA, claim.id);
    expect((await listClaims(env.DB, admin)).items).toHaveLength(0);
    await expectAppError(getClaim(env.DB, admin, claim.id), 404);
    expect(await count("SELECT COUNT(*) AS n FROM claims WHERE deleted_at IS NOT NULL")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM claim_events WHERE action = 'deleted'")).toBe(1);
  });

  it("admin tidak bisa menghapus klaim yang sudah dibayar", async () => {
    const { admin, salesA } = await seedUsers();
    const paid = await makeClaim(salesA, admin, ["submit", "approve", "pay"]);
    await expectAppError(deleteClaim(env.DB, admin, paid.id), 409);
  });
});

describe("daftar klaim", () => {
  it("paginasi cursor dan total nominal", async () => {
    const { admin, salesA } = await seedUsers();
    for (let i = 0; i < 5; i++) await createClaim(env.DB, salesA, validClaim({ amount: 1000 * (i + 1) }));
    const first = await listClaims(env.DB, salesA, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.total_amount).toBe(15_000);
    const second = await listClaims(env.DB, salesA, { limit: 2, cursor: first.next_cursor! });
    const third = await listClaims(env.DB, salesA, { limit: 2, cursor: second.next_cursor! });
    expect(third.items).toHaveLength(1);
    expect(third.next_cursor).toBeNull();
    const ids = [...first.items, ...second.items, ...third.items].map((c) => c.id);
    expect(new Set(ids).size).toBe(5);
    void admin;
  });

  it("filter status dan rentang tanggal", async () => {
    const { admin, salesA } = await seedUsers();
    await createClaim(env.DB, salesA, validClaim({ expense_date: "2026-09-15" }));
    await createClaim(env.DB, salesA, validClaim({ expense_date: "2026-10-05", submit: true }));
    expect((await listClaims(env.DB, admin, { status: "submitted" })).items).toHaveLength(1);
    const oct = await listClaims(env.DB, admin, { from: "2026-10-01", to: "2026-10-31" });
    expect(oct.items.map((c) => c.expense_date)).toEqual(["2026-10-05"]);
  });

  it("cursor rusak → 400", async () => {
    const { salesA } = await seedUsers();
    await expectAppError(listClaims(env.DB, salesA, { cursor: "!!!" }), 400, "validation");
  });
});
