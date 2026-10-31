# Hydra Personal Backup untuk Windows

Paket khusus Hydra 4.3.0 dengan Personal Cloud Backup. Memerlukan Windows 10/11 64-bit. Node.js, Yarn, Rust, dan Ludusavi tidak perlu dipasang terpisah.

1. Tutup Hydra yang sedang berjalan, termasuk ikon di dekat jam Windows. Jangan jalankan kedua salinan bersamaan karena memakai pustaka/pengaturan Hydra yang sama.
2. Jalankan file `Hydra-Personal-Backup-…-windows-x64-setup.exe`. Pilih folder baru, berbeda dari instalasi Hydra resmi. Alternatif: jalankan file `…-portable.exe`.
3. Buka pintasan **Hydra Personal Backup**.
4. Buka **Settings → Personal Cloud Backup** dan ikuti **Mulai backup pribadi**: pilih folder tujuan, pilih game, deteksi atau tentukan save, buat backup percobaan, lalu tekan **Aktifkan dan selesaikan**. Untuk cloud, gunakan folder lokal yang disinkronkan OneDrive, Google Drive, Dropbox, atau pCloud. Aplikasi cloud harus sudah terpasang dan masuk ke akun kamu.
5. Pada halaman game, periksa lokasi save yang ditemukan. Jika muncul **Perlu pengaturan**, pilih lokasi save manual. Coba **Backup sekarang** dan pastikan **Backup lokal selesai**.
6. Untuk memulihkan, tutup game, pilih versi pada riwayat, lalu pilih **Pulihkan**. Kondisi save saat ini dicadangkan terlebih dahulu.

Database lokasi save diunduh pada penggunaan pertama; setelah itu deteksi memakai cache. Internet diperlukan untuk unduhan awal. **Backup lokal selesai** belum membuktikan unggahan cloud selesai; periksa aplikasi cloud.

Gunakan salinan save contoh untuk percobaan pertama. Dukungan awal Steam dan game custom dengan executable diketahui. Pemulihan lintas PC, Registry, Epic terkelola, dan emulator belum didukung.

Paket ini memakai profil Hydra yang sama, sehingga riwayat game tetap tersedia. Jangan menghapus profil tersebut atau memasang di atas folder Hydra resmi. Pemulihan profil atau perubahan versi Hydra dapat memengaruhi kompatibilitas. Pembaruan aplikasi otomatis dinonaktifkan dalam build ini; perbarui melalui paket Personal Backup berikutnya.

Build belum ditandatangani dengan sertifikat penerbit Windows. Tidak diperlukan mematikan antivirus. Periksa asal unduhan dan SHA256SUMS.txt dari hasil build yang sama.

## Memperbarui Personal Backup

Tutup game dan Hydra, termasuk ikon di dekat jam. Jika memakai installer, jalankan installer Personal Backup yang baru ke folder Personal Backup sebelumnya; pastikan folder itu berbeda dari Hydra resmi. Jika memakai portable, simpan file baru di lokasi pilihan lalu jalankan file baru tersebut. Jangan menghapus profil Hydra atau folder backup cloud.

## Jika deteksi save gagal

- Pada Settings → Personal Cloud Backup, tekan **Perbarui database lokasi save**, lalu ulangi **Deteksi lokasi save** pada halaman game.
- Jika game/Steam ID belum dikenali, gunakan **Pilih folder save** atau **Pilih file save**. Pilih save asli game, bukan folder tujuan backup cloud.
- Setelah lokasi dipilih, tekan **Backup sekarang** dan periksa **Backup lokal selesai**.
- Versi 0.1.0 memiliki masalah pencarian Steam ID yang dapat menunggu input sampai batas waktu. Perbaikan ada pada 0.1.1. Pengguna tidak perlu menjalankan perintah Ludusavi sendiri.

## Melihat operasi berjalan (0.1.2)

Settings dan halaman game menampilkan antrean serta tahap operasi yang sedang berjalan. Saat jumlah file diketahui, progress bar menunjukkan file yang selesai pada tahap tersebut; tahap pemindaian/verifikasi memakai indikator berjalan tanpa persentase keseluruhan. Waktu mulai, pembaruan tahap, dan hasil operasi terakhir ditampilkan. Jika save tidak berubah, pemeriksaan selesai tanpa membuat versi baru.

Permintaan pengaturan atau pemulihan yang dibuat saat backup aktif menunggu operasi saat ini selesai. Pemeriksaan otomatis berhenti sebelum game berikutnya untuk memberi giliran pada permintaan pengguna. Jangan tutup aplikasi selama penggantian save berlangsung.

## Tray dan performa (0.1.3)

Menutup jendela utama melepaskan renderer utamanya, sementara proses Hydra tetap berjalan di tray. Jika pengaturan Hydra memilih keluar ketika jendela ditutup, aplikasi benar-benar keluar dan backup otomatis berhenti. Gunakan klik ganda ikon tray untuk membuka kembali; menu klik kanan menyediakan Personal Cloud Backup, status backup saat menu diperbarui, dan Keluar. Menu tampil dari cache, lalu diperbarui di latar paling sering sekali tiap 15 detik saat diminta; tidak ada timer pembaruan menu tersendiri. Status menu dapat tertinggal sampai dibuka berikutnya.

