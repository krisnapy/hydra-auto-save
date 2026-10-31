# Pengujian tampilan halaman game

Dua lapisan pemeriksaan:

1. **Panel komponen produksi:** Playwright memuat komponen React dan SCSS asli. IPC diganti fixture memori, diberi label **DATA CONTOH**. Enam kondisi: belum diatur, backup berjalan, selesai, riwayat, pemulihan berjalan, dan gagal. Setiap kondisi diperiksa pada jendela 1440×1000 dan 1024×768, lalu diambil screenshot. Sepuluh pengujian interaksi tambahan mencakup backup/pemulihan simulasi, pembatalan, buka folder dengan ID tersimpan, pembaruan progres, dan kegagalan. Total 22 pengujian, termasuk membuka/menutup riwayat dan menu pilihan. Dialog konfirmasi fixture menggunakan dialog browser; bukan dialog Electron asli.
2. **Halaman game Hydra Windows:** aplikasi portable dari build Windows yang memicu workflow dijalankan pada Windows CI. Profil sementara diverifikasi sebelum memasukkan game kustom contoh melalui API aplikasi. Game tidak dijalankan, Auto Backup tidak diaktifkan, dan tidak ada save pengguna yang digunakan. Pemeriksaan mencakup route `/game/custom/:objectId`, panel belum diatur, tombol backup nonaktif, tidak ada versi pulihkan, lebar panel, dan screenshot halaman/panel.

Pemeriksaan browser memakai komponen checkout terbaru pada push/manual. Pemeriksaan Windows berjalan setelah workflow **Windows installer** berhasil: checkout sumber build yang sama, unduh artifact dari run tersebut, verifikasi checksum, lalu buka paket. Laporan merekam versi, SHA sumber, dan run build. Tidak ada paket versi lama yang digunakan untuk memverifikasi UI baru. Artifact paket berlaku 30 hari. Workflow ini tidak membuat installer atau menerbitkan rilis. Pengambilan paket menggunakan token Actions sehingga dapat berjalan pada repo privat.

## Menjalankan pemeriksaan browser lokal

Dari root repository, dengan Node.js 22:

```sh
npm ci --ignore-scripts
npm ci --prefix tests/visual --ignore-scripts
npx --prefix tests/visual playwright install chromium
npx --prefix tests/visual playwright test -c tests/visual/playwright.config.mjs
node tests/visual/gallery.mjs
```

Buka `visual-results/index.html` untuk galeri atau `visual-results/playwright/index.html` untuk laporan. Gambar berada di `visual-results/screenshots/`. Folder hasil tidak masuk source control. Server pengujian hanya mendengarkan localhost dan berhenti setelah pengujian.

Workflow **Game page visual tests** menyediakan artifact **Game-page-visual-report**. Unduh, ekstrak, lalu buka `index.html`. Repo privat memerlukan akses GitHub untuk mengunduh artifact.

Ini pemeriksaan isi, kontrol, overflow, dan screenshot untuk tinjauan manusia; **belum ada pembandingan piksel otomatis terhadap baseline**. Hasilnya tidak membuktikan backup/pemulihan save nyata atau unggahan penyedia cloud. Backend tetap memiliki pengujian terpisah melalui `npm test`.
