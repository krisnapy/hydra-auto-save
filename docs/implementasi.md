# Catatan implementasi awal

Tanggal: 31 Oktober 2026 WITA. Status: paket Windows awal tersedia; uji game nyata belum dilakukan.

## Build, startup, dan tray — 0.1.3

Permintaan pengguna: percepat build dan pembukaan aplikasi serta kurangi pekerjaan tray yang tidak diperlukan. Tidak ada klaim bahwa tray menggunakan CPU/RAM nol. Layanan pemantauan game, unduhan aktif, dan backup tetap memerlukan proses utama serta layanan Hydra terkait.

- Cache memakai kecocokan tepat Windows 2022/x64, Node 22.21.0, commit Hydra yang dipatok, serta hash package/lockfile. Tidak ada fallback ke cache dari sumber lain. Isi dependensi, runtime Legendary, Ludusavi, dan addon native digunakan kembali. Integritas Yarn dan pemuatan addon dengan Electron diperiksa sebelum build; cache yang baru diisi juga diuji dari runner baru.
- Penyiapan auth lokal tetap ditunggu. Pembaruan profil internet berjalan di latar dengan pemeriksaan generasi auth agar hasil sesi lama tidak mengganti sesi baru. Inisialisasi Epic opsional memakai satu promise bersama pada dua jalur startup.
- Tray dipegang sebagai satu instance. Menu awal/cached tampil tanpa menunggu database pustaka; penyegaran digabung dan dibatasi minimal 15 detik ketika diminta, tanpa timer penyegaran menu. Status menu dapat tertinggal sampai dibuka berikutnya. Klik ganda juga memulihkan jendela yang diminimalkan. Permintaan pembukaan yang bersamaan berbagi satu proses pembuatan jendela. Game Steam/custom dari tray melewati penguncian peluncuran/pemulihan Hydra.
- Snapshot ukuran/bounds jendela diambil sebelum await pada handler close; renderer utama tetap dilepaskan ketika ditutup. Tidak mempertahankan renderer utama tersembunyi untuk mempercepat pembukaan ulang.
- Saat semua jendela tersembunyi/minimized dan tidak ada game terpantau berjalan, hashing otomatis dijadwalkan paling sering setiap 30 detik. Saat jendela terlihat atau game berjalan, tetap 5 detik. Backup manual dan kejadian game ditutup langsung masuk antrean. Interval adalah jadwal pemeriksaan; satu putaran pada pustaka besar dapat memerlukan waktu lebih lama. Pengaturan yang sama tidak ditulis ulang; polling UI tersembunyi tidak mengirim IPC progres/riwayat.

