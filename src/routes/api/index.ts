import { Hono } from "hono";
import { validation } from "../../lib/errors";
import { requireScope, requireToken } from "../../middleware/auth";
import { addAttachment, attachmentResponse, getAttachment } from "../../services/attachments";
import {
  createClaim,
  deleteClaim,
  getClaimDetail,
  listClaims,
  transitionClaim,
  updateClaim,
} from "../../services/claims";
import type { AppEnv } from "../../types";

/**
 * API JSON `/api`. Approve/reject/pay sengaja tidak ada di sini (hanya di web app);
 * jika nanti diperlukan, tambahkan scope `claims:approve` alih-alih memperluas `claims:write`.
 */
export const api = new Hono<AppEnv>();

api.use("*", requireToken);

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw validation("Body harus JSON yang valid");
  }
}

api.get("/me", (c) => {
  const { id, email, name, role } = c.get("user");
  return c.json({ id, email, name, role, scopes: c.get("scopes") });
});

api.get("/claims", requireScope("claims:read"), async (c) => {
  const q = c.req.query();
  return c.json(await listClaims(c.env.DB, c.get("user"), q));
});

api.get("/claims/:id", requireScope("claims:read"), async (c) => {
  const { claim, attachments, events } = await getClaimDetail(c.env.DB, c.get("user"), c.req.param("id"));
  return c.json({ ...claim, attachments, events });
});

api.post("/claims", requireScope("claims:write"), async (c) => {
  const claim = await createClaim(c.env.DB, c.get("user"), await readJson(c.req.raw));
  return c.json(claim, 201);
});

api.patch("/claims/:id", requireScope("claims:write"), async (c) => {
  return c.json(await updateClaim(c.env.DB, c.get("user"), c.req.param("id"), await readJson(c.req.raw)));
});

api.delete("/claims/:id", requireScope("claims:write"), async (c) => {
  await deleteClaim(c.env.DB, c.get("user"), c.req.param("id"));
  return c.body(null, 204);
});

api.post("/claims/:id/submit", requireScope("claims:write"), async (c) => {
  return c.json(await transitionClaim(c.env.DB, c.get("user"), c.req.param("id"), "submit"));
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
  const attachment = await addAttachment(c.env.DB, c.env.BUCKET, c.get("user"), c.req.param("id"), file);
  return c.json(attachment, 201);
});

api.get("/claims/:id/attachments/:attId", requireScope("claims:read"), async (c) => {
  const { attachment, body } = await getAttachment(
    c.env.DB,
    c.env.BUCKET,
    c.get("user"),
    c.req.param("attId"),
    c.req.param("id"),
  );
  return attachmentResponse(attachment, body);
});

