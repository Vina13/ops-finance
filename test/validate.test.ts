import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors";
import { CATEGORIES, validateClaimCreate, validateClaimUpdate, validateListFilters } from "../src/validate";

const valid = {
  title: "Taksi ke klien",
  category: "transport",
  expense_date: "2026-10-01",
  amount: 150_000,
};

/** Menjalankan fn dan mengembalikan AppError yang dilempar (gagal jika tidak melempar). */
function errorOf(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error("Seharusnya melempar AppError validation");
}

describe("validateClaimCreate", () => {
  it("menerima input valid dan mengisi default", () => {
    expect(validateClaimCreate(valid)).toEqual({ ...valid, description: "", submit: false });
  });

  it("nominal 0 ditolak", () => {
    const err = errorOf(() => validateClaimCreate({ ...valid, amount: 0 }));
    expect(err.status).toBe(400);
    expect(err.code).toBe("validation");
    expect(err.details).toEqual({ amount: ["Nominal harus lebih dari 0"] });
  });

  it("nominal negatif, pecahan, dan string ditolak", () => {
    for (const amount of [-1, 10.5, "150000"]) {
      expect(errorOf(() => validateClaimCreate({ ...valid, amount })).details).toHaveProperty("amount");
    }
  });

  it("kategori di luar daftar ditolak", () => {
    const err = errorOf(() => validateClaimCreate({ ...valid, category: "pesawat" }));
    expect(err.code).toBe("validation");
    expect(err.details).toEqual({ category: ["Kategori tidak dikenal"] });
  });

  it("semua kategori di daftar diterima", () => {
    for (const category of CATEGORIES) {
      expect(validateClaimCreate({ ...valid, category }).category).toBe(category);
    }
  });

  it("tanggal tidak valid dan judul kosong ditolak", () => {
    expect(errorOf(() => validateClaimCreate({ ...valid, expense_date: "2026-02-30" })).details).toHaveProperty(
      "expense_date",
    );
    expect(errorOf(() => validateClaimCreate({ ...valid, expense_date: "01-10-2026" })).details).toHaveProperty(
      "expense_date",
    );
    expect(errorOf(() => validateClaimCreate({ ...valid, title: "   " })).details).toHaveProperty("title");
  });
});

describe("validateClaimUpdate", () => {
  it("patch parsial valid diterima", () => {
    expect(validateClaimUpdate({ amount: 99_000 })).toEqual({ amount: 99_000 });
  });

  it("patch kosong, nominal 0, atau kategori asing ditolak", () => {
    errorOf(() => validateClaimUpdate({}));
    expect(errorOf(() => validateClaimUpdate({ amount: 0 })).details).toHaveProperty("amount");
    expect(errorOf(() => validateClaimUpdate({ category: "pesawat" })).details).toHaveProperty("category");
  });
});

describe("validateListFilters", () => {
  it("limit default 50, string query dikonversi ke angka", () => {
    expect(validateListFilters({}).limit).toBe(50);
    expect(validateListFilters({ limit: "10" }).limit).toBe(10);
  });

  it("status asing dan limit di atas 100 ditolak", () => {
    expect(errorOf(() => validateListFilters({ status: "unknown" })).details).toHaveProperty("status");
    expect(errorOf(() => validateListFilters({ limit: "1000" })).details).toHaveProperty("limit");
  });
});
