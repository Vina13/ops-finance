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

## Data demo (lab)

```powershell
$env:DEMO_PASSWORD = "<password-lab-min-10-karakter>"
npm run db:seed      # MENGHAPUS data D1 lokal, lalu isi Dewi (admin), Rina & Budi (sales), 3 klaim
npm run receipts     # buat ulang receipts/makan-2026-10-19.png dan receipts/parkir-injeksi.png (fiktif)
```

`receipts/parkir-injeksi.png` sengaja berisi teks prompt injection untuk latihan: teks di struk adalah data, bukan instruksi.

## MCP server (Claude Code)

`mcp/server.ts` (stdio) memanggil `/api/*` atas nama pemilik token:

| Tool | Jenis | Rule di `.claude/settings.json` |
|---|---|---|
| `list_my_claims` | baca (`readOnlyHint`) | allow |
| `create_claim` | tulis (`anthropic/requiresUserInteraction`) | ask |
| `upload_receipt` | tulis (`anthropic/requiresUserInteraction`), hanya file PNG/JPEG/PDF ≤5 MB di folder proyek | ask |

Tidak ada Tool approve/tolak; keputusan tetap di admin lewat Web App.

1. Login sebagai sales, buka **Token API**, buat token `claims:read` + `claims:write`.
2. Simpan di env laptop, bukan di file yang di-commit:
   ```powershell
   $env:OPS_FINANCE_TOKEN = "opsf_..."   # atau setx OPS_FINANCE_TOKEN "opsf_..." untuk permanen
   ```
3. Cek Tool: `npm run mcp:inspect` (atau `npx @modelcontextprotocol/inspector --cli node --import tsx mcp/server.ts --method tools/list`).
4. Buka Claude Code di folder ini, setujui server `ops-finance` dari `.mcp.json`, cek `/mcp`.

## Struktur

- `migrations/`: skema D1
- `src/claims/`: modul klaim (Clean Architecture, lihat `docs/adr/0001-claims-feature-module.md`):
  - `domain/` aturan murni,
  - `application/` use case,
  - `infrastructure/` SQL D1 dan R2,
  - `interface/` route, view, dan skema.
- `src/services/users.ts`: user dan login
- `src/routes/web/`: login, admin user, settings; memasang route web klaim (sesi cookie dan CSRF)
- `src/routes/api/`: `/api/me`; memasang route API klaim (token Bearer)
- `docs/`: PRD, TRD, ARCHITECTURE, ADR
- `src/auth/`: sesi dan token API
- `test/`: test Vitest
