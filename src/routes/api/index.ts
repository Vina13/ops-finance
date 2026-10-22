import { Hono } from "hono";
import { claimsApi } from "../../claims";
import { requireToken } from "../../middleware/auth";
import type { AppEnv } from "../../types";

/** API JSON `/api`. Semua route wajib token Bearer; route klaim berasal dari modul src/claims. */
export const api = new Hono<AppEnv>();

api.use("*", requireToken);

api.get("/me", (c) => {
  const { id, email, name, role } = c.get("user");
  return c.json({ id, email, name, role, scopes: c.get("scopes") });
});

api.route("/", claimsApi);
