import { type Context, Hono } from "hono";
import { validation } from "../../lib/errors";
import { requireRole } from "../../middleware/auth";
import { addAttachment, attachmentResponse, getAttachment } from "../../services/attachments";
import {
  createClaim,
  deleteClaim,
  getClaim,
  getClaimDetail,
  listClaims,
  type TransitionAction,
  transitionClaim,
  updateClaim,
} from "../../services/claims";
import { listUsers } from "../../services/users";
import type { AppEnv, User } from "../../types";
import { ClaimDetailPage, type ClaimFormValues, ClaimFormPage, ClaimListPage } from "../../views/claims";
import { fieldErrorsOf, type FormBody, isFormError, parseAmount, readForm, str } from "./form";

export const claimRoutes = new Hono<AppEnv>();

async function salesFor(db: D1Database, user: User): Promise<User[]> {
  return user.role === "admin" ? (await listUsers(db, "sales")).filter((u) => u.is_active) : [];
}

function monthRange(month: string | undefined): { from?: string; to?: string } {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return {};
  const [y, m] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function claimValues(body: FormBody): ClaimFormValues {
  return {
    title: str(body, "title"),
    category: str(body, "category"),
    expense_date: str(body, "expense_date"),
    amount: str(body, "amount"),
    description: str(body, "description"),
    user_id: str(body, "user_id"),
  };
}

claimRoutes.get("/", (c) => c.redirect("/claims"));

claimRoutes.get("/claims", async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const filters = {
    status: q.status || undefined,
    user_id: user.role === "admin" ? q.user_id || undefined : undefined,
    month: q.month || undefined,
  };
  const result = await listClaims(c.env.DB, user, {
    status: filters.status as never,
    user_id: filters.user_id,
    ...monthRange(filters.month),
    cursor: q.cursor || undefined,
    limit: 50,
  });
  return c.html(
    <ClaimListPage
      user={user}
      claims={result.items}
      totalAmount={result.total_amount}
      nextCursor={result.next_cursor}
      filters={filters}
      salesUsers={await salesFor(c.env.DB, user)}
      flash={q.flash}
    />,
  );
});

claimRoutes.get("/claims/new", async (c) => {
  const user = c.get("user");
  return c.html(
    <ClaimFormPage
      user={user}
      mode="new"
      values={{ expense_date: new Date().toISOString().slice(0, 10), category: "transport" }}
      salesUsers={await salesFor(c.env.DB, user)}
    />,
  );
});

claimRoutes.post("/claims/new", async (c) => {
  const user = c.get("user");
  const body = await readForm(c);
  try {
    const claim = await createClaim(c.env.DB, user, {
      ...claimValues(body),
      amount: parseAmount(str(body, "amount")),
      user_id: str(body, "user_id") || undefined,
      submit: str(body, "intent") === "submit",
    });
    return c.redirect(`/claims/${claim.id}?flash=${claim.status === "submitted" ? "submitted" : "created"}`);
  } catch (err) {
    if (!isFormError(err)) throw err;
    return c.html(
      <ClaimFormPage
        user={user}
        mode="new"
        values={claimValues(body)}
        salesUsers={await salesFor(c.env.DB, user)}
        error={err.message}
        fieldErrors={fieldErrorsOf(err)}
      />,
      err.status,
    );
  }
});

claimRoutes.get("/claims/:id", async (c) => {
  const detail = await getClaimDetail(c.env.DB, c.get("user"), c.req.param("id"));
  return c.html(<ClaimDetailPage user={c.get("user")} {...detail} flash={c.req.query("flash")} />);
});

claimRoutes.get("/claims/:id/edit", async (c) => {
  const user = c.get("user");
  const claim = await getClaim(c.env.DB, user, c.req.param("id"));
  return c.html(<ClaimFormPage user={user} mode="edit" claimId={claim.id} values={claim} salesUsers={[]} />);
});

claimRoutes.post("/claims/:id/edit", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await readForm(c);
  const { user_id: _ignored, ...values } = claimValues(body);
  try {
    await updateClaim(c.env.DB, user, id, { ...values, amount: parseAmount(str(body, "amount")) });
    return c.redirect(`/claims/${id}?flash=updated`);
  } catch (err) {
    if (!isFormError(err)) throw err;
    return c.html(
      <ClaimFormPage
        user={user}
        mode="edit"
        claimId={id}
        values={values}
        salesUsers={[]}
        error={err.message}
        fieldErrors={fieldErrorsOf(err)}
      />,
      err.status,
    );
  }
});

claimRoutes.post("/claims/:id/delete", async (c) => {
  await deleteClaim(c.env.DB, c.get("user"), c.req.param("id"));
  return c.redirect("/claims?flash=deleted");
});

const FLASH_FOR: Record<TransitionAction, string> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
  pay: "paid",
};

function transitionRoute(action: TransitionAction) {
  return async (c: Context<AppEnv, "/claims/:id">) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = await readForm(c);
    try {
      await transitionClaim(c.env.DB, user, id, action, str(body, "note"));
      return c.redirect(`/claims/${id}?flash=${FLASH_FOR[action]}`);
    } catch (err) {
      if (!isFormError(err)) throw err;
      const detail = await getClaimDetail(c.env.DB, user, id);
      return c.html(<ClaimDetailPage user={user} {...detail} error={err.message} />, err.status);
    }
  };
}

claimRoutes.post("/claims/:id/submit", transitionRoute("submit"));
claimRoutes.post("/claims/:id/approve", requireRole("admin"), transitionRoute("approve"));
claimRoutes.post("/claims/:id/reject", requireRole("admin"), transitionRoute("reject"));
claimRoutes.post("/claims/:id/pay", requireRole("admin"), transitionRoute("pay"));

claimRoutes.post("/claims/:id/attachments", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await readForm(c);
  const file = body.file;
  try {
    if (!(file instanceof File)) throw validation("Pilih file untuk diunggah");
    await addAttachment(c.env.DB, c.env.BUCKET, user, id, file);
    return c.redirect(`/claims/${id}?flash=attached`);
  } catch (err) {
    if (!isFormError(err)) throw err;
    const detail = await getClaimDetail(c.env.DB, user, id);
    return c.html(<ClaimDetailPage user={user} {...detail} error={err.message} />, err.status);
  }
});

claimRoutes.get("/attachments/:id", async (c) => {
  const { attachment, body } = await getAttachment(c.env.DB, c.env.BUCKET, c.get("user"), c.req.param("id"));
  return attachmentResponse(attachment, body);
});
