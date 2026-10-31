# Hydra Personal Backup untuk Windows

Paket khusus Hydra 4.3.0 dengan Personal Cloud Backup. Memerlukan Windows 10/11 64-bit. Node.js, Yarn, Rust, dan Ludusavi tidak perlu dipasang terpisah.

1. Tutup Hydra yang sedang berjalan, termasuk ikon di dekat jam Windows. Jangan jalankan kedua salinan bersamaan karena memakai pustaka/pengaturan Hydra yang sama.
2. Jalankan file `Hydra-Personal-Backup-…-windows-x64-setup.exe`. Pilih folder baru, berbeda dari instalasi Hydra resmi. Alternatif: jalankan file `…-portable.exe`.
3. Buka pintasan **Hydra Personal Backup**.
4. Buka **Settings → Personal Cloud Backup**. Pilih folder lokal yang disinkronkan OneDrive, Google Drive, Dropbox, atau pCloud, lalu aktifkan **Auto Backup**. Aplikasi cloud harus sudah terpasang dan masuk ke akun kamu.
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
