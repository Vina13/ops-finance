# ops-finance — Klaim Biaya Ops Sales

Cloudflare Worker (Hono + D1 + R2) untuk mengajukan dan menyetujui klaim biaya.

- **Admin**: kelola user, buat/ubah/hapus semua klaim, approve/reject/tandai dibayar (hanya di web app).
- **Sales**: lihat dan ajukan klaim miliknya sendiri.
- **API JSON** `/api` dengan token pribadi (hanya hash SHA-256 yang disimpan). Scope: `claims:read`, `claims:write`.

Alur status: `draft → submitted → approved | rejected`, lalu `approved → paid`.

## Setup lokal

```bash
npm install
npm run db:migrate:local
npm run create-admin -- --email admin@contoh.co.id --name "Admin Ops"
npx wrangler d1 execute ops-finance --local --file .wrangler/create-admin.sql
npm run dev
```

Buka http://localhost:8787, login sebagai admin, lalu tambahkan akun Sales di menu **User**.

## Test

```bash
npm run typecheck
npm test
```

Test berjalan di runtime Workers (Miniflare) dengan D1 dan R2 lokal (`@cloudflare/vitest-plugin`). Migrasi diterapkan ulang di setiap test.

## Deploy

```bash
npx wrangler login
npx wrangler d1 create ops-finance            # salin database_id ke wrangler.jsonc
npx wrangler r2 bucket create ops-finance-attachments
npm run db:migrate:remote
npm run create-admin -- --email admin@contoh.co.id --name "Admin Ops"
npx wrangler d1 execute ops-finance --remote --file .wrangler/create-admin.sql
npm run deploy
```

## API

Buat token di menu **Token API**. Token hanya ditampilkan sekali.

```bash
curl -H "Authorization: Bearer opsf_..." https://<worker>/api/claims
```

| Method & path | Scope |
|---|---|
| `GET /api/me` | token valid |
| `GET /api/claims?status=&from=&to=&user_id=&limit=&cursor=` | `claims:read` |
| `GET /api/claims/:id` | `claims:read` |
| `POST /api/claims` | `claims:write` |
| `PATCH /api/claims/:id` | `claims:write` |
| `DELETE /api/claims/:id` | `claims:write` |
| `POST /api/claims/:id/submit` | `claims:write` |
| `POST /api/claims/:id/attachments` (multipart `file`) | `claims:write` |
| `GET /api/claims/:id/attachments/:attId` | `claims:read` |

Contoh body `POST /api/claims` (nominal dalam rupiah, bilangan bulat):

```json
{ "title": "Taksi ke klien", "category": "transport", "expense_date": "2026-10-01", "amount": 150000, "description": "PP", "submit": true }
```

Admin wajib mengisi `user_id` (sales pemilik klaim). Kategori: `transport`, `meal`, `lodging`, `entertainment`, `other`.

Error selalu berbentuk `{ "error": { "code", "message", "details?" } }`:

| Status | Arti |
|---|---|
| 401 | Token tidak ada, salah, dicabut, atau kedaluwarsa |
| 403 `invalid_scope` | Scope token kurang |
| 404 | Klaim tidak ada atau bukan milik Anda |
| 409 | Transisi status tidak valid |
| 400 | Validasi gagal |

## Struktur

- `migrations/`: skema D1
- `src/services/`: aturan bisnis (akses, state machine), dipakai bersama oleh web dan API
- `src/routes/web/`: halaman Hono JSX (sesi cookie dan CSRF)
- `src/routes/api/`: API JSON (token Bearer)
- `src/auth/`: sesi dan token API
- `test/`: test Vitest
