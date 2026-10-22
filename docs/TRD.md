# TRD: Modul `src/claims` dan Plafon Klaim

Status: **Bagian A selesai** (commit R0–R6 di `feat/klaim-biaya`), Bagian B belum dimulai · Tanggal: 2026-10-22 · Terkait: [PRD](PRD.md), [ARCHITECTURE](ARCHITECTURE.md), [ADR 0001](adr/0001-claims-feature-module.md)

> **Penyesuaian saat implementasi Bagian A**
> - `src/claims/index.ts` mengekspor route (`claimsApi`, `claimsWeb`) yang sudah dirangkai dengan adapter D1/R2. Indeks ini juga mengekspor **API in-process** dengan signature lama, misalnya `createClaim(db, actor, input)`, yang dipakai test. Fungsi `makeClaims(env)` tidak diperlukan.
> - Ada entry publik kedua, `src/claims/schemas.ts` (skema + konstanta, tanpa Hono/D1), untuk `mcp/`.
> - `interface/service.ts` menjadi titik tunggal "validasi → use case → `AppError`" untuk route dan API in-process. Route menerima `DepsFactory` dari composition root, sehingga `interface/` tidak pernah mengimpor `infrastructure/`.
> - `interface/` boleh mengimpor `src/middleware/auth`, `src/routes/web/form`, `src/services/users`, dan `src/views/{Layout,format}`.
> - Boundary test membaca sumber lewat `import.meta.glob(?raw)` karena test berjalan di runtime Workers yang tidak punya `fs`. Karena itu `tsconfig` menambahkan tipe `vite/client`.
> - Selama R1–R5, facade sementara dikecualikan secara eksplisit di boundary test. Pengecualian itu dihapus di R6.
> - Jumlah test: 88 → 108, terdiri dari 6 test karakterisasi API, 2 test batas modul, dan 12 unit test use case tanpa D1.

Dokumen ini punya dua bagian yang **dikerjakan terpisah**:

- **Bagian A: Refactoring (sekarang).** Memindahkan kode klaim ke modul fitur `src/claims` dengan Clean Architecture. **Perilaku tidak berubah.** Tidak ada migrasi baru, tidak ada perubahan API atau HTML, dan 88 test yang ada tetap hijau di setiap langkah.
- **Bagian B: Plafon klaim (nanti).** Fitur dari PRD dibangun di atas modul hasil Bagian A. Bagian B baru dimulai setelah Bagian A selesai dan di-merge.

## Konteks dan motivasi

Menurut `docs/ARCHITECTURE.md`, SQL sudah terkumpul di lapisan service dan semua jalur web, API, dan MCP bertemu di `src/services/claims.ts`. Jadi refactoring ini **bukan** untuk menghilangkan duplikasi logika, karena duplikasinya sudah kecil. Motivasinya:

1. `src/services/claims.ts` (399 baris) mencampur aturan bisnis (state machine, hak akses) dengan SQL D1. Aturan bisnis hanya bisa dites lewat D1 Miniflare.
2. Plafon menambah aturan baru (plafon efektif, pemakaian, periode) yang perlu dites cepat sebagai fungsi murni, dan juga SQL atomik yang khusus untuk D1. Kalau keduanya ditaruh di file yang sama, file itu akan sekitar dua kali lebih besar dan makin sulit dipisah.
3. Kode klaim tersebar di lima tempat: `services/`, `validate.ts`, `routes/api`, `routes/web/claims.tsx`, dan `views/claims.tsx`. Satu modul fitur membuat batas kepemilikan dan aturan dependensinya jelas.

## A1. Struktur target `src/claims`

