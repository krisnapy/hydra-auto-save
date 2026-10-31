# Catatan implementasi awal

Tanggal: 31 Oktober 2026 WITA. Status: source implementasi awal; belum rilis Windows.

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
