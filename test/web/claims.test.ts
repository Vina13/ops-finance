import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getClaim } from "../../src/claims";
import { BASE, count, loginCookie, makeClaim, seedUsers, webGet, webPost } from "../helpers";

const form = {
  title: "Makan siang klien",
  category: "meal",
  expense_date: "2026-10-10",
  amount: "250.000",
  description: "Meeting PT Contoh",
};

describe("web: alur klaim", () => {
  it("sales membuat draft, mengubah, lalu mengajukan klaim", async () => {
    const { salesA } = await seedUsers();
    const cookie = await loginCookie(salesA);

    const created = await webPost("/claims/new", cookie, { ...form, intent: "draft" });
    expect(created.status).toBe(302);
    const location = created.headers.get("Location")!;
    expect(location).toMatch(/^\/claims\/[\w-]+\?flash=created$/);
    const id = location.split("/")[2]!.split("?")[0]!;
    const claim = await getClaim(env.DB, salesA, id);
    expect(claim).toMatchObject({ status: "draft", amount: 250_000, user_id: salesA.id });

    const edited = await webPost(`/claims/${id}/edit`, cookie, { ...form, amount: "275000" });
    expect(edited.status).toBe(302);
    expect((await getClaim(env.DB, salesA, id)).amount).toBe(275_000);

    const submitted = await webPost(`/claims/${id}/submit`, cookie, {});
    expect(submitted.headers.get("Location")).toBe(`/claims/${id}?flash=submitted`);
    expect((await getClaim(env.DB, salesA, id)).status).toBe("submitted");
  });

  it("form tidak valid dirender ulang dengan pesan error dan nilai yang diisi", async () => {
    const { salesA } = await seedUsers();
    const cookie = await loginCookie(salesA);
    const res = await webPost("/claims/new", cookie, { ...form, amount: "nol", intent: "submit" });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Data klaim tidak valid");
    expect(html).toContain('value="Makan siang klien"');
    expect(await count("SELECT COUNT(*) AS n FROM claims")).toBe(0);
  });

  it("admin approve, reject (wajib alasan), dan pay lewat web", async () => {
    const { admin, salesA } = await seedUsers();
    const cookie = await loginCookie(admin);
    const toApprove = await makeClaim(salesA, admin, ["submit"]);
    const toReject = await makeClaim(salesA, admin, ["submit"]);

    expect((await webPost(`/claims/${toApprove.id}/approve`, cookie, {})).status).toBe(302);
    expect((await webPost(`/claims/${toApprove.id}/pay`, cookie, {})).status).toBe(302);
    expect((await getClaim(env.DB, admin, toApprove.id)).status).toBe("paid");

    const noNote = await webPost(`/claims/${toReject.id}/reject`, cookie, { note: "" });
    expect(noNote.status).toBe(400);
    expect(await noNote.text()).toContain("Alasan penolakan wajib diisi");
    await webPost(`/claims/${toReject.id}/reject`, cookie, { note: "Tanpa kwitansi" });
    expect(await getClaim(env.DB, admin, toReject.id)).toMatchObject({ status: "rejected", decision_note: "Tanpa kwitansi" });
  });

  it("sales tidak bisa approve lewat web (403)", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin, ["submit"]);
    const res = await webPost(`/claims/${claim.id}/approve`, await loginCookie(salesA), {});
    expect(res.status).toBe(403);
    expect((await getClaim(env.DB, admin, claim.id)).status).toBe("submitted");
  });

  it("tombol aksi tampil sesuai role dan status", async () => {
    const { admin, salesA } = await seedUsers();
    const draft = await makeClaim(salesA, admin);
    const submitted = await makeClaim(salesA, admin, ["submit"]);
    const salesCookie = await loginCookie(salesA);
    const adminCookie = await loginCookie(admin);

    const salesDraft = await (await webGet(`/claims/${draft.id}`, salesCookie)).text();
    expect(salesDraft).toContain(`/claims/${draft.id}/submit`);
    expect(salesDraft).toContain(`/claims/${draft.id}/edit`);
    expect(salesDraft).not.toContain("/approve");

    const salesSubmitted = await (await webGet(`/claims/${submitted.id}`, salesCookie)).text();
    expect(salesSubmitted).not.toContain(`/claims/${submitted.id}/edit`);
    expect(salesSubmitted).not.toContain("/approve");
    expect(salesSubmitted).toContain(`/claims/${submitted.id}/attachments`);

    const adminSubmitted = await (await webGet(`/claims/${submitted.id}`, adminCookie)).text();
    expect(adminSubmitted).toContain(`/claims/${submitted.id}/approve`);
    expect(adminSubmitted).toContain(`/claims/${submitted.id}/reject`);
    expect(adminSubmitted).not.toContain(`/claims/${submitted.id}/pay`);
  });

  it("daftar klaim: sales hanya melihat miliknya, admin melihat semua", async () => {
    const { admin, salesA, salesB } = await seedUsers();
    const a = await makeClaim(salesA, admin);
    const b = await makeClaim(salesB, admin);
    const salesHtml = await (await webGet("/claims", await loginCookie(salesA))).text();
    expect(salesHtml).toContain(a.id);
    expect(salesHtml).not.toContain(b.id);
    const adminHtml = await (await webGet("/claims", await loginCookie(admin))).text();
    expect(adminHtml).toContain(a.id);
    expect(adminHtml).toContain(b.id);
    expect((await webGet(`/claims/${b.id}`, await loginCookie(salesA))).status).toBe(404);
  });

  it("POST tanpa Origin yang cocok ditolak CSRF", async () => {
    const { salesA } = await seedUsers();
    const cookie = await loginCookie(salesA);
    const res = await webPost("/claims/new", cookie, { ...form, intent: "draft" }, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM claims")).toBe(0);
    const ok = await webPost("/claims/new", cookie, { ...form, intent: "draft" }, { Origin: BASE });
    expect(ok.status).toBe(302);
  });

  it("sales mengakses /admin/users → 403", async () => {
    const { salesA } = await seedUsers();
    expect((await webGet("/admin/users", await loginCookie(salesA))).status).toBe(403);
  });
});

describe("web: kelola user (admin)", () => {
  it("admin membuat sales baru yang langsung bisa login", async () => {
    const { admin } = await seedUsers();
    const cookie = await loginCookie(admin);
    const res = await webPost("/admin/users/new", cookie, {
      email: "Baru@Ops.test",
      name: "Sales Baru",
      role: "sales",
      password: "password-baru-123",
    });
    expect(res.status).toBe(302);
    const login = await webPost("/login", undefined, { email: "baru@ops.test", password: "password-baru-123" });
    expect(login.status).toBe(302);
  });

  it("menonaktifkan user menghapus sesinya; admin tidak bisa menonaktifkan diri sendiri", async () => {
    const { admin, salesA } = await seedUsers();
    const adminCookie = await loginCookie(admin);
    const salesCookie = await loginCookie(salesA);
    await webPost(`/admin/users/${salesA.id}/edit`, adminCookie, { name: "Sales A", role: "sales" });
    expect((await webGet("/claims", salesCookie)).status).toBe(302);

    const self = await webPost(`/admin/users/${admin.id}/edit`, adminCookie, { name: "Admin", role: "admin" });
    expect(self.status).toBe(400);
  });
});