```
src/claims/
├── domain/                     # murni: tanpa import Hono, D1, R2, zod, atau modul luar
│   ├── claim.ts                # tipe Claim, ClaimStatus, Category, CATEGORIES, STATUSES
│   ├── policy.ts               # canView, canEdit, canDelete, canAttach, allowedTransitions
│   ├── transitions.ts          # TRANSITIONS, ACTION_EVENT, transition(claim, action, actor) → hasil/alasan
│   ├── errors.ts               # ClaimError (not_found | forbidden | conflict | validation)
│   └── actor.ts                # Actor = { id, role } — satu-satunya "identitas" yang dikenal modul
├── application/                # use case: mengatur domain + port; tanpa SQL/HTTP
│   ├── ports.ts                # ClaimRepository, AttachmentStorage, Clock, IdGenerator
│   ├── createClaim.ts
│   ├── updateClaim.ts
│   ├── transitionClaim.ts      # submit / approve / reject / pay
│   ├── deleteClaim.ts
│   ├── listClaims.ts / getClaim.ts
│   └── attachments.ts          # addAttachment, getAttachment
├── infrastructure/             # adapter: satu-satunya tempat SQL dan R2
│   ├── d1ClaimRepository.ts    # prepare().bind(), db.batch, pola WHERE status = ? + changes()
│   └── r2AttachmentStorage.ts
├── interface/                  # adapter masuk: HTTP, form, view
│   ├── schemas.ts              # zod (pindahan src/validate.ts): input mentah → DTO
│   ├── errors.ts               # ClaimError → AppError (HTTP status + code)
│   ├── api.ts                  # route /api/claims/* (dipasang oleh src/routes/api)
│   ├── web.tsx                 # route /claims/*, /attachments/* (dipasang oleh src/routes/web)
│   └── views/                  # ClaimListPage, ClaimFormPage, ClaimDetailPage
└── index.ts                    # composition root: makeClaims(env) → { useCases, apiRoutes, webRoutes }
```

Bagian yang **tetap di luar** modul pada tahap ini: `auth/`, `middleware/`, `services/users.ts`, `lib/`, `views/Layout.tsx`, `views/pages.tsx`, dan `mcp/`. MCP tidak berubah sama sekali karena hanya memanggil `/api`.

### Aturan dependensi

```
interface ──► application ──► domain
     │              ▲
     └──► infrastructure (mengimplementasikan port di application)
index.ts merangkai semuanya
```

| Lapisan | Boleh import | Dilarang import |
|---|---|---|
| `domain/` | sesama `domain/` | `application`, `infrastructure`, `interface`, `hono`, `zod`, tipe Cloudflare, `src/lib/*` |
| `application/` | `domain/`, `application/` | `infrastructure`, `interface`, `hono`, `D1Database`, `R2Bucket` |
| `infrastructure/` | `domain/`, `application/ports` | `interface`, `hono` |
| `interface/` | `application/`, `domain/` (tipe & policy untuk UI), `hono`, `zod`, `src/lib/errors`, `src/views/Layout` | `infrastructure/` (kecuali lewat `index.ts`) |
| di luar `src/claims` | hanya `src/claims/index.ts` | file internal modul |

Aturan ini **ditegakkan dengan test**, bukan hanya konvensi. File `test/claims/boundaries.test.ts` membaca import di setiap file `src/claims/**` (regex atas `import ... from "..."`) dan gagal kalau ada yang melanggar tabel di atas. Pendekatan ini tidak menambah dependensi baru. dependency-cruiser dan ESLint ditolak; alasannya ada di ADR 0001.

### Gaya port

Port berupa **interface TypeScript dengan fungsi biasa**, dibuat lewat factory. Tidak ada kelas atau DI container.

```ts
// application/ports.ts (sketsa)
export interface ClaimRepository {
  findById(id: string): Promise<Claim | null>;
  list(filter: ClaimFilter, page: Page): Promise<{ items: Claim[]; nextCursor: string | null; total: number }>;
  insert(claim: NewClaim, events: NewEvent[]): Promise<void>;
  /** Guarded update: hanya berhasil jika status masih `expectedStatus`. */
  update(id: string, expectedStatus: ClaimStatus, patch: ClaimPatch, event: NewEvent): Promise<"ok" | "stale">;
  softDelete(id: string, expectedStatus: ClaimStatus, event: NewEvent): Promise<"ok" | "stale">;
}
```

Use case menerima dependensinya sebagai argumen, misalnya `createClaim(deps, actor, input)`. Test aturan bisnis bisa memakai repository in-memory tanpa D1. Test integrasi tetap memakai D1 Miniflare.

