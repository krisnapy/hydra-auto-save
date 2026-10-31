# Draft — Auto Backup Cloud Pribadi untuk Hydra

**Status:** Draft awal; usulan rancangan, belum implementasi  
**Tanggal:** 31 Oktober 2026  
**Target awal:** Windows, Hydra Launcher 4.3.0  
**Sumber:** Draft pengguna dalam percakapan proyek hydra-auto-save.

**Catatan lanjutan:** Status dokumen ini merujuk rancangan awal sebelum implementasi. Source implementasi awal kini tersedia; lihat [catatan implementasi](implementasi.md) untuk hasil yang sudah diperiksa dan batas yang masih perlu diuji.

Dokumen ini menjadi dasar pembahasan. Target versi, kemampuan integrasi Hydra, dan pemakaian database Ludusavi belum diverifikasi. Menyimpan rancangan ini tidak berarti menyetujui seluruh pilihan teknis atau memulai implementasi.

## Tujuan

Mencadangkan progres game secara otomatis ke cloud milik pengguna, seperti OneDrive, Google Drive, Dropbox, atau pCloud, dengan pengaturan sesedikit mungkin. Pengguna tetap membuka dan mengelola game melalui Hydra.

## Pengalaman pengguna

1. Pengguna mengaktifkan **Auto Backup** di pengaturan Hydra.
2. Pengguna memilih folder lokal yang disinkronkan aplikasi cloud.
3. Sistem mendeteksi lokasi save game yang dikenali.
4. Saat save berubah, sistem membuat backup setelah penulisan file selesai.
5. Aplikasi cloud mengunggah backup tersebut.

Game yang belum dikenali ditandai **Perlu pengaturan**, dengan pilihan menentukan lokasi save secara manual.

## Fitur versi pertama

| Fitur | Perilaku yang diusulkan |
| --- | --- |
| Deteksi save | Menggunakan database lokasi save Ludusavi |
| Backup otomatis | Dipicu perubahan save dan setelah game ditutup |
| Penggabungan perubahan | Beberapa perubahan berdekatan digabung menjadi satu backup |
| Pemeriksaan perubahan | File yang tidak berubah tidak menghasilkan backup baru |
| Riwayat | Menyimpan beberapa versi; usulan awal 10 versi per game |
| Backup manual | Tombol **Backup sekarang** |
| Pemulihan | Pengguna memilih versi dan mengonfirmasi pemulihan |
| Perlindungan pemulihan | Backup kondisi saat ini dibuat sebelum save diganti |
| Catatan aktivitas | Menampilkan keberhasilan, kegagalan, dan alasan kegagalan |

## Penyimpanan cloud

Versi pertama memakai **folder sinkronisasi lokal**, sehingga pengguna tidak perlu memberikan akun atau kata sandi cloud kepada modul.

Contoh tujuan: `Dropbox\Hydra Backups`.

Backup disimpan terpisah dari folder save asli. Modul tidak memindahkan folder save game.

Status yang ditampilkan:

- Menunggu perubahan
- Menyiapkan backup
- Backup lokal selesai
- Backup gagal
- Perlu pengaturan

Status **Sudah terunggah ke cloud** hanya ditampilkan jika ada cara yang dapat diverifikasi untuk mengetahuinya. Keberhasilan membuat file lokal saja tidak membuktikan unggahan selesai.

## Keamanan data dan konflik

- Tunggu file stabil sebelum menyalin, lalu periksa apakah sumber berubah selama penyalinan.
- Backup yang belum selesai tidak boleh muncul sebagai versi yang dapat dipulihkan.
- Jangan memulihkan save saat game sedang berjalan.
- Jangan menimpa progres otomatis dari perangkat lain.
- Pisahkan identitas perangkat agar backup dari dua PC tidak saling menimpa.
- Jangan menghapus backup lama sebelum backup baru berhasil diselesaikan.
- Jika cloud offline, backup lokal tetap berjalan selama ruang penyimpanan tersedia.

## Integrasi dengan Hydra

Bentuk integrasi perlu diuji sebelum diputuskan. Usulan awal adalah modul pada salinan kode Hydra 4.3.0 yang dibangun sendiri, dengan:

- Halaman pengaturan **Personal Cloud Backup**
- Status dan riwayat backup per game
- Tombol backup dan pemulihan

