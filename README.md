# Hydra Personal Cloud Backup — 0.1.0

Implementasi awal modul backup untuk salinan kode **Hydra Launcher 4.3.0 di Windows**. Proyek ini berisi mesin backup, tampilan pengaturan dan riwayat per game, serta pemasang integrasi ke sumber Hydra. Ini **belum installer Windows siap pakai** dan belum diuji langsung dengan game atau penyedia cloud di Windows.

Draft awal tetap tersedia di [docs/rancangan-auto-backup.md](docs/rancangan-auto-backup.md). Keputusan implementasi awal dan batas verifikasi tercatat di [docs/implementasi.md](docs/implementasi.md).

## Yang sudah dibuat

- Pemantauan perubahan isi save selama Hydra berjalan, dengan pemeriksaan setiap 5 detik dan masa stabil awal 1,2 detik.
- Deteksi file save melalui perintah preview Ludusavi. Game Steam dicocokkan dengan Steam ID; game kustom memakai judul persis. Kecocokan tidak pasti memerlukan pengaturan manual.
- Pemilihan file atau folder save manual melalui dialog Windows.
- Backup ke folder sinkronisasi lokal, dengan identitas perangkat tersendiri.
- SHA-256 untuk membandingkan isi dan memeriksa integritas. Isi yang sama tidak membuat versi normal baru.
- Riwayat awal 10 versi normal per game **per perangkat**. Backup pengaman sebelum pemulihan tidak dihapus otomatis.
- Penanda selesai dan pemeriksaan kelengkapan sebelum versi ditampilkan untuk pemulihan.
- Backup manual, pemicu setelah game ditutup, pemulihan dengan konfirmasi, dan catatan aktivitas lokal.
- Backup pengaman sebelum mengganti save, persiapan file sebelum pemulihan, serta rollback apabila penggantian lintas lokasi gagal.
- Penguncian peluncuran melalui Hydra selama pemulihan serta pemeriksaan proses sebelum mengganti save.

Tahap awal mencakup game PC **Steam dan custom** dengan executable diketahui. Game Epic yang dikelola Hydra, emulasi, dan Hydra Nexus tidak diintegrasikan ke modul ini.

## Coba mesin backup tanpa Hydra

Memerlukan Node.js 20 atau lebih baru. Mesin backup dan pengujiannya tidak memerlukan paket tambahan.

```sh
npm test
npm run demo
```

Demo membuat folder `.demo-…` tersendiri dalam proyek ini, berisi save contoh dan tujuan cloud contoh. Demo membuat dua versi, memulihkan versi pertama, lalu mempertahankan versi pengaman dari kondisi sebelum pemulihan. Demo tidak mengakses save game asli atau akun cloud.

## Pasang pada sumber Hydra

