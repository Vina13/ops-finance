# ADR 0001: Modul fitur `src/claims` dengan Clean Architecture di dalamnya

- Status: **Diusulkan**
- Tanggal: 2026-10-22
- Terkait: [TRD](../TRD.md), [PRD plafon](../PRD.md), [ARCHITECTURE](../ARCHITECTURE.md)

## Konteks

Kode klaim saat ini tersebar di beberapa tempat:
- `src/services/claims.ts` (399 baris, berisi aturan bisnis dan SQL D1),
- `src/services/attachments.ts`,
- `src/validate.ts`,
- route klaim di `src/routes/api/index.ts` dan `src/routes/web/claims.tsx`,
- `src/views/claims.tsx`.

Semua jalur web, API, dan MCP sudah bertemu di fungsi service yang sama, dan SQL tidak ada di handler (lihat ARCHITECTURE). Masalahnya ada di tempat lain:

- Aturan bisnis seperti state machine dan hak akses tercampur dengan SQL, sehingga hanya bisa dites lewat D1 Miniflare.
- Plafon klaim (PRD) menambah aturan murni baru (plafon efektif, periode, status yang dihitung) **dan** SQL atomik khusus D1. Kalau tidak ada batas yang jelas, keduanya akan menumpuk di `services/claims.ts`.
- Tidak ada aturan tertulis tentang siapa boleh mengimpor apa.

Batasan yang berlaku:
- Cloudflare Workers, tanpa framework DI.
- Penegakan plafon harus atomik di D1 (PRD F3).
- SQL selalu `prepare().bind()` (CLAUDE.md).
- MCP hanya memanggil `/api`.
- Tim kecil, dan aplikasi ini dipakai untuk lab.

## Keputusan

Buat **modul fitur vertikal `src/claims`** dengan empat lapisan di dalamnya: `domain`, `application`, `infrastructure`, `interface`. Satu titik masuk publik ada di `src/claims/index.ts`.

- **Aturan dependensi:** `interface → application → domain`, dan `infrastructure` mengimplementasikan port di `application`. `domain` tidak mengimpor apa pun di luar dirinya (tidak Hono, zod, tipe D1/R2, atau `src/lib`). Kode di luar modul hanya boleh mengimpor `src/claims/index.ts`.
- **Port** berupa interface TypeScript dan factory fungsi biasa. Tidak ada kelas atau container DI.
- **Penegakan dependensi** lewat test Vitest (`test/claims/boundaries.test.ts`) yang memindai pernyataan import. Tidak ada dependensi baru.
- **Atomisitas plafon** dikerjakan di adapter D1 (insert/update bersyarat dalam satu statement atau batch). Aturan yang dipakai SQL berasal dari konstanta domain, dan test paritas menjaga keduanya tetap sama.
- **Migrasi bertahap** R0–R6 (TRD Bagian A). Facade re-export menjaga perilaku dan import lama sampai langkah terakhir. Plafon dibangun **setelah** refactoring selesai.

## Alternatif yang ditolak

| # | Alternatif | Alasan ditolak |
|---|---|---|
| 1 | **Tetap di `services/claims.ts`**, plafon ditambahkan langsung di sana | Paling sedikit perubahan, dan memang sudah satu titik masuk. Tetapi file akan sekitar dua kali lipat, aturan plafon tidak bisa dites tanpa D1, dan tidak ada batas yang mencegah SQL atau Hono masuk ke aturan bisnis. Masalah yang sama akan muncul lagi di fitur berikutnya. |
| 2 | **Clean Architecture horizontal untuk seluruh aplikasi** (`src/domain`, `src/application`, `src/infrastructure` global) | Mengharuskan `auth`, `users`, `tokens`, dan `sessions` ikut dipindah tanpa kebutuhan, sehingga perubahannya besar sekaligus. Kode satu fitur tetap tersebar di empat folder global. Modul vertikal membatasi perubahan pada area yang memang tumbuh. |
| 3 | **Hexagonal penuh dengan kelas dan DI container** (mis. tsyringe/inversify) | Butuh decorator atau reflect-metadata, menambah dependensi dan boilerplate, dan kurang cocok dengan model Workers (env per request). Factory fungsi + interface sudah cukup untuk mengganti adapter di test. |
| 4 | **Penegakan plafon dengan trigger SQLite di D1** (`BEFORE INSERT ... RAISE(ABORT)`) | Atomik secara bawaan, tapi aturannya tersembunyi di DB. Pesan error terbatas pada string `RAISE`, sehingga `details` (`remaining`, `limit`) sulit dihasilkan. Trigger juga sulit dites dan direview. Selain itu, logika bisnis di migrasi bertentangan dengan aturan "migrasi append-only" setiap kali aturan berubah. |
| 5 | **Cek plafon di use case dengan baca-lalu-tulis** (domain murni, tanpa SQL bersyarat) | Paling "bersih" secara arsitektur, tapi melanggar PRD F3. Dua pengajuan bersamaan bisa sama-sama lolos (AC-24). |
| 6 | **Worker atau service terpisah untuk plafon** (atau Durable Object sebagai penghitung kuota) | Menambah deployment, binding, dan latensi, dan menimbulkan masalah konsistensi antara D1 dan penghitung. Skala lab tidak membutuhkannya. D1 batch sudah atomik. |
| 7 | **dependency-cruiser atau ESLint `no-restricted-imports`** untuk menegakkan aturan dependensi | Menambah dependensi dan konfigurasi tooling yang saat ini belum ada (repo belum memakai ESLint). Test Vitest kecil sudah memberi sinyal gagal yang sama di `npm test`. Bisa dipertimbangkan ulang jika jumlah modul bertambah. |

## Konsekuensi

**Positif**
- Aturan bisnis klaim dan plafon bisa dites sebagai fungsi murni atau dengan repository in-memory. Hasilnya cepat, tanpa Miniflare.
- Perubahan plafon terkumpul di `src/claims`. Route lain, auth, dan MCP tidak tersentuh.
- Batas impor dicek otomatis di `npm test`.

**Negatif / risiko**
- Aturan plafon ditulis di dua bentuk, fungsi domain dan SQL bersyarat. Mitigasinya konstanta bersama dan test paritas.
- Lebih banyak file dan indireksi untuk aplikasi kecil. Juga ada masa transisi dengan facade (R1–R5) yang harus dibersihkan di R6.
- `mcp/server.ts` saat ini mengimpor `src/validate.ts`. Ekspornya harus dipindah ke entry ringan modul tanpa ikut membawa Hono atau D1 (TRD R6).
- Modul lain (users/auth) belum mengikuti pola ini. Ketidakseragaman ini diterima untuk sementara dan akan ditinjau di ADR berikutnya jika dibutuhkan.

## Kriteria untuk meninjau ulang keputusan ini

- Boundary test terlalu sering di-bypass atau dilonggarkan.
- Lebih dari dua modul fitur lain dibuat dengan pola ini. Saat itu pertimbangkan alat seperti dependency-cruiser.
- Kebutuhan konkurensi plafon melampaui jaminan D1 batch, misalnya plafon tim lintas sales dengan volume tinggi.
