# Pengujian tampilan halaman game

## Rilis 0.3.2 — 5 November 2026 — tombol optimisasi

[Rilis publik 0.3.2](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.3.2) · [build](https://github.com/krisnapy/hydra-auto-save/actions/runs/42030785571) · [verifikasi/publikasi](https://github.com/krisnapy/hydra-auto-save/actions/runs/42031735349) · [uji visual Windows](https://github.com/krisnapy/hydra-auto-save/actions/runs/42031735431) · [galeri](https://github.com/krisnapy/hydra-auto-save/actions/runs/42031735431/artifacts/13415649114). Sumber executable: `8fed514c9cec59e7d5d4856aa85e28060b5158e0`. Empat aset rilis berhasil diperiksa untuk unduhan anonim; rilis sebelumnya tetap tersedia.

34 tes visual/interaksi lulus pada viewport 1440×1000 dan 1024×768, memakai komponen React/SCSS produksi dengan data serta IPC contoh. Tambahan mencakup tombol optimisasi lokal di menu halaman game, tombol cloud setelah terhubung, progres dan hasil, pembatalan kedua operasi, serta pengaturan satu kolom tanpa overflow. Screenshot pengaturan tersedia secara lokal di `visual-results/screenshots/desktop-optimization-settings.png` dan `compact-optimization-settings.png`; screenshot compact telah diperiksa visual.

104 tes modul/integrasi lulus, termasuk penukaran direktori backup yang terputus, pemulihan hasil kompresi, ruang penuh, akun/ETag/riwayat berubah, paket rusak, unggahan tertunda, pembersihan sebagian, dan konfirmasi native pada handler IPC. Pemeriksaan sintaks 19 file TypeScript, tipe React dan bundle modul utama lulus. Build installer, pemeriksaan tipe seluruh Hydra, startup unpacked/portable, tray dan halaman game native Windows juga lulus. OneDrive dan save game nyata belum diuji. Dialog pada fixture browser tetap simulasi; handler IPC diuji terpisah dengan Electron mock.

## Terbaru — OneDrive 0.3.0

Terverifikasi 1 November 2026 WITA. [Build 41247200550](https://github.com/krisnapy/hydra-auto-save/actions/runs/41247200550), [verifikasi 41248027671](https://github.com/krisnapy/hydra-auto-save/actions/runs/41248027671), dan [visual 41248027689](https://github.com/krisnapy/hydra-auto-save/actions/runs/41248027689) lulus. Sumber paket: [9dcc75a](https://github.com/krisnapy/hydra-auto-save/commit/9dcc75a24d4ba376ba3ea1cdc97f22bb2afbef36).

77 tes modul, integrasi/typecheck Hydra, startup unpacked/portable serta tray lulus. 28 tes visual/interaksi lokal dan Windows lulus pada dua ukuran jendela, termasuk kode login/cancel dan unduhan cloud simulasi yang hanya menambah riwayat tanpa restore. Halaman game Windows lengkap memakai aplikasi 0.3.0 dari build yang sama dan profil dummy terisolasi terverifikasi. Ini belum bukti login akun atau upload/download OneDrive nyata maupun save game pengguna.

[Galeri 0.3.0](https://github.com/krisnapy/hydra-auto-save/actions/runs/41248027689/artifacts/13059663777): ekstrak ZIP lalu buka index.html. [Installer](https://github.com/krisnapy/hydra-auto-save/actions/runs/41248027671/artifacts/13060640297) dan [portable](https://github.com/krisnapy/hydra-auto-save/actions/runs/41248027671/artifacts/13059459234) terpisah, sekitar211MB masing-masing. Unduhan privat memerlukan akun dengan akses repo dan berlaku30hari. Publikasi rilis publik dilewati.


## Riwayat — panel samping 0.2.3

Terverifikasi 1 November 2026 WITA. [Build 41244821443](https://github.com/krisnapy/hydra-auto-save/actions/runs/41244821443), [verifikasi paket 41245568250](https://github.com/krisnapy/hydra-auto-save/actions/runs/41245568250), dan [visual 41245568264](https://github.com/krisnapy/hydra-auto-save/actions/runs/41245568264) lulus. Sumber paket: [b390111](https://github.com/krisnapy/hydra-auto-save/commit/b3901111fb3eced15306a44ccffac8070e185cdd).

24 tes panel/interaksi pada dua ukuran jendela lulus, mencakup membuka/menutup riwayat/menu, pembaruan progres, pembatalan pemulihan, kegagalan dan pembaruan jumlah versi setelah backup otomatis. Pemeriksaan manual browser pada390 px tidak menemukan overflow. 70 tes modul, typecheck seluruh Hydra, startup unpacked/portable dan tutup/buka ulang tray juga lulus. Halaman game native memakai paket 0.2.3 dari build yang sama dengan sumber pengujian; tidak lagi memakai paket 0.2.2.

[Unduh galeri terbaru](https://github.com/krisnapy/hydra-auto-save/actions/runs/41245568264/artifacts/13059601320), ekstrak, lalu buka `index.html`. Tersedia 14 screenshot: 12 skenario komponen dan 2 gambar halaman/panel aplikasi Windows. Game native adalah game kustom contoh dengan profil sementara terverifikasi, tanpa menjalankan game, backup/restore save asli atau unggahan cloud. Pengujian browser memakai IPC contoh; belum ada pembandingan piksel baseline otomatis.

Installer 0.2.3: [unduhan installer](https://github.com/krisnapy/hydra-auto-save/actions/runs/41245568250/artifacts/13059023197). Alternatif: [portable](https://github.com/krisnapy/hydra-auto-save/actions/runs/41245568250/artifacts/13059352420). Repo privat memerlukan akun yang memiliki akses; artifact berlaku 30 hari. Publikasi rilis publik dilewati sesuai status privat.

## Riwayat — tampilan 0.2.2

Hasil terverifikasi 1 November 2026 WITA: [Game page visual tests 41242768529](https://github.com/krisnapy/hydra-auto-save/actions/runs/41242768529) lulus pada Windows. Sumber pengujian: [f6b9f6a](https://github.com/krisnapy/hydra-auto-save/commit/f6b9f6aeb9703e9d37f6d7af7600d6c16ec0fa46).

- 20 pemeriksaan panel/interaksi lulus pada dua ukuran jendela. Enam kondisi menggunakan komponen React dan SCSS produksi dengan IPC data contoh: belum diatur, backup berjalan, selesai, riwayat, pemulihan berjalan, dan gagal.
- Aplikasi portable Windows v0.2.2 dari build 41234708380 benar-benar dibuka. Panel halaman game kustom terverifikasi pada profil sementara, termasuk lokasi save belum dikenali, backup nonaktif, tidak ada versi untuk dipulihkan, dan lebar panel.
- 14 screenshot tersedia: 12 kondisi panel dan 2 gambar halaman/panel Hydra Windows.

## Melihat hasil

1. Unduh [Game-page-visual-report](https://github.com/krisnapy/hydra-auto-save/actions/runs/41242768529/artifacts/13057763864).
2. Ekstrak ZIP.
3. Buka `index.html` untuk galeri; tautan laporan Playwright ada di halaman tersebut.

Artifact berlaku 30 hari. Pada repo privat, pengunduh perlu login dengan akun yang memiliki akses. Tidak perlu memasang Node.js untuk melihat galeri. Panduan menjalankan ulang tersedia di [tests/visual/README.md](../tests/visual/README.md).

Pengujian awal berhenti sebelum menyisipkan game karena perubahan APPDATA belum membuktikan profil terisolasi. Pengujian yang lulus memakai `--user-data-dir` eksplisit dan memverifikasi identitas pengaturan di folder sementara sebelum penyisipan fixture.

Ini pengujian tampilan, bukan bukti backup/pemulihan file game nyata atau unggahan cloud. Dialog pemulihan dalam fixture browser adalah simulasi. Belum ada pembandingan piksel otomatis dengan baseline. Paket aplikasi tidak diubah dan tetap v0.2.2; pemeriksaan native dipatok ke paket tersebut.
