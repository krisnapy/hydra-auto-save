# Hydra Personal Cloud Backup — 0.2.3

Implementasi awal modul backup untuk salinan kode **Hydra Launcher 4.3.0 di Windows**. Tersedia installer dan aplikasi portable Windows x64 dengan runtime serta Ludusavi bawaan. Build, pemeriksaan tipe seluruh Hydra, dan uji membuka aplikasi/pengaturan backup di Windows telah berhasil. Pengujian game nyata dan penyedia cloud masih diperlukan.

Draft awal tetap tersedia di [docs/rancangan-auto-backup.md](docs/rancangan-auto-backup.md). Keputusan implementasi awal dan batas verifikasi tercatat di [docs/implementasi.md](docs/implementasi.md). Tahapan berikutnya ada di [roadmap Personal Cloud](docs/roadmap-personal-cloud.md).

## Paket Windows tanpa Node.js

Repository saat ini privat. Paket baru tersedia melalui workflow [Verify Windows package](https://github.com/krisnapy/hydra-auto-save/actions/workflows/verify-windows.yml) setelah build dan pemeriksaan berhasil. Login dengan akun yang memiliki akses, lalu unduh salah satu artifact:

- **Hydra-Personal-Backup-Installer-Windows-x64**: ekstrak ZIP dan jalankan berkas `setup.exe` di dalamnya.
- **Hydra-Personal-Backup-Portable-Windows-x64**: ekstrak ZIP dan jalankan berkas `portable.exe`.

Node.js dan Ludusavi tidak perlu dipasang terpisah. Paket menyertakan runtime dan Ludusavi. Artifact berlaku 30 hari. Publikasi rilis publik dilewati selama repository privat; checksum dan pengujian Windows tetap berjalan.

0.2.3 memperbarui bagian backup di halaman game: lokasi save di kiri, kartu status/tindakan di kanan, riwayat dibuka melalui Pulihkan, dan pilihan lanjutan masuk menu ⋯. Pada jendela sempit tampilan menjadi satu kolom. Proses backup, konfirmasi pemulihan dan backup pengaman tetap menggunakan layanan yang sama. Navigasi serta tampilan halaman lain Hydra tetap mengikuti launcher.

Workflow **Windows installer** membangun sumber Hydra 4.3.0 yang dipatok dan memeriksa cache dependensi sebelum digunakan. **Verify Windows package** memeriksa checksum, startup dan menyediakan unduhan terpisah. **Game page visual tests** menguji komponen terbaru saat push, lalu membuka paket Windows dari build yang memicunya setelah build berhasil. Ini versi uji awal; aplikasi belum ditandatangani secara digital dan game/cloud nyata tetap perlu diuji.

Panduan pengguna: [panduan Windows](docs/panduan-windows.md). Tutup Hydra resmi sebelum memakai build ini; keduanya memakai profil lokal yang sama. Pilih folder instalasi berbeda. Build khusus ini memakai renderer lokal dan menonaktifkan pembaruan resmi otomatis agar integrasi backup tidak terganti. Keberhasilan build belum membuktikan pengujian semua game atau penyedia cloud.

## Yang sudah dibuat

- Isi save yang sama dengan backup normal terakhir dilewati setelah satu pembacaan sumber tanpa jeda kestabilan. Isi baru tetap melewati pemeriksaan kestabilan dan pemeriksaan setelah penyalinan. Sumber yang terus berubah mendapat jeda percobaan otomatis 5–60 detik per game.
- Pemantauan folder save selama Hydra berjalan, dengan debounce 1,5 detik dan pemeriksaan kestabilan isi 1,2 detik. Pemeriksaan cadangan tiap 60 detik ketika pemantauan sehat, atau 5 detik saat aktif/30 detik saat tray idle jika pemantauan tidak tersedia. Backup manual dan pemicu game ditutup tetap langsung masuk antrean.
- Jendela utama dilepaskan saat ditutup; menu tray dibuka langsung dari cache, dengan akses pengaturan dan status saat diperbarui. Polling antarmuka berhenti ketika tersembunyi; pengaturan identik tidak ditulis ulang. Layanan Hydra/backup tetap berjalan di tray, jadi CPU/RAM tidak menjadi nol.
- Deteksi file save melalui perintah preview Ludusavi. Game Steam dicocokkan dengan Steam ID; game kustom memakai judul persis. Kecocokan tidak pasti memerlukan pengaturan manual.
- Pemilihan file atau folder save manual melalui dialog Windows.
- Buka folder save membuka folder penyimpanan. Beberapa file dalam folder yang sama dikelompokkan menjadi satu lokasi; folder terpisah tetap tersedia masing-masing.
- Backup ke folder sinkronisasi lokal, dengan identitas perangkat tersendiri.
- SHA-256 untuk membandingkan isi dan memeriksa integritas. Isi yang sama tidak membuat versi normal baru.
- Riwayat awal 10 versi normal per game **per perangkat**. Backup pengaman sebelum pemulihan tidak dihapus otomatis.
- Penanda selesai dan pemeriksaan kelengkapan sebelum versi ditampilkan untuk pemulihan.
- Backup manual, pemicu setelah game ditutup, pemulihan dengan konfirmasi, dan catatan aktivitas lokal.
- Antrean operasi yang memberi giliran pada permintaan pengguna setelah game aktif selesai diproses.
- Indikator proses diperbarui setiap 250 ms selama operasi berjalan melalui jalur khusus di memori, atau tiap detik saat idle: tahap operasi, jumlah file/lokasi pada tahap yang diketahui, serta hasil selesai/gagal terakhir per game. Bar memakai animasi transisi, tahap tanpa jumlah menampilkan aktivitas tanpa persentase perkiraan, dan status identik tidak menggambar ulang panel. Riwayat tetap diperbarui terpisah setiap 10 detik agar pemantauan progres tidak berulang kali membaca semua isi backup.
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

Setelah itu, siapkan dependensi dan komponen native menggunakan prosedur build sumber Hydra pada Windows. Script upstream menyediakan `yarn typecheck` dan `yarn build:win`; build Windows terintegrasi telah berhasil melalui GitHub Actions. Simpan perubahan modul sebelum memperbarui Hydra; pembaruan resmi dapat mengganti salinan aplikasi yang dibangun sendiri.

## Pengaturan di Hydra hasil build

1. Buka **Settings → Personal Cloud Backup**.
2. Pilih folder lokal yang dikelola aplikasi cloud, misalnya `Dropbox\Hydra Backups`.
3. Aktifkan **Auto Backup**. Modul mencoba menemukan Ludusavi bawaan Hydra. Jika tidak ditemukan, pilih `ludusavi.exe` secara manual.
4. Deteksi pertama mengunduh database Ludusavi ke pengaturan modul yang terpisah. Setelah database tersedia, deteksi memakai cache lokal. Tombol **Perbarui database lokasi save** tersedia untuk pembaruan berikutnya.
5. Buka halaman game untuk melihat lokasi, status, riwayat, **Backup sekarang**, dan **Pulihkan**. Untuk game yang belum dikenali, pilih file atau folder save manual.

Mematikan Auto Backup menghentikan penjadwalan berikutnya. Operasi yang sudah berjalan diselesaikan dengan aman. Tombol backup manual tetap dapat digunakan.

**Backup lokal selesai** berarti file lokal selesai dibuat. Periksa aplikasi cloud untuk mengetahui status unggahan; modul tidak mengklaim unggahan selesai.

## Batas versi ini

Pengujian tampilan halaman game tersedia dalam [galeri dan laporan visual](docs/pengujian-tampilan.md): 20 pemeriksaan panel/interaksi pada dua ukuran jendela serta screenshot halaman game di aplikasi Windows telah lulus. Skenario backup/pemulihan visual memakai data contoh; belum menggantikan uji save game nyata.

- Installer dan portable `.exe` berhasil dibuat. Aplikasi portable berhasil dibuka di Windows CI; layanan backup, renderer lokal, pengaturan backup, dan Ludusavi bawaan terverifikasi. Instalasi interaktif di PC pengguna, game nyata, dan sinkronisasi OneDrive/Google Drive/Dropbox/pCloud belum diuji.
- Sebanyak 70 pengujian lulus di Windows dan lokal. Pemeriksaan tipe seluruh Hydra terintegrasi serta build Windows lulus. Ini belum membuktikan konsistensi save semua game.
- Ludusavi 0.29.0 asli telah diuji untuk pencarian Steam ID, judul persis, preview file save contoh, penanganan ID tidak dikenal, dan unduhan database. ID `1245620`, `292030`, dan `3751260` dikenali database; lokasi save nyata pada PC pengguna tetap perlu diuji. Database diunduh pada penggunaan pertama.
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
