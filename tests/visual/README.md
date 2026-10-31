# Pengujian tampilan halaman game

Dua lapisan pemeriksaan:

1. **Panel komponen produksi:** Playwright memuat komponen React dan SCSS asli. IPC diganti fixture memori, diberi label **DATA CONTOH**. Enam kondisi: belum diatur, backup berjalan, selesai, riwayat, pemulihan berjalan, dan gagal. Setiap kondisi diperiksa pada jendela 1440×1000 dan 1024×768, lalu diambil screenshot. Delapan pengujian interaksi tambahan mencakup backup/pemulihan simulasi, pembatalan, buka folder dengan ID tersimpan, pembaruan progres, dan kegagalan. Total 20 pengujian. Dialog konfirmasi fixture menggunakan dialog browser; bukan dialog Electron asli.
2. **Halaman game Hydra Windows:** aplikasi portable v0.2.2 dari build terverifikasi `41234708380` dijalankan pada Windows CI. Profil sementara diverifikasi sebelum memasukkan game kustom contoh melalui API aplikasi. Game tidak dijalankan, Auto Backup tidak diaktifkan, dan tidak ada save pengguna yang digunakan. Pemeriksaan mencakup route `/game/custom/:objectId`, panel belum diatur, tombol backup nonaktif, tidak ada versi pulihkan, lebar panel, dan screenshot halaman/panel.

Pemeriksaan browser memakai komponen checkout terbaru. Pemeriksaan Windows sengaja dipatok ke paket v0.2.2 (sumber `e2e62a4be8f0e296710a06e7e06fe9ac493ac88b`), bukan build terbaru otomatis. Ganti run paket setelah rilis baru diverifikasi; artifact paket berlaku 30 hari. Jika paket kedaluwarsa, langkah Windows gagal dengan jelas dan screenshot browser tetap diunggah. Tidak ada pembuatan installer atau publikasi rilis dalam workflow ini. Pengambilan paket menggunakan token Actions sehingga dapat berjalan pada repo privat.

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
