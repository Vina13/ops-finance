# Arsitektur ops-finance

Diperbarui setelah refactoring TRD Bagian A (R0–R6), 2026-10-22. Keputusan struktur: [ADR 0001](adr/0001-claims-feature-module.md). Bagian yang berupa **asumsi** atau belum diverifikasi ditandai ⚠️.

## Container

```
 Browser (admin/sales) ──cookie sid──┐
                                     ▼
                         ┌───────────────────────────────┐
 Claude Code ──stdio──► mcp/server.ts ──HTTP Bearer──►│ Cloudflare Worker (Hono)      │
   (Tool MCP)            (Node, tsx)    /api/*        │  src/index.tsx                │
                                                     │  ├─ /api/*  routes/api        │
 Integrasi lain ──HTTP Bearer opsf_…──────────────────►│  └─ /*      routes/web        │
                                                     │        │ (memasang route modul)│
                                                     │   src/claims (modul fitur)    │
                                                     └───────┬──────────────┬────────┘
                                                             ▼              ▼
                                                        D1 (SQLite)       R2 (struk)
```

| Container | Isi | Catatan |
|---|---|---|
| Worker | `src/index.tsx` memasang `/api` (`routes/api`) dan `/` (`routes/web`) | Satu Worker. Lokal lewat `wrangler dev`. |
| Web App | `routes/web/*` untuk login, admin user, dan settings. Route klaim berasal dari `src/claims` (`claimsWeb`). | Sesi cookie (`auth/session.ts`), `csrf()` dan `secureHeaders`. Middleware web dilewati untuk `/api/*`. |
| API JSON | `routes/api/index.ts` (`/me`) dan route klaim dari `src/claims` (`claimsApi`) | `requireToken` di semua route, `requireScope` per route. Tidak memakai cookie. |
| MCP server | `mcp/server.ts`, stdio, berjalan di laptop pengguna | **Hanya memanggil HTTP `/api`**. Skema Tool diimpor dari `src/claims/schemas.ts`. Tidak menyentuh D1 atau R2. |
| D1 | Skema di `migrations/0001_init.sql` | `users`, `sessions`, `api_tokens`, `claims`, `claim_attachments`, `claim_events`, `login_attempts` |
| R2 | Bucket `ops-finance-attachments` | Kunci objek `claims/<claimId>/<attachmentId>` |

## Modul `src/claims`

```
src/claims/
├── domain/          claim.ts, actor.ts, policy.ts, transitions.ts, attachment.ts, errors.ts  (murni)
├── application/     ports.ts, dto.ts, queries.ts, commands.ts, attachments.ts               (use case)
├── infrastructure/  d1ClaimRepository.ts, attachmentAdapters.ts                             (SQL + R2)
├── interface/       schemas.ts, service.ts, errors.ts, api.ts, web.tsx, views/, attachmentResponse.ts
├── index.ts         composition root + API publik (route, fungsi in-process, tipe, konstanta)
└── schemas.ts       entry publik ringan (skema + konstanta, tanpa Hono/D1) untuk mcp/
```

**Aturan dependensi** ditegakkan oleh `test/claims/boundaries.test.ts`:
- `domain` tidak mengimpor apa pun di luar dirinya.
- `application` hanya boleh mengimpor `domain`.
- `infrastructure` hanya boleh mengimpor `domain` dan `application`.
- `interface` tidak boleh mengimpor `infrastructure`. Adapter disuntikkan oleh `index.ts` lewat `DepsFactory`.
- Kode di luar modul hanya boleh mengimpor `src/claims/index.ts` atau `src/claims/schemas.ts`.

`interface/` boleh memakai bagian aplikasi lain yang dibutuhkan sebagai adapter HTTP:
- `src/middleware/auth` (`requireScope`, `requireRole`),
- `src/routes/web/form`,
- `src/services/users` (untuk dropdown sales di form admin),
- `src/views/Layout`, `src/views/format`, dan `src/lib/errors`.

## Akses DB

SQL hanya ada di adapter. Route handler, use case, dan domain tidak berisi SQL.

| File | `prepare()` |
|---|---|
| `src/claims/infrastructure/d1ClaimRepository.ts` | 11 |
| `src/claims/infrastructure/attachmentAdapters.ts` | 3 |
| `src/services/users.ts` | 12 |
| `src/auth/apiToken.ts` | 5 |
| `src/auth/session.ts` | 3 |
| file lain, termasuk `src/routes/**`, `src/claims/{domain,application,interface}`, `mcp/` | 0 |

Ciri `d1ClaimRepository`:
- `update()` memakai whitelist kolom, sehingga nama kolom tidak pernah berasal dari input.
- Pola update terjaga dipertahankan: `UPDATE ... WHERE status = ?`, lalu event `WHERE changes() = 1` dalam satu `db.batch`.