45 pengujian lokal dan Windows lulus, termasuk menu tray ketika pustaka belum selesai dibaca, penggabungan refresh, pemulihan jendela yang diminimalkan, startup ketika profil internet belum selesai, pengabaian profil dari generasi auth lama, dan penjadwalan tray idle. Pemeriksaan integrasi lokal serta pemeriksaan tipe seluruh Hydra di Windows lulus. Pada [run pengisian cache 41226571051](https://github.com/krisnapy/hydra-auto-save/actions/runs/41226571051), instalasi/kompilasi dependensi memerlukan 524,89 detik; cache lolos pemuatan addon native/classic-level dengan Electron dan tersimpan sebelum run tersebut digantikan build sumber akhir. [Build akhir 41227437585](https://github.com/krisnapy/hydra-auto-save/actions/runs/41227437585) memulihkan cache pada runner baru dalam 21 detik dan memvalidasinya dalam sekitar 1 detik; instalasi serta kompilasi native dilewati. Ini perbandingan tahap dependensi, bukan waktu seluruh build. Build berhasil dari commit `3ec4623750631f67ee561f5882ef252fb79b1873`. Uji executable hasil instalasi/unpacked memverifikasi jendela utama benar-benar ditutup, proses tray tetap hidup, jendela dapat dibuka ulang, dan device ID/layanan backup tetap sama. Layanan IPC siap pada 3.225 ms, pengaturan terlihat pada 5.138 ms, dan IPC setelah pembukaan ulang siap pada 2.232 ms. Ini pengukuran pertama pada versi baru, bukan perbandingan startup dengan versi lama. Snapshot proses saat jendela terbuka berjumlah 7 dengan working set agregat 1.547.821.056 byte; setelah jendela ditutup ke tray berjumlah 4 dengan working set agregat 791.445.504 byte. Nilai tersebut menjelaskan perbedaan keadaan jendela/tray pada runner uji, bukan bukti penghematan RAM terhadap versi sebelumnya. Selama sampel idle dengan jeda 5 detik, penambahan waktu CPU proses yang tetap hidup sekitar 0,015625 detik; ini bukan jaminan pemakaian CPU nol. `Startup-installed.json` mencatat hasil terperinci. Pengukuran CI memakai profil/pustaka uji; hasilnya tidak menjamin pemakaian CPU/RAM atau waktu startup di PC pengguna.

[Verifikasi/publikasi 41228030414](https://github.com/krisnapy/hydra-auto-save/actions/runs/41228030414) berhasil membuka portable, memeriksa layanan backup/pengaturan dan checksum, lalu menerbitkan [rilis publik 0.1.3](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.1.3). Pada peluncuran portable pertama, IPC siap pada 20.502 ms dan pengaturan pada 22.645 ms; angka ini mencakup jalur peluncuran portable dan berbeda dari executable unpacked, sehingga angka 3,2 detik tidak berlaku untuk semua bentuk paket. Installer dan portable tersedia terpisah bersama panduan serta SHA256SUMS. Keempat aset lolos pemeriksaan unduh anonim dan ukuran; metadata digest diperiksa sebelum publikasi.

## Antrean dan progres operasi — 0.1.2

Laporan pengguna: permintaan terus mendapat pesan “Tunggu operasi backup atau pemulihan selesai”, tanpa indikator progres. Controller lama mengunci kontrol selama satu putaran pemeriksaan seluruh pustaka. Pada pustaka besar, permintaan pengguna sering ditolak. Refresh antarmuka setiap 10 detik juga dapat melewatkan operasi singkat.

Controller kini memasukkan permintaan ke antrean berurutan. Pemeriksaan otomatis menyelesaikan game aktif, lalu berhenti sebelum game berikutnya agar permintaan mendapat giliran. Kegagalan satu permintaan tidak merusak antrean berikutnya. Pengaturan baru hanya diterapkan setelah operasi aktif selesai.

Settings dan halaman game menampilkan operasi aktif/menunggu, tahap, waktu mulai/pembaruan, serta hasil terakhir per game. Progress bar menunjukkan jumlah file/lokasi pada tahap yang memiliki total; tahap lain memakai indikator tak tentu. Ini bukan persentase keseluruhan atau bukti unggahan cloud. Snapshot ringan setiap satu detik tidak memeriksa ulang semua blob riwayat; daftar riwayat diperbarui terpisah setiap 10 detik. Hasil backup terakhir dipertahankan ketika pemeriksaan otomatis berikutnya menemukan isi yang sama.

Sebanyak 38 pengujian lokal dan Windows lulus, termasuk antrean saat pemindaian otomatis aktif, prioritas permintaan sebelum game berikutnya, pemulihan antrean setelah kegagalan, snapshot ringan, progres backup/pemulihan, dan isi file setelah pemulihan. Pemeriksaan integrasi lokal serta pemeriksaan tipe seluruh Hydra di Windows lulus. [Build Windows 41222946095](https://github.com/krisnapy/hydra-auto-save/actions/runs/41222946095) berhasil dari commit `5472a7d46c009812e9509b788246fe66d87407b3`. [Verifikasi 41224208570](https://github.com/krisnapy/hydra-auto-save/actions/runs/41224208570) membuka aplikasi portable, memeriksa IPC/snapshot operasi, dan memastikan pengaturan menampilkan status tidak ada operasi aktif. [Rilis publik 0.1.2](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.1.2) menyediakan installer dan portable terpisah beserta panduan/checksum. Pengujian save game nyata, pustaka besar, dan cloud pengguna tetap diperlukan.

## Perbaikan deteksi Steam ID — 0.1.1

Uji Windows [41217704915](https://github.com/krisnapy/hydra-auto-save/actions/runs/41217704915), selesai 1 November 2026 WITA, mereproduksi timeout pencarian Steam ID pada Ludusavi 0.29.0 asli. `find` membaca nama tambahan dari stdin sampai EOF meskipun `--steam-id` sudah diberikan. Runner lama membiarkan stdin terbuka. Runner baru menutupnya segera, tanpa shell.

Uji yang sama memverifikasi pencarian Steam ID, judul persis, preview file save contoh, dan penanganan JSON error pada exit nonzero. Database terbaru mengenali `292030` sebagai The Witcher 3: Wild Hunt dan `3751260` sebagai The Blood of Dawnwalker; `1245629` tidak dikenali pada pemeriksaan tersebut. Pengguna kemudian mengoreksi salah ketik tersebut menjadi `1245620`; [uji lanjutan 41218017829](https://github.com/krisnapy/hydra-auto-save/actions/runs/41218017829) berhasil mengenalinya sebagai Elden Ring. Ini membuktikan pencocokan database, bukan lokasi save nyata di PC pengguna.

Paket 0.1.1 berhasil dibangun melalui [41217615393](https://github.com/krisnapy/hydra-auto-save/actions/runs/41217615393), lalu [41218865374](https://github.com/krisnapy/hydra-auto-save/actions/runs/41218865374) membuka aplikasi Windows, memeriksa checksum, dan menerbitkan [rilis publik 0.1.1](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.1.1). Keempat tautan asset berhasil diperiksa tanpa autentikasi.

Sebanyak 34 pengujian lokal dan Windows lulus. Error game tidak dikenal kini memberi petunjuk memperbarui database atau memilih lokasi save manual. Kegagalan proses dan timeout mendapat pesan yang berbeda.

## Paket Windows terverifikasi

- [Build Windows 41194991037](https://github.com/krisnapy/hydra-auto-save/actions/runs/41194991037) berhasil dari source commit `6f6125393c1f611cd8fc2256d0327a978b224141`.
- 31 pengujian modul lulus di Windows; pemeriksaan tipe seluruh Hydra dan bundling Electron berhasil. Installer NSIS dan portable x64 dibuat tanpa publikasi ke repository upstream.
- [Uji paket 41195867955](https://github.com/krisnapy/hydra-auto-save/actions/runs/41195867955) memeriksa checksum file unduhan, membuka portable di Windows, memanggil IPC snapshot, mendeteksi Ludusavi bawaan, dan membuka halaman Personal Cloud Backup. Screenshot dan log startup disertakan dalam artifact.
- [Paket terverifikasi](https://github.com/krisnapy/hydra-auto-save/actions/runs/41195867955/artifacts/13040881038) tersedia sampai 30 November 2026. Pengguna tidak perlu memasang Node.js. Build belum ditandatangani dengan sertifikat Windows.
- Pembaruan resmi otomatis dinonaktifkan; renderer menggunakan file lokal agar antarmuka backup tidak terganti. Profil/pustaka Hydra tetap memakai identitas produk yang sama; jalankan satu salinan saja dan pilih folder instalasi berbeda.
- Endpoint publik build disalin dari log release resmi Hydra v4.3.0 [41142471461](https://github.com/hydralauncher/hydra/actions/runs/41142471461); tidak ada kredensial cloud atau token pribadi dalam konfigurasi build.
- Temuan Windows: checkout CRLF harus dinormalisasi untuk pemeriksaan sumber, sedangkan cadangan sumber mempertahankan format aslinya. Metadata `.DS_Store` dikecualikan dari integrasi.

Catatan di bawah merekam hasil tahap awal sebelum build Windows. Verifikasi Windows di atas memperbarui status build/typecheck; pengujian game/cloud nyata dan pemasangan interaktif di PC pengguna masih diperlukan.

## Dasar integrasi yang diperiksa

Sumber Hydra dibaca melalui plugin GitHub dari tag `v4.3.0`, commit `5845549311a20d485d027da875307fc70897bfdc`:

- `src/main/index.ts`: awal/akhir masa aktif pemantauan.
- `src/main/services/process-watcher.ts`: kejadian game ditutup, sebelum pengembalian awal untuk game custom; pemicu ini dilewati saat shutdown.
- `src/main/helpers/launch-game.ts`: penguncian peluncuran selama pemulihan untuk game PC Steam/custom di Windows.
- `src/main/events/index.ts` dan `src/preload/index.ts`: pendaftaran operasi modul dan jembatan khusus `window.personalBackup`.
- Pengaturan desktop dan halaman detail game: komponen pengaturan/status/riwayat, terpisah dari Hydra Cloud/Nexus.
- `src/main/services/ludusavi.ts`: lokasi binary bawaan Hydra; konfigurasi modul tetap terpisah dari konfigurasi cloud Hydra.

Sumber rujukan: [Hydra 4.3.0](https://github.com/hydralauncher/hydra/tree/v4.3.0), [dokumentasi CLI Ludusavi](https://github.com/mtkennerly/ludusavi/blob/master/docs/cli.md), dan [schema keluaran Ludusavi](https://github.com/mtkennerly/ludusavi/blob/master/docs/schema/general-output.yaml).

## Keputusan implementasi sementara

Pilihan ini dibuat untuk prototipe dan belum merupakan validasi produk di Windows:

| Hal | Pilihan awal |
| --- | --- |
| Masa aktif | Selama proses Hydra berjalan; penutupan menunggu operasi berjalan selesai |
| Pemantauan | Poll 5 detik; masa stabil 1,2 detik; pemindaian lokasi otomatis tiap 60 detik |
| Deteksi | Ludusavi `find --api`, lalu `backup --preview --api --no-cloud-sync`; tidak menjalankan backup/pemulihan Ludusavi |
| Database | Unduh pada deteksi pertama bila cache belum ada; pembaruan berikutnya lewat tombol pengguna |
| Penyimpanan | Folder per perangkat/game/versi; metadata, blob SHA-256, dan penanda `COMPLETE` |
| Retensi | 10 versi normal per game per perangkat, dapat diubah; backup pengaman dipertahankan |
| Identitas perangkat | UUID dalam pengaturan lokal Hydra; jangan menyalin pengaturan perangkat ini ke PC lain |
| Pemulihan | Hanya versi perangkat ini, target dipetakan dari konfigurasi lokal, bukan path absolut dari metadata cloud |
| Pengamanan | Konfirmasi native, pemeriksaan proses, penguncian peluncuran Hydra, backup pengaman, staging dan rollback lintas lokasi |
| Game awal | Steam/custom dengan executable diketahui; pemulihan memerlukan `.exe` langsung |
| Pengaturan | `%APPDATA%`/lokasi `userData` Hydra di subfolder `personal-cloud-backup`; tidak ikut diunggah bersama backup |

Layout tujuan:

```text
<folder-cloud>/HydraPersonalBackup/<device-id>/<hash-game>/<version-id>/
  manifest.json
  COMPLETE
  data/<sha256>
```

Backup dikumpulkan di direktori `_pending-…`. Setelah sumber diperiksa lagi dan file tersalin diverifikasi, direktori dipublikasikan sebagai versi final. Klien cloud dapat mengirim file dengan urutan berbeda; karena itu penanda selesai saja tidak cukup: daftar versi juga memeriksa seluruh blob. Tidak ada status unggahan cloud.

Sebelum pemulihan, seluruh versi tujuan diverifikasi, backup pengaman dibuat, dan hasil pemulihan disiapkan di lokasi lokal di samping save. Setiap lokasi diganti dengan rename, dengan salinan sebelumnya dipertahankan sampai semua lokasi berhasil. Penggantian beberapa lokasi bukan satu transaksi filesystem atomik; rollback menangani kegagalan yang terdeteksi, sedangkan journal lokal memblokir operasi lanjutan setelah penghentian tak terduga.

## Hasil terverifikasi di lingkungan pengerjaan

- `npm test`: **28 pengujian lulus**, tanpa pengujian dilewati, pada Node.js 20 di macOS.
- Pengujian otomatis lokal terhadap backup, perubahan isi, save yang terus berubah, file rusak/hilang, retensi antarperangkat, backup pengaman, konfirmasi, rollback lintas lokasi, path tidak aman, slot save baru/hilang, dan penguncian operasi.
- Kontrak detektor diuji memakai runner tiruan, bukan binary Ludusavi sungguhan.
- Pemasang diterapkan pada fixture sumber asli Hydra 4.3.0. Sumber yang sudah diedit, pemasangan ulang, dan file tambahan yang sudah ada ditolak sebelum penulisan.
- Pemeriksaan sintaks file TypeScript yang dihubungkan, pemeriksaan tipe komponen React, dan bundle modul utama.
- Demo backup dan pemulihan berhasil memakai data contoh lokal di macOS.

## Verifikasi yang masih diperlukan

1. Build dan pemeriksaan tipe seluruh sumber Hydra pada Windows beserta komponen native.
2. Binary Ludusavi bawaan: versi/flag CLI, unduhan manifest pertama, pencocokan Steam ID, lokasi Windows yang dialihkan, dan game kustom.
3. Beberapa game nyata: satu file, banyak file, penambahan slot, file terkunci, dan save yang terus ditulis.
4. Pemulihan saat game ditutup/dibuka melalui Hydra maupun dari luar Hydra; uji proses turunan dan gangguan antivirus.
5. Folder cloud sungguhan pada kondisi online/offline, placeholder, konflik, pengiriman metadata lebih dahulu daripada blob, dan ruang habis.
6. Pengukuran waktu serta beban disk untuk pustaka besar sebelum menetapkan interval pemantauan dan batas ukuran.

Rancangan tidak dianggap memenuhi seluruh kriteria keberhasilan sebelum pengujian Windows dan game nyata tersebut selesai.
