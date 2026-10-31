# OneDrive langsung — 0.3.0

Tahap awal untuk OneDrive akun Microsoft pribadi. Folder sinkronisasi lokal lama tetap dapat dipakai tanpa login. Ludusavi tetap digunakan untuk deteksi lokasi save; achievement dan pemulihan antar-PC belum termasuk tahap ini.

## Pendaftaran sekali oleh pengelola proyek

Pendaftaran aplikasi tidak perlu dilakukan oleh setiap pengguna. Paket menyertakan client ID proyek bawaan; pengguna cukup menekan Hubungkan OneDrive. Kolom client ID pada Pengaturan koneksi hanya diperlukan bila ingin memakai pendaftaran lain. ID ini bukan rahasia. Jangan membuat atau membagikan client secret.

1. Buka https://entra.microsoft.com/ dan pilih direktori/tenant Anda.
2. App registrations → New registration. Nama: Hydra Personal Backup. Supported account types: Personal Microsoft accounts only. Redirect URI dikosongkan.
3. Authentication → Advanced settings → Allow public client flows: Yes. Jika tidak terlihat, buka Manifest (Microsoft Graph), ubah `isFallbackPublicClient` menjadi `true`, lalu Save. Login menggunakan OAuth device authorization, sehingga tidak memerlukan server callback/redirect URI.
4. API permissions → Microsoft Graph → Delegated permissions → Files.ReadWrite.AppFolder. Hapus User.Read bawaan bila tidak digunakan. Aplikasi meminta scope AppFolder dan offline_access, tanpa akses seluruh drive.
5. Overview → salin Application (client) ID. Tenant ID berbeda dan tidak digunakan endpoint consumers untuk akun pribadi.
6. Client ID proyek sudah tersedia di Settings Personal Cloud Backup → OneDrive. Untuk pendaftaran lain, buka Pengaturan koneksi dan masukkan client ID. Pilih Hubungkan OneDrive, lalu Buka login Microsoft. Masukkan kode yang ditampilkan Hydra, login, periksa nama aplikasi dan persetujuan. Kode berakhir sesuai waktu Microsoft dan dapat dibatalkan.

Rujukan: [pendaftaran aplikasi](https://learn.microsoft.com/en-us/graph/auth-register-app-v2), [device authorization](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [folder khusus aplikasi](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder). Microsoft menyediakan [Entra ID Free](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/microsoft-entra-id-free); akses tenant/pendaftaran Azure tetap mengikuti persyaratan akun Microsoft.

## Penggunaan

Pilih folder backup lokal dan lokasi save seperti sebelumnya. Setelah OneDrive terhubung, setiap versi normal baru disalin ke antrean unggahan. Tombol Unggah backup terbaru / coba lagi juga memasukkan versi normal terbaru yang telah ada untuk game ini (atau setiap game pada Settings). Versi pengaman tetap lokal.

Paket cloud ditempatkan pada folder khusus aplikasi di OneDrive/Apps. Nama folder mengikuti pendaftaran Microsoft. Status backup lokal dan status unggahan terpisah. Berhasil mengunggah berarti Microsoft Graph mengembalikan item dengan nama dan ukuran paket sesuai; riwayat lokal saja tidak membuktikan unggahan.

Saat offline setelah terhubung, backup lokal dan antrean tetap bekerja. Antrean tersimpan dalam profil aplikasi, terpisah dari retensi 10 versi lokal. Satu pekerjaan dikirim pada satu waktu, dengan batas waktu jaringan 60 detik, jeda retry bertahap 10 detik sampai 5 menit, dan penghormatan Retry-After sampai 1 jam. Menutup aplikasi menunggu pekerjaan aktif selesai/gagal; pekerjaan yang belum selesai dilanjutkan setelah dibuka lagi. Saat belum terhubung tidak ada timer jaringan OneDrive.

Lihat versi OneDrive pada halaman game → Unduh ke riwayat → konfirmasi unduhan. Ini tidak mengganti save. Setelah unduhan selesai, buka Pulihkan → pilih versi lokal → konfirmasi pemulihan. Game harus ditutup dan backup pengaman dibuat oleh layanan pemulihan yang sudah ada.

## Batas dan perlindungan

- Maksimum 32 MiB isi save dan 10.000 file per versi, 48 MiB paket/metadata setelah ekstraksi; format JSON+gzip dengan blob berdasarkan SHA-256. Save lebih besar tetap dibackup lokal, tetapi tidak masuk cloud.
- Antrean maksimal 512 MiB / 1.000 pekerjaan tertunda. Kegagalan antrean ditampilkan terpisah dan dapat dicoba kembali dari backup lokal terbaru.
- Hanya versi perangkat yang sama dan konfigurasi root save yang sama yang dapat diunduh/dipulihkan. Jangan hapus profil Hydra bila ingin tetap mengenali identitas perangkat. Pemetaan antar-PC dijadwalkan 0.4.
- Riwayat cloud belum dipangkas otomatis. Perhatikan kapasitas OneDrive. Paket berisi save tanpa enkripsi ujung-ke-ujung; akun OneDrive mengontrol aksesnya.
- Token akses/refresh hanya di proses utama, disimpan melalui Electron safeStorage (perlindungan Windows). Tidak masuk renderer, aktivitas, backup game, atau repository. Login gagal tertutup bila perlindungan kredensial tidak tersedia.
- Pekerjaan diikat ke identitas drive asal. Menyambungkan akun lain tidak mengirim antrean akun sebelumnya. Putuskan koneksi menghapus sesi lokal, tidak menghapus backup dan tidak mencabut persetujuan Microsoft di server.
- Unduhan memakai URL HTTPS OneDrive yang dikenali tanpa meneruskan bearer token. SHA-256 paket dan setiap blob, metadata, identitas perangkat/game, path Windows, serta root lokal diperiksa sebelum versi dipublikasikan. Paket tidak menentukan path absolut tujuan save.
- Batas ini mengurangi penggunaan memori tahap awal; unggahan besar/chunked dan migrasi perangkat belum tersedia.

## Validasi

Tes lokal mencakup backup→paket→unduh/impor→pemulihan berpengaman, korupsi/path traversal/perangkat berbeda, antrean offline/restart/akun berbeda, rotasi token bersamaan, sanitasi error, dan pemisahan token dari URL unduhan. Tes browser memakai Microsoft/OneDrive simulasi. Belum ada login, upload/download OneDrive nyata atau uji save game pengguna. Client ID proyek telah diberikan pengguna; persetujuan akun nyata masih diperlukan untuk uji tersebut.
