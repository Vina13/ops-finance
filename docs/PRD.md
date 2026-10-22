# PRD: Plafon Klaim per Kategori per Bulan

Status: draf, menunggu review · Pemilik: Ops Finance · Tanggal: 2026-10-22

## Latar belakang

Saat ini sales bisa mengajukan klaim berapa pun selama nominalnya > 0 dan ≤ `MAX_AMOUNT` (`src/validate.ts`). Finance tidak punya batas pengeluaran per kategori, sehingga kontrol biaya hanya terjadi saat admin menolak klaim satu per satu. Fitur ini menambahkan **plafon bulanan per kategori untuk setiap sales**, yang ditegakkan saat klaim diajukan.

## Keputusan dari wawancara

| Topik | Keputusan |
|---|---|
| Lingkup | Per sales. Ada plafon default per kategori, dan admin bisa memberi **override** per (sales, kategori). |
| Penegakan | **Hard block saat diajukan.** Draft tetap boleh disimpan. |
| Pemakaian dihitung dari | Klaim berstatus `submitted`, `approved`, `paid` yang belum dihapus. `draft` dan `rejected` tidak dihitung. |
| Periode | Bulan kalender dari `expense_date` (YYYY-MM). `expense_date` berupa tanggal tanpa jam, jadi tidak ada pergeseran zona waktu dan bulan WIB sama dengan bulan dari string tanggal. |
| Kategori tanpa plafon | Tidak terbatas. |
| Admin | Kena aturan yang sama, termasuk saat membuat klaim atas nama sales atau mengubah klaim `submitted`. Kalau perlu lebih, admin menaikkan override. |
| Perubahan plafon | Berlaku ke depan saja. Klaim yang sudah masuk tidak diubah. Setiap perubahan tercatat. |
| Override | Menggantikan default dan boleh lebih tinggi atau lebih rendah. Menghapus override berarti kembali ke default. Override selalu berupa angka, tidak bisa "tak terbatas". |
| Konkurensi | **Atomik di DB.** Dua pengajuan bersamaan tidak boleh sama-sama lolos melewati plafon. |
| Visibilitas sisa plafon | Web (form Ajukan klaim dan halaman Klaim) serta pesan error. **Tidak** ada endpoint API atau Tool MCP baru. |
| Laporan admin | Tidak ada. Cukup halaman untuk mengatur plafon. |

## Definisi

- **Plafon efektif** (sales S, kategori K) = override (S, K) jika ada. Jika tidak, plafon default K jika ada. Jika keduanya tidak ada, **tidak terbatas**.
- **Terpakai** (S, K, bulan M) = jumlah `amount` dari klaim milik S dengan kategori K, `substr(expense_date, 1, 7) = M`, status ∈ {submitted, approved, paid}, dan `deleted_at IS NULL`. Klaim yang sedang diubah tidak ikut dihitung.
- **Sisa** = plafon efektif − terpakai. Nilainya bisa negatif kalau plafon diturunkan setelah ada pemakaian.
- **Lolos plafon** jika terpakai + nominal klaim ≤ plafon efektif. Nilai yang **tepat sama** dengan plafon diizinkan.

## Kapan plafon dicek

Plafon dicek setiap kali sebuah klaim masuk atau berubah di dalam himpunan "dihitung":

1. Membuat klaim langsung diajukan (`submit: true`) lewat web, API, atau MCP `create_claim`.
2. Mengajukan draft (`draft → submitted`) lewat web atau API `POST /api/claims/:id/submit`.
3. Admin mengubah klaim `submitted` (nominal, kategori, atau tanggal). Klaim dicek terhadap kategori dan bulan **barunya**.

Plafon **tidak** dicek saat:
- menyimpan atau mengubah draft,
- approve, reject, atau pay. Pemakaian tidak berubah karena klaim `submitted` sudah dihitung.

## Kebutuhan fungsional

**F1. Pengaturan plafon (admin, web).** Halaman `/admin/limits` berisi:
- plafon default per kategori: isi angka rupiah atau kosongkan untuk "tidak terbatas",
- daftar override per (sales, kategori), yang bisa ditambah, diubah, atau dihapus.

Nilai yang diterima adalah bilangan bulat rupiah dari 0 sampai `MAX_AMOUNT`. Nilai 0 berarti kategori itu tidak bisa diajukan.

**F2. Penegakan.** Pengajuan yang melewati plafon ditolak seluruhnya, tanpa pemecahan otomatis, dengan:
- HTTP **409**,
- kode error `limit_exceeded`,
- `details` berisi `{ category, month, limit, used, remaining, amount }`,
- pesan berbahasa Indonesia yang menyebut sisa plafon, misalnya "Plafon Makan Oktober 2026 tersisa Rp1.580.000, klaim Rp2.000.000 melebihi plafon."

