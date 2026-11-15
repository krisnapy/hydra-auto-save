# Folder OneDrive per game — 0.3.4

Tersedia di installer 0.3.4. Rilis 0.3.3 masih menyimpan backup di folder aplikasi tanpa pengelompokan fisik per game. Folder baru memerlukan pembaca 0.3.4 atau lebih baru. Setelah menggunakan susunan baru, gunakan versi tersebut atau lebih baru untuk operasi cloud; versi lama tidak dapat menghitung seluruh rujukan data di folder baru.

Unggahan baru memakai struktur berikut di dalam folder aplikasi OneDrive yang sudah ada:

```text
ELDEN RING [ID game singkat]/
└── PC-Utama [ID perangkat]/
    ├── <identitas versi>.hpb
    └── <identitas isi>.hpd
```

Judul berasal dari pengaturan game Hydra; nama perangkat berasal dari hostname PC. Karakter yang tidak didukung OneDrive/Windows dibersihkan. Sufiks ID tetap dipertahankan agar judul yang sama atau nama PC yang sama tidak menimpa data lain. Judul berubah tetap dapat ditemukan berdasarkan sufiks identitas folder; nama folder yang sudah ada tidak diubah otomatis. File internal tetap memakai identitas lengkap untuk pemeriksaan integritas.

Pembacaan dan daftar riwayat mencakup folder lama serta folder game/perangkat yang sesuai. Tidak ada pemindahan atau penghapusan otomatis seluruh backup lama. File save identik yang sudah ada di lokasi lama dapat tetap digunakan oleh versi baru tanpa diunggah ulang; jangan menghapus folder lama atau memindahkan `.hpb`/`.hpd` secara manual. Pembersihan cloud menghitung rujukan dari kedua susunan. Jika ada file dengan identitas sama di dua lokasi, pembersihan dihentikan untuk diperiksa.

Folder dibuat dengan penanganan konflik tanpa mengganti folder yang sudah ada. Operasi penghapusan memakai lokasi hasil pemeriksaan dan ETag, serta tetap mengikuti perlindungan riwayat/pengaman yang ada. Cache lokasi dibuang saat pergantian identitas akun atau putus koneksi. ID perangkat tetap unik per PC; pemulihan lintas perangkat belum ditambahkan.

Pesan kegagalan unggahan sekarang menyebut nama dan ID game. Jika batas terlampaui, pesan memuat ukuran save dan jumlah file yang terdeteksi. Mulai 0.3.5 batas menjadi **128 MiB dan 10.000 file per versi** (0.3.4: 32 MiB), dihitung sebelum kompresi; melepas/menghubungkan akun tidak mengubah batas tersebut. Periksa lokasi save jika folder yang dipilih ternyata terlalu luas. Backup lokal tetap tersedia.

Pengujian memakai simulasi Graph untuk folder, unggahan, daftar riwayat, unduhan, konflik, ETag, akun, serta pemulihan dan retensi pada campuran data lama/baru. Belum menjalankan operasi folder pada akun OneDrive nyata.

Referensi API: [pembuatan folder](https://learn.microsoft.com/en-us/graph/api/driveitem-post-children?view=graph-rest-1.0) dan [daftar isi folder](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0).


### Perbaikan pembuatan folder pada 0.3.7

Diagnostik pengguna mempersempit respons 400 `invalidRequest` ke operasi **membuat folder**. Mulai 0.3.7, aplikasi mengambil ID AppFolder dan mengirim pembuatan subfolder lewat `POST /me/drive/items/{parent-id}/children?@microsoft.graph.conflictBehavior=fail`, dengan JSON `name` dan `folder` saja. Ini mengganti POST langsung pada alias `special/approot` dan konflik di badan JSON; tidak mengubah susunan atau identitas folder. ID AppFolder diverifikasi dan cache dibuang saat putus koneksi/pergantian akun. Konflik 409 tetap dibaca ulang dan hanya folder yang identitasnya cocok yang dipakai.

Regresi menyimulasikan penolakan POST melalui alias, memeriksa endpoint/parameter baru, penolakan ID induk tidak valid atau akun tidak sesuai, serta antrean tetap utuh pada 400 dan unggahan pekerjaan yang sama setelah retry. Bukti tersebut merupakan uji simulasi, belum verifikasi bahwa kasus pada akun pengguna telah selesai.
