# Arsitektur ops-finance

Dipetakan dari kode di `src/` dan `mcp/` (branch `feat/klaim-biaya`, 2026-10-22). Bagian yang berupa **asumsi** atau belum diverifikasi ditandai ⚠️.

## Container

```
 Browser (admin/sales) ──cookie sid──┐
                                     ▼
                         ┌───────────────────────────┐
 Claude Code ──stdio──► mcp/server.ts ──HTTP Bearer──►│ Cloudflare Worker (Hono)  │
   (Tool MCP)            (Node, tsx)    /api/*        │  src/index.tsx            │
                                                     │  ├─ /api/*  routes/api    │
 Integrasi lain ──HTTP Bearer opsf_…──────────────────►│  └─ /*      routes/web    │
                                                     │        │                  │
                                                     │   services/ (aturan bisnis)│
                                                     └───────┬──────────┬────────┘
                                                             ▼          ▼
                                                        D1 (SQLite)   R2 (struk)
```

| Container | Isi | Catatan |
|---|---|---|
| Worker | `src/index.tsx` memasang `/api` (`routes/api`) dan `/` (`routes/web`) | Satu Worker. Lokal lewat `wrangler dev`. |
| Web App | Hono JSX server-rendered, `routes/web/*`, `views/*` | Sesi cookie (`auth/session.ts`), `csrf()` dan `secureHeaders` (`routes/web/index.ts:16-17`). Middleware web dilewati untuk `/api/*`. |
| API JSON | `routes/api/index.ts` | `requireToken` di semua route (`:21`), `requireScope` per route. Tidak memakai cookie. |
| MCP server | `mcp/server.ts`, stdio, berjalan di laptop pengguna | **Hanya memanggil HTTP `/api`** (`fetch` di `:52`) dengan `OPS_FINANCE_TOKEN`. Tidak menyentuh D1 atau R2. |
| D1 | Skema di `migrations/0001_init.sql` | `users`, `sessions`, `api_tokens`, `claims`, `claim_attachments`, `claim_events`, `login_attempts` |
| R2 | Bucket `ops-finance-attachments` | Kunci objek `claims/<claimId>/<attachmentId>` |

## Lapisan dan akses DB

SQL **hanya** ada di lapisan service/auth. Route handler tidak berisi SQL. Route hanya meneruskan `c.env.DB` ke service.

| File | `prepare()` | `db.batch` |
|---|---|---|
| `src/services/claims.ts` | 12 | 6 |
| `src/services/users.ts` | 12 | 1 |
| `src/auth/apiToken.ts` | 5 | 0 |
| `src/auth/session.ts` | 3 | 0 |
| `src/services/attachments.ts` | 3 | 1 |
| `src/routes/**`, `mcp/server.ts` | 0 | 0 |

Validasi input klaim ada di `src/validate.ts`. Validasi itu dipanggil dari dalam service, sehingga web, API, dan MCP (lewat API) memakai skema yang sama.

## Alur: ajukan klaim

Semua penulisan ke tabel `claims` ada di `src/services/claims.ts`:

| Statement | Fungsi | Dicapai dari |
|---|---|---|
| `INSERT INTO claims` (`:290`) | `createClaim` | Web `POST /claims/new`, API `POST /api/claims`, MCP `create_claim` (selalu `submit: true`) |
| `UPDATE claims` (`:328`) | `updateClaim` | Web `POST /claims/:id/edit`, API `PATCH /api/claims/:id` |
| `UPDATE claims` (`:369`), perubahan status | `transitionClaim` | Web `POST /claims/:id/{submit,approve,reject,pay}`, API `POST /api/claims/:id/submit` |
| `UPDATE claims` (`:394`), soft delete | `deleteClaim` | Web `POST /claims/:id/delete`, API `DELETE /api/claims/:id` |

Contoh alur ajukan klaim lewat Claude:

1. Claude memanggil Tool `create_claim`. Tool ini ditandai `anthropic/requiresUserInteraction`, jadi pengguna harus menekan **Allow** dulu.
2. `mcp/server.ts` mengirim `POST /api/claims` dengan Bearer token.
3. `requireToken` memverifikasi hash token, memastikan token belum dicabut atau kedaluwarsa, dan user masih aktif. `requireScope("claims:write")` mengecek scope.
4. `createClaim` memvalidasi input (`validateClaimCreate`), memaksa pemilik klaim = user token (untuk sales), lalu menjalankan `db.batch` berisi `INSERT claims` dan `INSERT claim_events`.
5. Klaim muncul di Web App dengan status `submitted`. Approve, tolak, dan bayar hanya ada di Web App untuk admin. API dan MCP tidak punya jalur ke sana.

