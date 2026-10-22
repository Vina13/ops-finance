import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES, sanitizeFilename } from "../src/services/attachments";
import type { ClaimAttachment } from "../src/services/claims";
import { apiFetch, count, loginCookie, makeClaim, makeToken, pdfFile, seedUsers, webGet, webPost } from "./helpers";

function upload(claimId: string, token: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(`/claims/${claimId}/attachments`, token, { method: "POST", body });
}

describe("lampiran R2", () => {
  it("upload PDF dan PNG tersimpan di R2 dan bisa diunduh pemilik", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin);
    const token = await makeToken(salesA);

    const res = await upload(claim.id, token, pdfFile("kwitansi taksi.pdf"));
    expect(res.status).toBe(201);
    const att = (await res.json()) as ClaimAttachment;
    expect(att).toMatchObject({ claim_id: claim.id, filename: "kwitansi taksi.pdf", content_type: "application/pdf" });
    expect(await env.BUCKET.head(`claims/${claim.id}/${att.id}`)).not.toBeNull();

    const png = await upload(claim.id, token, pdfFile("foto.png", 2048, "image/png"));
    expect(png.status).toBe(201);
    expect(await count("SELECT COUNT(*) AS n FROM claim_events WHERE action = 'attachment_added'")).toBe(2);

    const dl = await apiFetch(`/claims/${claim.id}/attachments/${att.id}`, token);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("Content-Type")).toBe("application/pdf");
    expect(dl.headers.get("Content-Disposition")).toBe('attachment; filename="kwitansi taksi.pdf"');
    expect((await dl.arrayBuffer()).byteLength).toBe(1024);

    const web = await webGet(`/attachments/${att.id}`, await loginCookie(salesA));
    expect(web.status).toBe(200);
  });

  it("file lebih dari 5 MB ditolak", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin);
    const res = await upload(claim.id, await makeToken(salesA), pdfFile("besar.pdf", MAX_ATTACHMENT_BYTES + 1));
    expect(res.status).toBe(413);
    expect((await env.BUCKET.list()).objects).toHaveLength(0);
  });

  it("tipe file selain PDF/JPEG/PNG ditolak", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin);
    const token = await makeToken(salesA);
    for (const type of ["text/html", "image/svg+xml", "application/x-msdownload"]) {
      const res = await upload(claim.id, token, pdfFile("x", 100, type));
      expect(res.status, type).toBe(415);
    }
    expect(await count("SELECT COUNT(*) AS n FROM claim_attachments")).toBe(0);
  });

  it("sales lain tidak bisa mengunduh atau mengunggah lampiran", async () => {
    const { admin, salesA, salesB } = await seedUsers();
    const claim = await makeClaim(salesA, admin);
    const res = await upload(claim.id, await makeToken(salesA), pdfFile());
    const att = (await res.json()) as ClaimAttachment;

    const tokenB = await makeToken(salesB);
    expect((await apiFetch(`/claims/${claim.id}/attachments/${att.id}`, tokenB)).status).toBe(404);
    expect((await webGet(`/attachments/${att.id}`, await loginCookie(salesB))).status).toBe(404);
    expect((await upload(claim.id, tokenB, pdfFile())).status).toBe(404);
  });

  it("lampiran tidak bisa diunduh lewat claim_id yang salah", async () => {
    const { admin, salesA } = await seedUsers();
    const c1 = await makeClaim(salesA, admin);
    const c2 = await makeClaim(salesA, admin);
    const token = await makeToken(salesA);
    const att = (await (await upload(c1.id, token, pdfFile())).json()) as ClaimAttachment;
    expect((await apiFetch(`/claims/${c2.id}/attachments/${att.id}`, token)).status).toBe(404);
  });

  it("sales bisa menambah struk ke klaim submitted, tapi tidak setelah diputuskan (409); admin bisa", async () => {
    const { admin, salesA } = await seedUsers();
    const salesToken = await makeToken(salesA);
    const submitted = await makeClaim(salesA, admin, ["submit"]);
    expect((await upload(submitted.id, salesToken, pdfFile())).status).toBe(201);
    const approved = await makeClaim(salesA, admin, ["submit", "approve"]);
    expect((await upload(approved.id, salesToken, pdfFile())).status).toBe(409);
    expect((await upload(approved.id, await makeToken(admin), pdfFile())).status).toBe(201);
  });

  it("daftar klaim menghitung jumlah struk", async () => {
    const { admin, salesA } = await seedUsers();
    const token = await makeToken(salesA);
    const withReceipt = await makeClaim(salesA, admin, ["submit"]);
    await makeClaim(salesA, admin, ["submit"]);
    await upload(withReceipt.id, token, pdfFile());
    const list = (await (await apiFetch("/claims", token)).json()) as { items: { id: string; attachment_count: number }[] };
    const counts = Object.fromEntries(list.items.map((c) => [c.id, c.attachment_count]));
    expect(counts[withReceipt.id]).toBe(1);
    expect(Object.values(counts).sort()).toEqual([0, 1]);
  });

  it("upload lewat form web", async () => {
    const { admin, salesA } = await seedUsers();
    const claim = await makeClaim(salesA, admin);
    const body = new FormData();
    body.append("file", pdfFile());
    const res = await webPost(`/claims/${claim.id}/attachments`, await loginCookie(salesA), body);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/claims/${claim.id}?flash=attached`);
  });

  it("nama file disanitasi", () => {
    expect(sanitizeFilename('..\\..\\evil"name<script>.pdf')).toBe("evil_name_script_.pdf");
    expect(sanitizeFilename("")).toBe("lampiran");
  });
});