## Alur: ajukan klaim

1. Pengguna memicu pengajuan dari salah satu dari tiga jalur:
   - Claude memanggil Tool `create_claim` (`anthropic/requiresUserInteraction`, pengguna menekan **Allow**), lalu `mcp/server.ts` mengirim `POST /api/claims`,
   - integrasi memanggil API secara langsung,
   - pengguna mengisi form web `POST /claims/new`.
2. `requireToken` + `requireScope("claims:write")` (API), atau `requireSession` + CSRF (web).
3. `interface/api.ts` atau `interface/web.tsx` memanggil `claimService(deps).createClaim`. Di sana:
   - `interface/schemas.ts` memvalidasi input (400 jika tidak valid),
   - use case `application/commands.ts#createClaim` dijalankan,
   - `ClaimError` dipetakan menjadi `AppError` HTTP.
4. Use case memaksa pemilik klaim = user token (untuk sales), atau memvalidasi sales pilihan admin lewat `ClaimRepository.isActiveSales`. Setelah itu use case memanggil `ClaimRepository.insert(row, events)`.
5. `d1ClaimRepository.insert` menjalankan satu `db.batch` berisi `INSERT claims` dan `INSERT claim_events`.
6. Approve, tolak, dan bayar hanya ada di `interface/web.tsx` di belakang `requireRole("admin")`, dan dicek lagi di use case `transitionClaim`. API dan MCP tidak punya jalur ke sana.

## Aturan akses

- **Policy murni** di `domain/policy.ts`: `canView`, `canEdit`, `canDelete`, `canAttach`, `allowedTransitions`.
- **Ditegakkan di use case:**
  - `loadVisibleClaim` mengembalikan 404 jika klaim bukan milik sales,
  - `updateClaim`, `deleteClaim`, `transitionClaim` (admin-only + status asal), dan `addAttachment`,
  - `listClaims` memaksa `userId = actor.id` untuk sales.
- **View** memakai policy yang sama hanya untuk menampilkan atau menyembunyikan tombol.
- **Token:** hash, revoked, expiry, dan user aktif dicek di SQL `verifyApiToken`. Scope dicek di `requireScope`.

## Test

| Jenis | Lokasi | Butuh D1? |
|---|---|---|
| Unit use case (repository in-memory) | `test/claims/useCases.test.ts` | Tidak |
| Batas modul | `test/claims/boundaries.test.ts` | Tidak |
| Integrasi service / API / web / lampiran | `test/services`, `test/api`, `test/web`, `test/attachments.test.ts` | Ya (Miniflare) |
| Karakterisasi body error dan bentuk JSON | `test/api/characterization.test.ts` | Ya |

## Temuan (sebelum dan sesudah refactoring)

1. **Sebelum:** SQL memang sudah tidak ada di handler dan logika klaim tidak ditulis dua kali. Materi Lab 1B menyebut `web.tsx` berisi 13 `prepare()`, tetapi materi itu tampaknya memakai starter yang berbeda. ⚠️ File `src/web.tsx`, `src/api.ts`, `src/auth.ts` tidak pernah ada di repo ini. Yang menjadi masalah sebenarnya: aturan bisnis bercampur dengan SQL di `services/claims.ts` (399 baris), sehingga aturan hanya bisa dites lewat D1.
2. **Sesudah:** aturan bisnis bisa dites tanpa D1, SQL terkumpul di dua adapter, dan arah dependensi dicek otomatis.
3. **Duplikasi kecil yang disengaja:**
   - Cek role admin untuk approve, tolak, dan bayar ada di route (`requireRole`) dan juga di use case. Ini pertahanan berlapis.
   - Pesan "field `file` wajib" ditulis di `interface/api.ts` dan `interface/web.tsx`, karena format body-nya berbeda (multipart API dan form web).
4. **MCP hanya memanggil `/api`.** Semua aturan akses, validasi, dan plafon nanti otomatis berlaku untuk Claude.

## Dampak ke `docs/PRD.md` (plafon klaim)

Plafon dibangun di atas modul ini (TRD Bagian B):
- **Aturan murni** di `domain/limits.ts`.
- **Port** `LimitRepository`.
- **Penegakan atomik** di `d1ClaimRepository.insert`/`update`. Use case `createClaim`, `transitionClaim("submit")`, dan `updateClaim` cukup meneruskan opsi `enforceLimit`.
- **Route web dan API klaim tidak berubah**, kecuali:
  - halaman admin baru `/admin/limits`,
  - tampilan sisa plafon di `interface/views/`,
  - kode error `limit_exceeded` yang perlu diterima `isFormError` di `routes/web/form.ts`.
- **MCP tidak perlu diubah.** Error 409 dari API sudah diteruskan sebagai `isError`. ⚠️ Belum dites dengan Claude Code sungguhan, baru dengan klien MCP uji.
