# Pemulihan dari profil atau perangkat lama

Status: tersedia pada installer 0.3.9. Pemulihan tetap dipilih dan dikonfirmasi pengguna, tanpa restore otomatis saat startup.

Login akun Hydra yang sama dan hubungkan OneDrive yang sama agar [identitas pemilik backup cocok](pencocokan-akun.md). Backup tanpa metadata pemilik memerlukan konfirmasi penautan manual.

Profil Windows/Hydra lama boleh hilang, selama folder backup atau paket OneDrive beserta datanya masih lengkap. Identitas perangkat baru tetap dipakai. Fitur membuat salinan versi terpilih di riwayat baru dan menyimpan identitas game/perangkat/versi asal pada metadata `origin`.

## Cara memakai

1. Tambahkan game ke pustaka Hydra baru dan atur executable `.exe`. Game Steam maupun kustom didukung; ID game kustom boleh berbeda dari profil lama.
2. Pilih folder backup lokal di **Settings → Personal Cloud Backup**. Untuk sumber OneDrive, hubungkan akun Microsoft pemilik backup lama.
3. Buka halaman game → **Pulihkan dari perangkat/profil lama**.
4. Pilih **Cari backup di folder lama**, lalu pilih folder induk yang berisi `HydraPersonalBackup`; atau pilih **Cari backup akun ini di OneDrive**. Hydra membaca folder datar lama maupun folder nama game/perangkat. Daftar dapat memuat game lain, sehingga pastikan game sumber sesuai.
5. Pilih versi berdasarkan game, perangkat dan tanggal. Isi diperiksa sebelum pilihan lokasi tujuan ditampilkan.
6. Pilih tujuan untuk **setiap** lokasi save. Nama pengguna Windows dan lokasi drive boleh berbeda. File tunggal memakai dialog nama/lokasi file; folder memakai dialog folder yang dapat dibuat melalui pemilih. Contoh nama file dan ID lokasi membantu pencocokan. Bila `_INFO GAME.txt` lokal tersedia, lokasi lama ditampilkan sebagai keterangan; keterangan ini tidak digunakan sebagai tujuan otomatis. Paket lama berisi file tunggal mungkin tidak menyimpan nama/path aslinya, sehingga perlu dicocokkan manual.
7. Tutup game, tekan **Pulihkan versi ini**, periksa game serta seluruh tujuan pada dialog konfirmasi, lalu pilih **Pulihkan**.

File tambahan pada lokasi save tujuan diganti sesuai versi yang dipilih. Gunakan lokasi khusus save game. Hydra membuat backup pengaman kondisi tujuan sebelum mengganti save. Backup yang sudah mencatat pemilik akun lain tidak ditawarkan. Backup lama tanpa pemilik memerlukan tombol konfirmasi **Tautkan dan pulihkan**. Backup sumber tidak dipindahkan, diubah identitasnya, atau dihapus. Versi impor di profil baru mengikuti aturan retensi profil baru, sedangkan versi pengaman tetap dilindungi.

Jika import selesai tetapi restore gagal, versi impor tetap ada di **Pulihkan** biasa. Tutup proses game atau perbaiki masalah yang dilaporkan, lalu coba versi tersebut lagi. Jika operasi penggantian terputus, gunakan **Tangani pemulihan** yang sudah tersedia; jangan hapus journal atau file pengaman.

## Pemeriksaan dan batas

- Identitas sumber, penanda selesai lokal, hash data, fingerprint, jenis file/folder, path relatif, serta tujuan ganda/bertumpuk diperiksa. Path dari backup tidak dipakai sebagai path tujuan.
- Semua tujuan harus dipilih secara eksplisit. Perubahan konfigurasi atau tujuan setelah konfirmasi membatalkan import. Perangkat/profil baru tidak mengambil identitas perangkat lama.
- Pemulihan memakai penguncian peluncuran Hydra, pemeriksaan proses game, backup pengaman, staging dan journal yang sama dengan restore biasa.
- Sumber OneDrive diikat ke akun asal. Pergantian akun membatalkan pemulihan. Paket `.hpb` baru tetap memerlukan blob `.hpd` yang dirujuknya. Batas OneDrive tetap 128 MiB isi save/10.000 file per versi, paket 192 MiB.
- Backup lokal disalin dan diverifikasi lewat streaming, tanpa batas ukuran paket OneDrive. Metadata lokal dibatasi 8 MiB per versi, maksimal 100 lokasi dan 5.000 versi per pencarian. Pencarian OneDrive dibatasi 500 folder dan 40.000 file pada tata folder aplikasi yang dikenali; tidak menelusuri seluruh drive.
- Ini pemulihan satu versi yang dipilih, tanpa penggabungan progres atau sinkronisasi konflik antar-PC.

## Bukti pengujian

Tes lokal mencakup profil lama dan save asli yang sudah dihapus, identitas baru, lokasi baru yang belum ada, game kustom dengan ID berbeda, beberapa root, file tunggal, backup pengaman dan pemulihannya, data rusak, traversal, akun berubah, tujuan berubah, proses game aktif, serta backup lokal di atas 128 MiB. Pengujian Graph simulasi menemukan folder profil lama dan paket datar tanpa membuat folder sumber. Handler IPC diuji untuk pemilih native, pembatalan, konfirmasi dan penerusan ke restore berpengaman.

Tes browser memakai data contoh pada dua ukuran jendela, termasuk pemetaan semua lokasi, pembatalan dan pembaruan riwayat. Pemeriksaan sintaks integrasi, tipe komponen React dan bundle modul utama dilakukan lokal. Build installer Windows, pemeriksaan tipe seluruh Hydra dan startup/tray Electron Windows lulus. Login akun Hydra/OneDrive nyata dan save pengguna belum diuji.
