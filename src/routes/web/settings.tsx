import { Hono } from "hono";
import { z } from "zod";
import { createApiToken, listApiTokens, revokeApiToken, tokenInputSchema } from "../../auth/apiToken";
import { validation } from "../../lib/errors";
import { changePassword } from "../../services/users";
import type { AppEnv } from "../../types";
import { PasswordPage, TokensPage } from "../../views/pages";
import { isFormError, readForm, str, strs } from "./form";

/** Token API hanya bisa dikelola lewat sesi web, tidak lewat token itu sendiri. */
export const settingsRoutes = new Hono<AppEnv>();

settingsRoutes.get("/tokens", async (c) => {
  const user = c.get("user");
  return c.html(
    <TokensPage user={user} tokens={await listApiTokens(c.env.DB, user.id)} flash={c.req.query("flash")} />,
  );
});

settingsRoutes.post("/tokens", async (c) => {
  const user = c.get("user");
  const body = await readForm(c);
  const days = str(body, "expires_in_days");
  try {
    const parsed = tokenInputSchema.safeParse({
      name: str(body, "name"),
      scopes: strs(body, "scopes"),
      expires_in_days: days ? Number(days) : undefined,
    });
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors;
      throw validation(Object.values(fieldErrors).flat()[0] ?? "Data token tidak valid", fieldErrors);
    }
    const { token } = await createApiToken(c.env.DB, user.id, parsed.data);
    // Token mentah dirender sekali di respons ini; tidak di-redirect agar tidak masuk URL/riwayat.
    c.header("Cache-Control", "no-store");
    return c.html(<TokensPage user={user} tokens={await listApiTokens(c.env.DB, user.id)} newToken={token} />, 201);
  } catch (err) {
    if (!isFormError(err)) throw err;
    return c.html(
      <TokensPage user={user} tokens={await listApiTokens(c.env.DB, user.id)} error={err.message} />,
      err.status,
    );
  }
});

settingsRoutes.post("/tokens/:id/revoke", async (c) => {
  await revokeApiToken(c.env.DB, c.get("user").id, c.req.param("id"));
  return c.redirect("/settings/tokens?flash=token_revoked");
});

settingsRoutes.get("/password", (c) => c.html(<PasswordPage user={c.get("user")} flash={c.req.query("flash")} />));

settingsRoutes.post("/password", async (c) => {
  const user = c.get("user");
  const body = await readForm(c);
  try {
    await changePassword(c.env.DB, user.id, str(body, "current_password"), str(body, "new_password"));
    return c.redirect("/settings/password?flash=password_changed");
  } catch (err) {
    if (!isFormError(err)) throw err;
    return c.html(<PasswordPage user={user} error={err.message} />, err.status);
  }
});
