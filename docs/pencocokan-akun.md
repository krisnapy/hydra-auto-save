# Akun Hydra dan OneDrive sebagai pemilik backup

Status: kode kandidat 0.3.9, belum masuk installer terbit. Sebelumnya backup dipisahkan oleh ID perangkat lokal dan penyimpanan OneDrive, tanpa keterkaitan dengan login Hydra.

## Identitas yang dicocokkan

Backup lokal baru mencatat server Hydra dan ID pengguna Hydra yang sedang login. Paket unggahan OneDrive mencatat identitas Hydra tersebut beserta ID drive OneDrive yang diperoleh dari Microsoft Graph. Nama tampilan atau alamat email bukan kunci pencocokan. Akun Hydra dan Microsoft merupakan dua login terpisah; email keduanya tidak harus sama.

Login OneDrive yang dimulai pada profil Hydra aktif menautkan pasangan itu pada konfigurasi cloud. Panel OneDrive menampilkan ID profil Hydra, server, ID drive OneDrive dan status pasangan. Login Hydra diperlukan untuk menghubungkan OneDrive. Backup lokal tanpa login tetap tersedia sebagai profil tamu, tanpa unggahan OneDrive.

Pengaturan, daftar lokasi save, identitas perangkat lokal, sesi OneDrive dan antrean setiap akun Hydra disimpan terpisah di bawah profil aplikasi. Logout atau pergantian akun menghentikan layanan lama dan memuat profil yang sesuai. Backup tidak dihapus ketika akun berubah. Konfigurasi tamu/versi lama tetap di lokasi sebelumnya; pengguna perlu memilih tujuan backup dan lokasi save pada profil Hydra yang baru pertama kali dipakai.

## Setelah install ulang

1. Login ke akun Hydra yang sama, pada server yang sama.
2. Pilih folder backup lokal untuk staging/riwayat.
3. Hubungkan OneDrive yang sama.
4. Buka halaman game → **Pulihkan dari perangkat/profil lama** → **Cari backup akun ini di OneDrive**, atau cari folder backup lokal lama.
5. Backup bertanda **Akun cocok** memakai identitas pemilik yang sama meski ID perangkat Windows/Hydra baru berbeda. Pilih versi, cocokkan lokasi save baru dan konfirmasi restore.

Untuk backup lokal, pencocokan memakai identitas Hydra. Untuk sumber OneDrive, kedua identitas Hydra dan drive harus cocok. Backup yang sudah mencatat pemilik berbeda tidak ditawarkan. Identitas perangkat tetap dipakai untuk memisahkan riwayat PC; tidak dipakai sebagai identitas pemilik akun.

Ini pencocokan untuk menawarkan pemulihan yang dipilih pengguna. Login tidak langsung mengganti save atau menggabungkan progres antar-PC.

## Backup dan antrean sebelum fitur ini

Backup lama belum mencatat ID akun Hydra, sehingga kepemilikannya tidak bisa disimpulkan dari keberadaan file di OneDrive. Daftar menandainya **Pemilik belum tercatat · perlu penautan manual**. Pengguna memilih game dan semua tujuan, lalu dialog **Tautkan dan pulihkan** meminta konfirmasi penautan salinan backup ke profil Hydra aktif. Sumber lama tidak diubah. Metadata `origin` menyimpan asal serta status penautan lama.

Antrean lama yang belum memiliki penanda pasangan akun ditahan, tanpa diunggah otomatis. Backup lokal tetap ada. Setelah memulihkan/menautkan versi ke profil aktif, buat atau unggah backup baru dari profil tersebut. File token lama tidak dipindahkan ke akun Hydra baru secara otomatis; hubungkan OneDrive kembali pada profil itu.

## Pemeriksaan

Pemilik diperiksa sebelum pemilihan, import dan restore. Antrean unggahan diikat ke pasangan Hydra–OneDrive, selain pemeriksaan drive asal yang sudah ada. Pergantian akun/sesi membatalkan operasi lama sebelum publikasi atau penggantian save berikutnya. Backup pengaman dan journal pemulihan tetap berlaku.

Tes simulasi memeriksa akun sama setelah reinstall, server/akun berbeda, drive berbeda, pergantian akun dan logout saat operasi, penautan legacy, antrean lama yang ditahan, kepemilikan paket unggahan, serta pemisahan layanan/pengaturan per profil. Akun Hydra dan OneDrive nyata, build installer dan perilaku Electron Windows belum diverifikasi untuk perubahan ini.
