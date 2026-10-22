// Error domain klaim. Tidak tahu HTTP; pemetaan ke status/kode HTTP ada di interface/errors.ts.
export type ClaimErrorCode =
  | "not_found"
  | "forbidden"
  | "conflict"
  | "validation"
  | "unsupported_media_type"
  | "payload_too_large";

export class ClaimError extends Error {
  constructor(
    readonly code: ClaimErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Data") => new ClaimError("not_found", `${what} tidak ditemukan`);
export const forbidden = (message = "Tidak punya akses") => new ClaimError("forbidden", message);
export const conflict = (message: string) => new ClaimError("conflict", message);
export const invalid = (message: string, details?: unknown) => new ClaimError("validation", message, details);
