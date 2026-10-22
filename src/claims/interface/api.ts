// Route API JSON klaim, dipasang di /api oleh src/routes/api (requireToken sudah diterapkan di sana).
// Approve/reject/pay sengaja tidak ada di sini (hanya di web app); jika nanti diperlukan,
// tambahkan scope `claims:approve` alih-alih memperluas `claims:write`.
import { Hono } from "hono";
import { validation } from "../../lib/errors";
import { requireScope } from "../../middleware/auth";
import type { AppEnv } from "../../types";
import { attachmentResponse } from "./attachmentResponse";
import { claimService, type DepsFactory } from "./service";

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw validation("Body harus JSON yang valid");
  }
}

export function claimsApiRoutes(makeDeps: DepsFactory) {
  const api = new Hono<AppEnv>();
  const svc = (env: Cloudflare.Env) => claimService(makeDeps(env));

  api.get("/claims", requireScope("claims:read"), async (c) => {
    return c.json(await svc(c.env).listClaims(c.get("user"), c.req.query()));
  });

  api.get("/claims/:id", requireScope("claims:read"), async (c) => {
    const { claim, attachments, events } = await svc(c.env).getClaimDetail(c.get("user"), c.req.param("id"));
    return c.json({ ...claim, attachments, events });
  });

  api.post("/claims", requireScope("claims:write"), async (c) => {
    const claim = await svc(c.env).createClaim(c.get("user"), await readJson(c.req.raw));
    return c.json(claim, 201);
  });

  api.patch("/claims/:id", requireScope("claims:write"), async (c) => {
    return c.json(await svc(c.env).updateClaim(c.get("user"), c.req.param("id"), await readJson(c.req.raw)));
  });

  api.delete("/claims/:id", requireScope("claims:write"), async (c) => {
    await svc(c.env).deleteClaim(c.get("user"), c.req.param("id"));
    return c.body(null, 204);
  });

  api.post("/claims/:id/submit", requireScope("claims:write"), async (c) => {
    return c.json(await svc(c.env).transitionClaim(c.get("user"), c.req.param("id"), "submit"));
  });

  api.post("/claims/:id/attachments", requireScope("claims:write"), async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw validation("Body harus multipart/form-data dengan field 'file'");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw validation("Field 'file' wajib diisi");
    const attachment = await svc(c.env).addAttachment(c.get("user"), c.req.param("id"), file);
    return c.json(attachment, 201);
  });

  api.get("/claims/:id/attachments/:attId", requireScope("claims:read"), async (c) => {
    const { attachment, body } = await svc(c.env).getAttachment(c.get("user"), c.req.param("attId"), c.req.param("id"));
    return attachmentResponse(attachment, body);
  });

  return api;
}