Rancangan ini belum mengasumsikan adanya sistem ekstensi resmi Hydra. Kompatibilitas dengan versi Hydra berikutnya perlu diuji.

## Di luar cakupan versi pertama

- Login langsung ke API penyedia cloud
- Pemulihan otomatis antar-PC
- Penggabungan dua progres yang bertentangan
- Jaminan mendukung semua game
- Dukungan save Windows Registry
- Backup saat PC kehilangan daya
- Dukungan Hydra Nexus

## Kriteria keberhasilan

1. Game yang dikenali dapat dicadangkan tanpa mencari lokasi save secara manual.
2. Perubahan save menghasilkan backup yang utuh tanpa mengganggu permainan.
3. Backup tetap tersimpan saat internet terputus.
4. Versi sebelumnya dapat dipulihkan setelah game ditutup.
5. Kegagalan ditampilkan dengan alasan yang jelas.
6. Tidak diperlukan Windows Task Scheduler.

## Tahapan pengerjaan yang diusulkan

1. Uji integrasi Hydra dan deteksi lokasi save.
2. Buat backup lokal otomatis untuk beberapa game uji.
3. Tambahkan riwayat, pemeriksaan integritas, dan pemulihan.
4. Uji folder sinkronisasi penyedia cloud.
5. Tambahkan antarmuka pengaturan dan status di Hydra.

## Pertanyaan rancangan sebelum implementasi

Bagian ini adalah tambahan telaah, bukan keputusan yang sudah disepakati.

| Hal yang perlu ditentukan | Pertanyaan atau bukti yang dibutuhkan |
| --- | --- |
| Integrasi Hydra | Di mana pengaturan, identitas game, lokasi instalasi, dan kejadian game ditutup dapat dihubungkan pada target versi? Apakah proses build Windows dapat direproduksi? |
| Identifikasi game | Bagaimana identitas game Hydra dipetakan ke entri Ludusavi, dan bagaimana menangani kecocokan ganda atau tidak pasti? |
| Penggunaan Ludusavi | Apakah memakai manifest langsung atau mesin Ludusavi? Verifikasi format, lisensi, kebutuhan atribusi, pembaruan database, dan pemetaan lokasi Windows sebelum memilih. |
| Masa aktif pemantauan | Apakah backup hanya aktif selama Hydra berjalan? Perilaku saat Hydra ditutup atau dibuka kembali belum ditetapkan. |
| Konsistensi save | Bagaimana menentukan file stabil, menangani save yang terdiri atas beberapa file, file terkunci, dan sumber yang terus berubah? Stabilitas file saja belum menjadi bukti konsistensi seluruh save. |
| Versi yang utuh | Tentukan metadata, pemeriksaan integritas, dan penanda selesai; pastikan penerima pada PC lain tidak menawarkan versi sebelum semua berkas tersedia dan lolos pemeriksaan. |
| Pemulihan aman | Tentukan perilaku bila backup pengaman gagal, file tujuan terkunci, atau pemulihan berhenti di tengah; termasuk pemulihan ulang dan penanganan file tambahan di tujuan. |
| Game berjalan | Tentukan cara mendeteksi proses game dan turunannya, termasuk bila game dibuka di luar Hydra; pemulihan perlu diblokir ketika status tidak dapat dipastikan. |
| Retensi lintas perangkat | Apakah batas 10 versi berlaku per game atau per game per perangkat? Siapa yang boleh menghapus versi, termasuk backup pengaman sebelum pemulihan? |
| Folder sinkronisasi | Uji folder offline, file yang hanya tersedia di cloud, konflik sinkronisasi, akses ditolak, ruang habis, dan tujuan yang berada di dalam folder save. |
| Batas beban | Tentukan jeda penggabungan perubahan, batas percobaan ulang, ukuran backup, dan perilaku saat beberapa game berubah sekaligus. |
| Game uji | Pilih contoh save satu file, beberapa file, serta lokasi manual; tetapkan hasil yang dapat diperiksa untuk setiap kriteria keberhasilan. |

## Hasil yang diharapkan dari tahap pertama

Usulan keluaran tahap pertama adalah catatan kelayakan integrasi, pemetaan beberapa game uji ke lokasi save, dan daftar keputusan yang membutuhkan bukti tambahan. Tahap ini belum menjanjikan dukungan seluruh game atau menetapkan arsitektur akhir.
