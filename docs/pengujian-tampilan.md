# Pengujian tampilan halaman game

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
