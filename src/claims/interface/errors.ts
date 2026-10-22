// Pemetaan ClaimError (domain) → AppError (HTTP). Satu-satunya tempat modul klaim tahu status HTTP.
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../../lib/errors";
import { ClaimError, type ClaimErrorCode } from "../domain/errors";

const STATUS: Record<ClaimErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  validation: 400,
  unsupported_media_type: 415,
  payload_too_large: 413,
};

export function toAppError(err: unknown): unknown {
  return err instanceof ClaimError ? new AppError(STATUS[err.code], err.code, err.message, err.details) : err;
}

/** Membungkus fungsi async supaya ClaimError keluar sebagai AppError (dipakai error handler & form). */
export function withAppErrors<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      throw toAppError(err);
    }
  };
}
