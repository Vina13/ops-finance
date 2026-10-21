import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { AppError } from "./lib/errors";
import { api } from "./routes/api";
import { web } from "./routes/web";
import type { AppEnv } from "./types";
import { ErrorPage } from "./views/Layout";

const app = new Hono<AppEnv>();

app.route("/api", api);
app.route("/", web);

const isApi = (path: string) => path === "/api" || path.startsWith("/api/");

app.notFound((c) => {
  if (isApi(c.req.path)) return c.json(new AppError(404, "not_found", "Endpoint tidak ditemukan").toJSON(), 404);
  return c.html(<ErrorPage status={404} message="Halaman tidak ditemukan" user={c.get("user")} />, 404);
});

app.onError((err, c) => {
  let appErr: AppError;
  if (err instanceof AppError) {
    appErr = err;
  } else if (err instanceof HTTPException) {
    // Mis. ditolak middleware csrf (403).
    appErr = new AppError(err.status as AppError["status"], err.status === 403 ? "forbidden" : "validation", err.message);
  } else {
    console.error(err);
    appErr = new AppError(500, "internal", "Terjadi kesalahan di server");
  }
  if (isApi(c.req.path)) return c.json(appErr.toJSON(), appErr.status);
  return c.html(<ErrorPage status={appErr.status} message={appErr.message} user={c.get("user")} />, appErr.status);
});

export default app;
