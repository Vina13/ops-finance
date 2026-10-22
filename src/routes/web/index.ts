import { Hono } from "hono";
import { except } from "hono/combine";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { claimsWeb } from "../../claims";
import { requireSession } from "../../middleware/auth";
import type { AppEnv } from "../../types";
import { adminRoutes } from "./admin";
import { authRoutes } from "./auth";
import { settingsRoutes } from "./settings";

export const web = new Hono<AppEnv>();

// Form POST dari origin lain ditolak (cookie SameSite=Lax jadi lapis kedua).
// Semua middleware web dilewati untuk /api/* (API memakai token, bukan cookie).
web.use("*", except("/api/*", csrf()));
web.use(
  "*",
  except(
    "/api/*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  ),
);

web.route("/", authRoutes);

const authed = new Hono<AppEnv>();
authed.use("*", except("/api/*", requireSession));
authed.route("/", claimsWeb);
authed.route("/admin", adminRoutes);
authed.route("/settings", settingsRoutes);
web.route("/", authed);