## A2. Rencana refactoring bertahap (sekarang)

Aturan untuk setiap langkah:
- satu commit per langkah,
- `npm run typecheck` dan `npm test` hijau,
- tidak ada perubahan perilaku, migrasi, URL, maupun HTML,
- file lama tetap ada sebagai **facade re-export** sampai langkah R6, sehingga import di route dan test tidak perlu berubah sekaligus.

| Langkah | Isi | Selesai jika |
|---|---|---|
| **R0** | Tambah `test/claims/boundaries.test.ts`. Mula-mula test ini hanya memeriksa folder yang sudah ada. Tambah test karakterisasi yang belum ada: error 409 transisi via API, total nominal dengan filter, urutan event. | Test baru hijau di kode sekarang |
| **R1** | Pindahkan tipe, konstanta, policy (`can*`, `allowedTransitions`), dan tabel transisi ke `src/claims/domain/`. `services/claims.ts` dan `validate.ts` me-re-export. | `domain/` tanpa import luar (boundary test), 88+ test hijau |
| **R2** | Buat `application/ports.ts` dan `infrastructure/d1ClaimRepository.ts`. Pindahkan **SQL** dari `services/claims.ts` ke repository tanpa mengubah statement-nya. | `services/claims.ts` tidak lagi berisi `prepare(` |
| **R3** | Pindahkan logika `createClaim`/`updateClaim`/`transitionClaim`/`deleteClaim`/`list`/`get` ke `application/*`. `services/claims.ts` jadi facade yang merangkai deps D1. Tambah unit test use case dengan repository in-memory untuk state machine dan hak akses. | Unit test use case berjalan tanpa D1 |
| **R4** | Hal yang sama untuk lampiran: `r2AttachmentStorage.ts` + `application/attachments.ts`. Rollback R2 jika insert gagal tetap dipertahankan. | `services/attachments.ts` jadi facade |
| **R5** | Pindahkan `validate.ts` ke `interface/schemas.ts`, route klaim dari `routes/api/index.ts` dan `routes/web/claims.tsx` ke `interface/api.ts` dan `interface/web.tsx`, dan `views/claims.tsx` ke `interface/views/`. `routes/*` cukup memasang route modul. | URL dan HTML identik (test web/API tidak diubah) |
| **R6** | Hapus facade (`services/claims.ts`, `services/attachments.ts`, `validate.ts`). Ubah import di test dan `mcp/server.ts` (yang memakai `CATEGORIES`, `isoDate`, `MAX_AMOUNT`) ke `src/claims/index.ts`. Aktifkan boundary test penuh. Perbarui `docs/ARCHITECTURE.md` dan `CLAUDE.md`. | Tidak ada import ke file internal modul dari luar, semua test hijau |

Catatan risiko:
- **Import `mcp/server.ts` ke `src/validate.ts`:** typecheck `-p mcp` harus tetap jalan setelah R6. Ekspor skema yang dipakai MCP dari `src/claims/index.ts` **tanpa** ikut membawa kode Hono atau D1. Gunakan entry ringan `src/claims/schemas.ts`, atau re-export dari `interface/schemas.ts`.
- **Pola atomik yang ada** (`UPDATE ... WHERE status = ?`, lalu event `WHERE changes() = 1` dalam satu `db.batch`) harus tetap ada di repository. Use case hanya melihat hasil `"ok" | "stale"`.
- **Pesan error dan kode HTTP** dipertahankan persis. Test API/web memeriksa body error.

Di luar cakupan Bagian A: memindahkan `users`, `auth`, dan `tokens` ke modul. Itu bisa jadi ADR terpisah kalau nanti dibutuhkan.

## B. Plafon klaim (nanti, setelah Bagian A)

### B1. Schema: `migrations/0002_claim_limits.sql`

Migrasi baru. `0001_init.sql` tidak diubah, sesuai CLAUDE.md.

