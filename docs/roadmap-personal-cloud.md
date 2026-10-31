# Roadmap Hydra Personal Cloud

Status: rencana bertahap; tanggal rilis belum ditetapkan. Target awal Windows, Hydra 4.3.0.

| Versi | Fokus | Status |
|---|---|---|
| 0.1.5 | Backup lokal/cloud-folder, riwayat, cache verifikasi | Dirilis |
| 0.2.0 | Pemantauan save, debounce/retry, low space, journal terputus, panduan awal | Dirilis; uji game/cloud nyata masih diperlukan |
| 0.3.0 | OneDrive pribadi, OAuth berkode, antrean unggahan, unduh ke riwayat dan pemulihan manual | Paket awal privat terverifikasi; uji akun nyata masih diperlukan |
| 0.4 | Pemetaan game/perangkat dan konflik progres antar-PC | Usulan |
| 0.5 | Sinkronisasi achievement yang dikenali Hydra | Usulan |
| 0.6 | Deteksi save bawaan; kurangi ketergantungan executable Ludusavi setelah validasi database/lisensi | Usulan |
| 0.7 | Deduplikasi/kompresi serta audit ukuran paket | Usulan |
| 0.8 | Sinkronisasi sebelum/sesudah bermain; otomatis hanya jika aman tanpa konflik | Usulan |
| 0.9 | Audit keamanan, distribusi bertanda tangan, evaluasi enkripsi dan penyedia kedua | Usulan |
| 1.0 | Alur lintas PC yang menyatu dan teruji untuk game yang didukung | Usulan |

Setiap tahap harus tetap berguna sendiri, menjaga kompatibilitas/migrasi data, dan diuji pada salinan save. Pengamanan dasar berlaku sejak awal. Konflik atau kondisi yang tidak dapat dipastikan tetap memerlukan keputusan pengguna. Roadmap tidak menjanjikan semua game atau penggantian seluruh layanan Hydra Nexus.

0.2.0 belum mencakup OAuth, sinkronisasi achievement, pemulihan otomatis antar-PC, enkripsi backup, atau penghapusan ketergantungan Ludusavi. Panduan pemulihan terputus tidak menjamin pemulihan otomatis untuk journal lama/rusak dan tidak menjamin ketahanan kehilangan daya.
