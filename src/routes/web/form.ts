import type { Context } from "hono";
import { AppError } from "../../lib/errors";

export type FormBody = Record<string, string | File | (string | File)[]>;

export async function readForm(c: Context): Promise<FormBody> {
  return (await c.req.parseBody({ all: true })) as FormBody;
}

export function str(body: FormBody, key: string): string {
  const v = body[key];
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === "string" ? first : "";
}

export function strs(body: FormBody, key: string): string[] {
  const v = body[key];
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");
}

/** "150.000" atau "150 000" → 150000; selain angka dibiarkan agar ditolak validasi. */
export function parseAmount(raw: string): number | string {
  const cleaned = raw.replace(/[.\s,]/g, "");
  return /^\d+$/.test(cleaned) ? Number(cleaned) : raw;
}

export function fieldErrorsOf(err: unknown): Record<string, string[] | undefined> | undefined {
  if (err instanceof AppError && err.code === "validation" && err.details && typeof err.details === "object") {
    return err.details as Record<string, string[] | undefined>;
  }
  return undefined;
}

/** Hanya error yang wajar ditampilkan ulang di form; sisanya diteruskan ke error handler. */
export function isFormError(err: unknown): err is AppError {
  return err instanceof AppError && ["validation", "conflict", "unsupported_media_type", "payload_too_large"].includes(err.code);
}