```sql
-- Plafon default per kategori. Tidak ada baris = tidak terbatas.
CREATE TABLE claim_limits (
  category   TEXT PRIMARY KEY CHECK (category IN ('transport', 'meal', 'lodging', 'entertainment', 'other')),
  amount     INTEGER NOT NULL CHECK (amount >= 0 AND amount <= 1000000000000),
  updated_by TEXT NOT NULL REFERENCES users (id),
  updated_at TEXT NOT NULL
);

-- Override per sales; menggantikan default (boleh lebih tinggi atau lebih rendah).
CREATE TABLE claim_limit_overrides (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN ('transport', 'meal', 'lodging', 'entertainment', 'other')),
  amount     INTEGER NOT NULL CHECK (amount >= 0 AND amount <= 1000000000000),
  updated_by TEXT NOT NULL REFERENCES users (id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, category)
);

-- Audit perubahan plafon (PRD F5). NULL pada old/new = "tidak ada / dihapus".
CREATE TABLE claim_limit_changes (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NOT NULL REFERENCES users (id),
  scope       TEXT NOT NULL CHECK (scope IN ('default', 'override')),
  user_id     TEXT REFERENCES users (id),          -- diisi hanya untuk scope = 'override'
  category    TEXT NOT NULL,
  old_amount  INTEGER,
  new_amount  INTEGER,
  created_at  TEXT NOT NULL,
  CHECK ((scope = 'default') = (user_id IS NULL))
);

-- Mempercepat perhitungan pemakaian per (sales, kategori, bulan).
CREATE INDEX idx_claims_limit_usage ON claims (user_id, category, expense_date) WHERE deleted_at IS NULL;
```

### B2. Domain dan aplikasi

- `domain/limits.ts` berisi fungsi murni:
  - `effectiveLimit(override, default) → number | null`, dengan `null` berarti tidak terbatas,
  - `monthOf(expenseDate) → "YYYY-MM"`,
  - `COUNTED_STATUSES = ["submitted", "approved", "paid"]`,
  - `checkLimit({ limit, used, amount }) → { ok } | { ok: false, remaining }`. Nilai yang tepat sama dengan plafon diizinkan.
- Port baru `LimitRepository`:
  - `getDefaults()`, `getOverrides(userId?)`,
  - `setDefault/setOverride/deleteOverride(..., actor)`, yang juga menulis audit dalam batch yang sama,
  - `usage(userId, category, month, excludeClaimId?)`.
- Penegakan atomik (PRD F3) ada di **repository**, bukan di use case. Use case memanggil:
  - `ClaimRepository.insert(claim, events, { enforceLimit: true })`,
  - `update(..., { enforceLimit: true })`.

  Keduanya mengembalikan `"ok" | "stale" | "limit_exceeded"`. Repository menulis aturan yang sama dengan `domain/limits.ts` (status yang dihitung dan periode) di dalam SQL, dengan konstanta yang diimpor dari domain. Test **paritas** memastikan SQL dan fungsi domain memberi hasil yang sama untuk kumpulan kasus PRD.

Sketsa SQL insert bersyarat (tetap `prepare().bind()`):

```sql
INSERT INTO claims (id, user_id, title, category, expense_date, amount, description, status, submitted_at, created_by, created_at, updated_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'submitted', ?8, ?9, ?8, ?8
WHERE ?6 + (
        SELECT COALESCE(SUM(amount), 0) FROM claims
        WHERE user_id = ?2 AND category = ?4 AND substr(expense_date, 1, 7) = substr(?5, 1, 7)
          AND status IN ('submitted', 'approved', 'paid') AND deleted_at IS NULL
      )
      <= COALESCE(
        (SELECT amount FROM claim_limit_overrides WHERE user_id = ?2 AND category = ?4),
        (SELECT amount FROM claim_limits WHERE category = ?4),
        9223372036854775807   -- tidak terbatas
      );
-- lalu INSERT claim_events ... WHERE changes() = 1 (pola yang sudah ada)
```

