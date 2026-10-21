import { Hono } from "hono";
import { z } from "zod";
import { validation } from "../../lib/errors";
import { requireRole } from "../../middleware/auth";
import { createUser, getUser, listUsers, updateUser, userInputSchema, userUpdateSchema } from "../../services/users";
import type { AppEnv } from "../../types";
import { UserFormPage, UsersPage } from "../../views/pages";
import { fieldErrorsOf, isFormError, readForm, str } from "./form";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireRole("admin"));

adminRoutes.get("/users", async (c) => {
  return c.html(<UsersPage user={c.get("user")} users={await listUsers(c.env.DB)} flash={c.req.query("flash")} />);
});

adminRoutes.get("/users/new", (c) => c.html(<UserFormPage user={c.get("user")} values={{ role: "sales" }} />));

adminRoutes.post("/users/new", async (c) => {
  const body = await readForm(c);
  const values = { email: str(body, "email"), name: str(body, "name"), role: str(body, "role") };
  try {
    const parsed = userInputSchema.safeParse({ ...values, password: str(body, "password") });
    if (!parsed.success) throw validation("Data user tidak valid", z.flattenError(parsed.error).fieldErrors);
    await createUser(c.env.DB, parsed.data);
    return c.redirect("/admin/users?flash=user_saved");
  } catch (err) {
    if (!isFormError(err)) throw err;
    return c.html(
      <UserFormPage user={c.get("user")} values={values} error={err.message} fieldErrors={fieldErrorsOf(err)} />,
      err.status,
    );
  }
});

adminRoutes.get("/users/:id/edit", async (c) => {
  const target = await getUser(c.env.DB, c.req.param("id"));
  return c.html(
    <UserFormPage user={c.get("user")} target={target} values={{ ...target, is_active: target.is_active === 1 }} />,
  );
});

adminRoutes.post("/users/:id/edit", async (c) => {
  const target = await getUser(c.env.DB, c.req.param("id"));
  const body = await readForm(c);
  const values = { name: str(body, "name"), role: str(body, "role"), is_active: str(body, "is_active") === "1" };
  try {
    const parsed = userUpdateSchema.safeParse({ ...values, password: str(body, "password") || undefined });
    if (!parsed.success) throw validation("Data user tidak valid", z.flattenError(parsed.error).fieldErrors);
    await updateUser(c.env.DB, c.get("user").id, target.id, parsed.data);
    return c.redirect("/admin/users?flash=user_saved");
  } catch (err) {
    if (!isFormError(err)) throw err;
    return c.html(
      <UserFormPage
        user={c.get("user")}
        target={target}
        values={values}
        error={err.message}
        fieldErrors={fieldErrorsOf(err)}
      />,
      err.status,
    );
  }
});