Pada 0.2.0, perubahan save dipantau melalui folder. Perubahan berdekatan ditunggu sekitar 1,5 detik sejak perubahan terakhir, lalu isi save diperiksa stabil selama 1,2 detik sebelum disalin. Jika masih berubah, pemeriksaan otomatis mencoba lagi. Pemeriksaan cadangan dilakukan tiap 60 detik ketika pemantauan tersedia. Jika pemantauan tidak tersedia, pemeriksaan dilakukan tiap 5 detik saat aktif atau 30 detik saat tray idle tanpa game berjalan. Ini jadwal minimum, bukan jaminan waktu selesai pada pustaka besar. Backup manual dan pemicu game ditutup tetap langsung masuk antrean. Pengaturan yang tidak berubah tidak ditulis ulang ke disk. Pembaruan progres/riwayat antarmuka dihentikan saat halaman tersembunyi.

Tray tetap memerlukan proses utama Hydra dan layanan yang sedang dipakai, termasuk pemantauan game, download aktif, serta backup. Ini bukan janji pemakaian CPU/RAM nol. Installer disarankan untuk penggunaan harian; portable perlu mengekstrak paket ketika dijalankan sehingga pembukaan awal dapat lebih lambat.

## Membuka lokasi save dan backup

Pada halaman game → Personal Cloud Backup, klik **Buka lokasi save** di samping lokasi yang ingin dilihat. Jika lokasi berupa file, File Explorer membuka folder induknya dan menyorot file tersebut. Untuk beberapa lokasi save, tersedia tombol pada setiap lokasi.

Klik **Buka lokasi backup** untuk membuka folder backup game pada perangkat ini. Pada Settings → Personal Cloud Backup, tombol yang sama membuka folder tujuan utama. Folder game tersedia setelah backup pertama dibuat. Jika lokasi save dihapus atau folder cloud tidak tersedia, aplikasi menampilkan alasan; tombol ini tidak membuat atau memulihkan save. Backup memakai struktur internal aplikasi; gunakan tombol **Pulihkan** untuk mengembalikan progres.

## Riwayat lebih ringan (0.1.5)

Aplikasi memakai hasil pemeriksaan file backup yang belum berubah agar pembaruan riwayat tidak membaca ulang seluruh isinya. Cache hilang ketika aplikasi ditutup. Pemeriksaan pertama setelah membuka aplikasi masih dapat membaca backup dari folder cloud.

Sebelum pemulihan, isi versi yang dipilih tetap diperiksa ulang sepenuhnya. Backup baru juga diperiksa ulang sebelum versi lama dihapus sesuai batas riwayat. Format dan lokasi backup tidak berubah; backup lama tetap dapat digunakan. Pembaruan ini mengurangi pembacaan isi backup berulang, bukan ukuran installer atau ukuran riwayat.

## Ruang penyimpanan dan pemulihan terputus (0.2.0)

Jika ruang folder backup kurang dari 1 GB, aplikasi menampilkan peringatan. Sebelum menyalin, aplikasi memeriksa perkiraan ukuran data dan cadangan ruang 16 MiB jika informasi volume tersedia. Pemeriksaan tidak menjamin kuota cloud atau ruang tetap cukup selama operasi; kegagalan penyalinan tetap dilaporkan.

Jika ada catatan pemulihan yang terputus, aplikasi memblokir backup dan pemulihan baru untuk game tersebut. Tutup game, buka Personal Cloud Backup, lalu pilih **Tangani pemulihan** dan baca konfirmasinya. Untuk catatan baru, aplikasi memeriksa apakah pemulihan sudah selesai atau mencoba mengembalikan kondisi sebelumnya. File yang perlu dipindahkan tetap disimpan di samping lokasi save dengan nama `hydra-interrupted`; file `hydra-previous` yang tersisa juga tidak dihapus oleh penanganan ini. Catatan baru dihapus hanya setelah isi save sesuai fingerprint kondisi yang dicatat.

Jika catatan lama, rusak, lokasi berubah, atau hasil tidak dapat dipastikan, penanganan otomatis ditolak. Gunakan **Buka catatan pemulihan**, pertahankan journal serta folder `hydra-previous`/`hydra-interrupted`, dan periksa salinan save serta backup pengaman sebelum perubahan manual. Jangan menghapus journal hanya untuk menghilangkan peringatan. Penanganan ini tidak menjamin perlindungan terhadap kehilangan daya atau kerusakan disk.

Pengguna lama yang pernah berhasil backup dan masih mengaktifkan Auto Backup tidak harus mengulang panduan; gunakan **Buka panduan pengaturan awal** jika diperlukan. Pergantian tujuan backup meminta backup percobaan baru. Versi ini belum memakai OAuth atau sinkronisasi achievement personal cloud.