Di web, form dirender ulang dengan pesan itu dan isian tetap terjaga. Di MCP, `create_claim` meneruskan pesan error API apa adanya.

**F3. Atomik.** Pengecekan dan penulisan terjadi dalam satu statement atau batch D1 bersyarat, sehingga tidak ada celah baca-lalu-tulis.

**F4. Visibilitas.**
- Form Ajukan klaim menampilkan sisa plafon bulan berjalan per kategori. Untuk admin, sisa plafon itu milik sales yang dipilih.
- Halaman Klaim (milik sales) menampilkan ringkasan sisa plafon bulan berjalan.
- Kategori tanpa plafon ditampilkan sebagai "tidak terbatas".

**F5. Audit.** Setiap perubahan plafon default atau override dicatat: siapa, kapan, lingkup (default/override + sales), kategori, nilai lama, nilai baru.

**F6. Akses.**
- Hanya admin yang bisa melihat dan mengubah halaman plafon. Sales yang membukanya mendapat 403.
- Sales hanya melihat sisa plafon miliknya.
- Tidak ada perubahan scope token API.

## Acceptance criteria

Setiap kriteria dites otomatis (Vitest) kecuali yang ditandai *(manual)*. Contoh memakai plafon default **meal = Rp2.000.000**, sales **Rina**, bulan **2026-10**.

| ID | Skenario | Hasil yang diharapkan (pass) |
|---|---|---|
| AC-1 | Rina belum punya klaim meal bulan 2026-10, lalu mengajukan klaim meal Rp2.000.000 bertanggal 2026-10-05. | 201, status `submitted`. |
| AC-2 | Setelah AC-1, Rina mengajukan klaim meal Rp1 bertanggal 2026-10-20. | 409 `limit_exceeded`, `details.remaining = 0`, tidak ada baris klaim baru. |
| AC-3 | Rina memakai Rp1.500.000, lalu mengajukan Rp500.000. | 201 (tepat sama dengan plafon diizinkan). |
| AC-4 | Rina memakai Rp1.500.000, lalu mengajukan Rp600.000. | 409. Pesan menyebut sisa Rp500.000. Klaim **tidak** dipecah atau dikurangi. |
| AC-5 | Rina menyimpan draft meal Rp5.000.000. | 201, status `draft` (draft tidak dicek). |
| AC-6 | Draft dari AC-5 diajukan lewat web dan lewat `POST /api/claims/:id/submit`. | Keduanya 409. Status tetap `draft`. Tidak ada event `submitted`. |
| AC-7 | Rina punya klaim meal `rejected` Rp2.000.000 di bulan itu, lalu mengajukan klaim Rp2.000.000. | 201 (rejected tidak dihitung). |
| AC-8 | Rina punya klaim meal `draft` Rp2.000.000, lalu mengajukan klaim lain Rp2.000.000. | 201 (draft tidak dihitung). |
| AC-9 | Klaim `submitted` Rp2.000.000 di-soft-delete admin, lalu Rina mengajukan Rp2.000.000. | 201 (klaim terhapus tidak dihitung). |
| AC-10 | Rina memakai Rp2.000.000 untuk tanggal 2026-10-31, lalu mengajukan Rp2.000.000 untuk tanggal 2026-11-01. | 201 (bulan berbeda). |
| AC-11 | Klaim bertanggal 2026-10-15 diajukan pada 2026-11-03. | Dihitung ke plafon **2026-10**, bukan 2026-11. |
| AC-12 | Budi memakai meal Rp2.000.000 bulan itu, lalu Rina mengajukan Rp2.000.000. | 201 (plafon per sales, bukan per tim). |
| AC-13 | Kategori `entertainment` tanpa plafon default dan tanpa override, lalu ada pengajuan Rp50.000.000. | 201. |
| AC-14 | Override Rina meal = Rp3.000.000 (default tetap Rp2.000.000), lalu Rina mengajukan Rp3.000.000 dan Budi mengajukan Rp3.000.000. | Rina 201, Budi 409. |
| AC-15 | Override Rina meal = Rp500.000 (lebih rendah dari default), lalu Rina mengajukan Rp600.000. | 409. |
| AC-16 | Override Rina dihapus. | Plafon efektif Rina kembali Rp2.000.000. |
| AC-17 | Plafon default meal = 0, lalu ada pengajuan meal Rp1. | 409. |
| AC-18 | Rina memakai Rp1.800.000, lalu admin menurunkan default meal menjadi Rp1.000.000. | Klaim yang ada tidak berubah. Sisa yang ditampilkan −Rp800.000. Pengajuan meal berikutnya Rp1 → 409. |
| AC-19 | Admin membuat klaim atas nama Rina dengan `submit: true` melebihi plafon. | 409, sama seperti sales. |
| AC-20 | Admin mengubah klaim `submitted` Rina dari Rp1.000.000 menjadi Rp2.500.000 (plafon 2.000.000, tidak ada klaim lain). | 409. Nominal tetap Rp1.000.000. Klaim itu sendiri tidak dihitung dua kali. |
| AC-21 | Admin mengubah klaim `submitted` Rina Rp1.000.000 menjadi Rp2.000.000. | 200 (klaim sendiri dikecualikan dari "terpakai"). |
| AC-22 | Admin memindahkan klaim `submitted` dari kategori transport ke meal, atau dari 2026-10 ke 2026-11, yang plafonnya sudah habis. | 409. Dicek terhadap kategori dan bulan baru. |
| AC-23 | Approve, reject, dan pay pada klaim `submitted` ketika plafon sudah diturunkan di bawah pemakaian. | Ketiganya berhasil (tidak ada cek plafon saat keputusan). |
| AC-24 | Dua pengajuan meal Rp1.500.000 dikirim paralel (`Promise.all`) dengan sisa Rp2.000.000. | Tepat satu 201 dan satu 409. Total terpakai ≤ Rp2.000.000. |
| AC-25 | Pengajuan lewat MCP `create_claim` melebihi plafon. | Hasil Tool `isError: true` dengan pesan sisa plafon dari API. |
| AC-26 | Sales membuka `GET /admin/limits` atau mengirim POST ke sana. | 403. Plafon tidak berubah. |
| AC-27 | Admin menyimpan plafon −1, 1.5, "abc", atau > `MAX_AMOUNT`. | 400 dengan pesan per field. Nilai lama tetap. |
| AC-28 | Admin mengubah default meal dari 2.000.000 ke 3.000.000, lalu menambah override Rina. | Ada 2 baris audit dengan actor, waktu, lingkup, kategori, nilai lama, dan nilai baru yang benar. |
| AC-29 | Rina membuka form Ajukan klaim dengan pemakaian meal Rp1.500.000. | HTML menampilkan sisa meal Rp500.000 dan "tidak terbatas" untuk kategori tanpa plafon. |
| AC-30 | Admin membuka form Ajukan klaim dan memilih Budi. | Sisa plafon yang tampil milik Budi, bukan milik admin. *(manual: berpindah pilihan sales di browser)* |
| AC-31 | Seluruh test lama tetap hijau, `npm run typecheck` bersih. | Pass. |