Untuk `update` dan `submit`, tambahkan `AND id <> ?` pada subquery pemakaian (PRD AC-20/21) dan pakai kategori/bulan **baru** (AC-22). Jika `changes() = 0`, repository membedakan dua penyebab dengan satu `SELECT` lanjutan: status klaim sudah berubah (`stale` → 409 `conflict`), atau plafon terlewati (`limit_exceeded`). Pembacaan `used`/`limit` untuk pesan error memang tidak atomik, tapi keputusan tolak/terima tetap atomik.

### B3. Kontrak API

**Tidak ada endpoint baru di `/api`.** Membaca sisa plafon lewat API atau MCP adalah non-goal di PRD. Perubahan kontrak hanya berupa **error baru** di endpoint yang sudah ada:

| Endpoint | Kapan dicek |
|---|---|
| `POST /api/claims` | jika `submit: true` (termasuk MCP `create_claim`) |
| `POST /api/claims/:id/submit` | selalu |
| `PATCH /api/claims/:id` | jika klaim `submitted` (hanya admin yang bisa mengedit `submitted`) |

Respons ketika plafon terlewati:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": {
    "code": "limit_exceeded",
    "message": "Plafon Makan Oktober 2026 tersisa Rp1.580.000, klaim Rp2.000.000 melebihi plafon.",
    "details": {
      "category": "meal",
      "month": "2026-10",
      "limit": 2000000,
      "used": 420000,
      "remaining": 1580000,
      "amount": 2000000
    }
  }
}
```

- `remaining` boleh negatif jika plafon diturunkan setelah ada pemakaian (AC-18).
- Urutan pengecekan error tidak berubah: `401/403` (token/scope) → `400 validation` → `404 not_found` → `409 conflict` (status) → `409 limit_exceeded`.
- `ErrorCode` di `src/lib/errors.ts` bertambah `"limit_exceeded"`. Klien yang hanya memeriksa status 409 tetap bekerja.
- MCP tidak berubah. `create_claim` sudah meneruskan pesan error API sebagai `isError: true` (AC-25).

**Route web baru** (admin, cookie + CSRF, `requireRole("admin")`):

| Method & path | Fungsi |
|---|---|
| `GET /admin/limits` | Tabel default per kategori + daftar override |
| `POST /admin/limits/defaults` | Body form `category`, `amount` (kosong = hapus → tidak terbatas) |
| `POST /admin/limits/overrides` | Body form `user_id`, `category`, `amount` (wajib angka) |
| `POST /admin/limits/overrides/delete` | Body form `user_id`, `category` |

Sales yang membuka route ini mendapat 403 (AC-26). Input tidak valid mendapat 400 dengan pesan per field (AC-27). Form ajukan dan edit klaim menampilkan error `limit_exceeded` seperti error form lain, sehingga `isFormError` perlu menerima kode ini. Form Ajukan klaim dan halaman Klaim menampilkan sisa plafon (F4).

### B4. Rencana implementasi plafon (nanti)

| Langkah | Isi | AC PRD |
|---|---|---|
| P1 | Migrasi `0002_claim_limits.sql`, `domain/limits.ts` + unit test | AC-10, 11, 13, 16 (tingkat fungsi) |
| P2 | `LimitRepository` + audit, use case atur plafon | AC-27, 28 |
| P3 | Penegakan atomik di `ClaimRepository` (insert/submit/update) + test paritas + test paralel | AC-1–9, 12–15, 17–24 |
| P4 | Error `limit_exceeded` di API dan form web | AC-2, 4, 6, 25 |
| P5 | Halaman `/admin/limits`, tampilan sisa plafon | AC-26, 29, 30 (manual) |
| P6 | Regresi penuh, update README, ARCHITECTURE, CLAUDE.md | AC-31 |

## Verifikasi

- **Bagian A:**
  - `npm run typecheck` dan `npm test` hijau di setiap commit R0–R6.
  - Boundary test hijau.
  - `git diff` di `test/api` dan `test/web` hanya menyentuh path import.
  - `npm run mcp:inspect` tetap menampilkan 3 Tool yang sama.
- **Bagian B:** setiap AC di PRD punya test yang namanya memuat ID-nya (misalnya `it("AC-24 ...")`), sehingga pass/fail bisa dicek per kriteria.
