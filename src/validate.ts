import { z } from "zod";
import { validation } from "./lib/errors";

import { CATEGORIES, MAX_AMOUNT, STATUSES } from "./claims/domain/claim";

// Skema validasi input klaim. Dipakai bersama oleh web, API, dan service.
// Daftar kategori/status berasal dari src/claims/domain/claim.ts.

export { CATEGORIES, type Category, type ClaimStatus, MAX_AMOUNT, STATUSES } from "./claims/domain/claim";

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus berformat YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), {
    message: "Tanggal tidak valid",
  });

const claimFields = {
  title: z.string().trim().min(1, "Judul wajib diisi").max(200),
  category: z.enum(CATEGORIES, { message: "Kategori tidak dikenal" }),
  expense_date: isoDate,
  amount: z.number().int("Nominal harus bilangan bulat").positive("Nominal harus lebih dari 0").max(MAX_AMOUNT),
  description: z.string().trim().max(2000).default(""),
};

export const claimCreateSchema = z.object({
  ...claimFields,
  /** Wajib untuk admin (klaim atas nama sales), diabaikan untuk sales. */
  user_id: z.string().optional(),
  /** true = langsung diajukan (status submitted). */
  submit: z.boolean().default(false),
});
export type ClaimCreateInput = z.input<typeof claimCreateSchema>;
export type ClaimCreateData = z.output<typeof claimCreateSchema>;

export const claimUpdateSchema = z
  .object({
    title: claimFields.title,
    category: claimFields.category,
    expense_date: claimFields.expense_date,
    amount: claimFields.amount,
    description: z.string().trim().max(2000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Tidak ada field yang diubah" });
export type ClaimUpdateInput = z.infer<typeof claimUpdateSchema>;

export const listFiltersSchema = z.object({
  status: z.enum(STATUSES).optional(),
  user_id: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ListFilters = z.input<typeof listFiltersSchema>;
export type ListFiltersData = z.output<typeof listFiltersSchema>;

/** Parse dengan skema; kalau gagal lempar AppError 400 `validation` berisi pesan per field. */
function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown, message: string): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validation(message, z.flattenError(parsed.error).fieldErrors);
  return parsed.data;
}

export const validateClaimCreate = (input: unknown): ClaimCreateData =>
  parseOrThrow(claimCreateSchema, input, "Data klaim tidak valid");

export const validateClaimUpdate = (input: unknown): ClaimUpdateInput =>
  parseOrThrow(claimUpdateSchema, input, "Data klaim tidak valid");

export const validateListFilters = (input: unknown): ListFiltersData =>
  parseOrThrow(listFiltersSchema, input, "Filter tidak valid");