## Non-goals

- Laporan atau dasbor pemakaian plafon untuk admin.
- Endpoint API atau Tool MCP untuk membaca sisa plafon (`/api/limits`, `get_my_limits`).
- Kuota bersama tim atau per region.
- Plafon yang dikunci per periode (tabel plafon per YYYY-MM) dan perubahan plafon yang berlaku surut.
- Soft limit atau penanda "melebihi plafon" yang tetap bisa diajukan.
- Override per klaim (pengecualian satu klaim) atau alasan override saat approve.
- Pemecahan otomatis klaim menjadi bagian dalam plafon dan sisanya.
- Sisa plafon yang terbawa ke bulan berikutnya, plafon prorata, atau plafon tahunan.
- Notifikasi email/chat saat plafon hampir habis.
- Multi-currency. Semua dalam rupiah (`currency = 'IDR'`).
- Mengubah scope token atau menambah izin baru di `.claude/settings.json`.

## Asumsi dan pertanyaan terbuka

- **Asumsi:** satu nilai plafon default per kategori berlaku untuk semua sales. Belum ada pembeda per region atau jabatan.
- **Asumsi:** `expense_date` selalu diisi sesuai struk. Plafon tidak mencegah sales mengisi tanggal lain. Itu tetap tanggung jawab review admin.
- **Asumsi:** halaman plafon cukup memakai Web App (cookie + CSRF) seperti halaman admin lain.
- **Terbuka:** apakah klaim yang sudah `approved` boleh di-edit admin? Saat ini tidak bisa (`canEdit`), jadi AC-20 sampai AC-22 hanya berlaku untuk `submitted`.

## Catatan implementasi (tidak mengikat)

- Tabel baru lewat **migrasi baru** `migrations/0002_claim_limits.sql`. Migrasi lama tidak diubah.
  - `claim_limits (category PK, amount)`
  - `claim_limit_overrides (user_id, category, amount, PK(user_id, category))`
  - `claim_limit_changes` (audit)
- Semua jalur penulisan klaim lewat `src/services/claims.ts` (`createClaim`, `updateClaim`, `transitionClaim`), jadi cek plafon cukup ditulis **di satu tempat**. Lihat `docs/ARCHITECTURE.md`.
- Untuk F3, gunakan `INSERT ... SELECT ... WHERE <terpakai> + ? <= <plafon>` dan `UPDATE ... WHERE ... AND <terpakai lain> + ? <= <plafon>`. Hasil `changes() = 0` berarti 409 `limit_exceeded`. SQL tetap memakai `prepare().bind()`.
