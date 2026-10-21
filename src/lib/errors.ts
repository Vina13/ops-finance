import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_scope"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "payload_too_large"
  | "unsupported_media_type"
  | "internal";

export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const notFound = (what = "Data") => new AppError(404, "not_found", `${what} tidak ditemukan`);
export const forbidden = (message = "Tidak punya akses") => new AppError(403, "forbidden", message);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const validation = (message: string, details?: unknown) =>
  new AppError(400, "validation", message, details);