Gunakan salinan sumber yang bersih dari [Hydra v4.3.0](https://github.com/hydralauncher/hydra/tree/v4.3.0), commit `5845549311a20d485d027da875307fc70897bfdc`. Jangan arahkan ke folder aplikasi Hydra yang sudah terpasang: pemasang ini mengubah **kode sumber**.

Dari folder proyek ini, jalankan:

```sh
node scripts/apply-hydra.mjs "C:\Projects\hydra-4.3.0"
```

Pemasang memeriksa hash seluruh file yang akan dihubungkan sebelum menulis. Jika sumber berbeda, versi tidak cocok, atau file modul sudah ada, pemasang berhenti. Sumber asli disimpan di `.personal-backup-originals` dalam salinan Hydra. Pemasang tidak mengunduh Hydra, menjalankan Git, memasang dependensi Hydra, atau membangun executable.

Setelah itu, siapkan dependensi dan komponen native menggunakan prosedur build sumber Hydra pada Windows. Script upstream menyediakan `yarn typecheck` dan `yarn build:win`; build Hydra lengkap belum diverifikasi di lingkungan pengerjaan ini. Simpan perubahan modul sebelum memperbarui Hydra; pembaruan resmi dapat mengganti salinan aplikasi yang dibangun sendiri.

## Pengaturan di Hydra hasil build

1. Buka **Settings → Personal Cloud Backup**.
2. Pilih folder lokal yang dikelola aplikasi cloud, misalnya `Dropbox\Hydra Backups`.
3. Aktifkan **Auto Backup**. Modul mencoba menemukan Ludusavi bawaan Hydra. Jika tidak ditemukan, pilih `ludusavi.exe` secara manual.
4. Deteksi pertama mengunduh database Ludusavi ke pengaturan modul yang terpisah. Setelah database tersedia, deteksi memakai cache lokal. Tombol **Perbarui database lokasi save** tersedia untuk pembaruan berikutnya.
5. Buka halaman game untuk melihat lokasi, status, riwayat, **Backup sekarang**, dan **Pulihkan**. Untuk game yang belum dikenali, pilih file atau folder save manual.

Mematikan Auto Backup menghentikan penjadwalan berikutnya. Operasi yang sudah berjalan diselesaikan dengan aman. Tombol backup manual tetap dapat digunakan.

**Backup lokal selesai** berarti file lokal selesai dibuat. Periksa aplikasi cloud untuk mengetahui status unggahan; modul tidak mengklaim unggahan selesai.

## Batas versi ini

- Belum ada pengujian langsung di Windows, installer `.exe`, pengujian game nyata, atau verifikasi sinkronisasi OneDrive/Google Drive/Dropbox/pCloud.
- Belum ada build atau pemeriksaan tipe seluruh Hydra. Pemeriksaan lokal mencakup mesin backup, pemasang, sintaks file yang dihubungkan, tipe komponen React, dan bundle modul utama.
- Kontrak CLI Ludusavi dibuat dari dokumentasi upstream yang diperiksa saat pengerjaan; kompatibilitas binary yang dibawa build Hydra perlu diuji. Binary dan database Ludusavi tidak didistribusikan oleh proyek ini.
- Lokasi save relatif terhadap folder instalasi bergantung pada root instalasi yang dapat dikenali Ludusavi; lokasi instalasi Hydra belum diteruskan sebagai root pemindaian. Gunakan lokasi manual jika file tersebut belum ditemukan.
- Backup/riwayat yang ditawarkan untuk pemulihan hanya milik perangkat saat ini. Backup perangkat lain tetap terpisah; pemindahan/pemulihan lintas perangkat belum tersedia.
- Pemulihan memerlukan executable `.exe` langsung. Pemulihan diblokir jika ada proses dalam folder executable yang diketahui, peluncuran masih berlangsung, atau pemindaian proses gagal. Sesudah peluncuran melalui Hydra, ada jeda perlindungan 30 detik sebelum pemulihan diizinkan.
- Penulisan oleh game yang dibuka dari luar Hydra saat pemulihan berlangsung tetap memiliki celah waktu antara pemeriksaan proses dan penggantian file. Deteksi proses dan perilaku game dengan launcher/proses turunan perlu diuji di Windows.
- File yang stabil belum membuktikan konsistensi logis suatu game yang menulis banyak file. Versi setelah game ditutup perlu menjadi bagian dari pengujian tiap game.
- Symlink/junction dan folder yang saling bertumpuk ditolak. File Registry, save terlindungi/terenkripsi, dan file cloud yang belum tersedia secara lokal dapat memerlukan penanganan lain.
- Pemantauan file otomatis disegarkan setiap 60 detik. Penambahan slot save dapat terlambat ditemukan hingga pemindaian berikutnya. Jika semua lokasi save hilang, backup normal ditolak untuk menjaga riwayat lama.
- Mengubah lokasi save manual dapat membuat versi dari lokasi lama tidak dapat dipulihkan sampai pengaturan yang cocok dipilih kembali.
- Belum ada batas ukuran backup, kuota total, kompresi, atau pengukuran dampak performa untuk save besar. Riwayat pengaman dapat terus memakai ruang disk.
- Jika pemulihan terputus dan catatan pemulihan masih ada, pemulihan berikutnya diblokir. Pertahankan catatan, backup pengaman, serta folder `.hydra-previous-…` untuk pemeriksaan; jangan menghapusnya tanpa memastikan progres yang akan dipertahankan.

## Pemeriksaan integrasi tambahan

```sh
npm ci --ignore-scripts
npm run check:integration
```

Pemeriksaan ini menggunakan file sumber asli Hydra yang disertakan sebagai fixture uji. Dependensi pengembangan hanya dipakai untuk pemeriksaan TypeScript dan bundle; mesin backup memakai modul standar Node.js.

## Struktur proyek

| Lokasi | Isi |
| --- | --- |
| `module/` | Mesin backup, pengaturan/pemantauan, detektor Ludusavi, penguncian peluncuran |
| `integration/overlay/` | Penghubung Electron, IPC, komponen React, dan gaya tampilan |
| `integration/upstream.json` | Identitas tag/commit dan hash file Hydra yang diharapkan |
| `scripts/apply-hydra.mjs` | Pemasang integrasi dengan pemeriksaan sumber |
| `tests/` | Pengujian data, kegagalan, deteksi, dan pemasang integrasi |

Lihat [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) untuk sumber dan lisensi fixture Hydra.