## Aturan akses

- Fungsi aturan ada di `src/services/claims.ts`: `canView`, `canEdit`, `canDelete`, `canAttach`, `allowedTransitions`.
- Ditegakkan di:
  - `getClaim`: 404 jika bukan milik sales.
  - `updateClaim`, `deleteClaim`, `transitionClaim` (admin-only + status asal), dan `addAttachment`.
  - `listClaims` memaksa `user_id = actor.id` untuk sales.
- `views/claims.tsx` memakai fungsi yang sama hanya untuk menampilkan atau menyembunyikan tombol, bukan untuk otorisasi.
- Token: hash, revoked, expiry, dan user aktif dicek di SQL `verifyApiToken` (`auth/apiToken.ts:80-81`). Scope dicek di `requireScope` (`middleware/auth.ts:42`).

## Temuan

1. **SQL tidak ada di handler, dan logika klaim tidak ditulis dua kali.** Ini berbeda dengan materi Lab 1B, yang menyebut `web.tsx` berisi 13 `prepare()` dan logika ganda. Di repo ini semua jalur web, API, dan MCP berakhir di fungsi service yang sama. ⚠️ Materi lab tampaknya memakai starter yang berbeda (`src/web.tsx`, `src/api.ts`, `src/auth.ts`). File-file itu tidak ada di repo ini.
2. **Duplikasi kecil yang masih ada**, tidak menyangkut aturan bisnis:
   - Cek role admin untuk approve, tolak, dan bayar dilakukan dua kali, di route (`requireRole`) dan di service. Ini pertahanan berlapis yang disengaja.
   - Filter `user_id` untuk sales juga ada di dua tempat: route web membuangnya, dan service memaksanya.
   - Pesan "field `file` wajib" ditulis di route API (`:72`) dan di route web (`:188`).
   - Parsing body berbeda per lapisan: `readJson` di API, `readForm`/`parseAmount` di web.
3. **Validasi Zod di route** ada di `routes/web/admin.tsx` dan `routes/web/settings.tsx`, untuk user dan token. Keduanya jalur web-only, jadi tidak terduplikasi. Tetap perlu dicatat kalau nanti fitur yang sama dibuka di API.
4. **MCP hanya memanggil `/api`** (koreksi atas asumsi bahwa MCP membaca D1 langsung). Akibatnya semua aturan akses, validasi, dan plafon nanti otomatis berlaku untuk Claude.

## Dampak ke `docs/PRD.md` (plafon klaim)

- Aturan plafon **cukup ditulis di satu tempat**, yaitu `src/services/claims.ts`. Ada tiga titik masuk, dan semuanya sudah menjadi pintu tunggal untuk web, API, dan MCP:
  - `createClaim`, saat `submit: true` (AC-1 sampai AC-4, AC-19, AC-24, AC-25),
  - `transitionClaim("submit")` (AC-6),
  - `updateClaim`, untuk klaim `submitted` (AC-20 sampai AC-22).
- Tidak perlu mengubah route handler kecuali untuk:
  - halaman admin baru `/admin/limits` (F1),
  - menampilkan sisa plafon di `views/claims.tsx` (F4),
  - meneruskan error `limit_exceeded` (409) ke form web. `isFormError` di `routes/web/form.ts` saat ini hanya menerima kode `validation`, `conflict`, dan sejenisnya. ⚠️ Kode baru perlu ditambahkan ke sana, atau dipetakan ke `conflict`.
- Syarat atomik (F3) sejalan dengan pola yang sudah ada: `UPDATE ... WHERE status = ?` lalu cek `changes()`. Cek plafon bisa dimasukkan ke klausa `WHERE` yang sama.
- MCP tidak perlu diubah. Error 409 dari API sudah diteruskan sebagai `isError` (AC-25). ⚠️ Belum dites dengan Claude Code sungguhan, baru dengan klien MCP uji.
