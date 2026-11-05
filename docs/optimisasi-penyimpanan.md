# Optimisasi backup lokal dan cloud — 0.3.2

Fitur 0.3.2. Gunakan installer 0.3.2 atau lebih baru; installer 0.3.1 belum memuat fitur ini.

## Perilaku

- File berukuran minimal 4 KiB dicoba dengan gzip level 1 secara streaming. Hasil dipakai hanya jika menghemat lebih dari 64 byte. File kecil atau isi yang tidak dapat diperkecil disimpan mentah.
- Dalam satu versi, isi identik tetap memakai satu blob. Pemeriksaan kebutuhan ruang kini menghitung blob unik, bukan jumlah seluruh file duplikat.
- Isi yang sama dengan versi terdahulu disalin dari backup yang sudah terverifikasi. Data yang sudah dikompresi atau sudah diketahui tidak menguntungkan untuk dikompresi tidak dikompresi ulang. Sistem meminta reflink jika tersedia, dengan salinan biasa sebagai fallback; tidak menggunakan hardlink. Penghematan cloud tidak bergantung pada reflink.
- Setiap blob tujuan diperiksa sekali per isi unik saat penyalinan. Pemeriksaan kestabilan sebelum penyalinan, pemeriksaan sumber sesudahnya, dan verifikasi penuh sebelum retensi tetap berjalan.
- Permintaan unggahan OneDrive untuk versi yang sudah ada dalam antrean atau tanda terima perangkat/akun yang sama dilewati sebelum membaca dan mengemas seluruh data.
- Pemulihan membaca dan memeriksa isi terdekompresi secara streaming, membatasi output sesuai ukuran asli yang tercatat, lalu menulis salinan independen ke lokasi staging.

## Kompatibilitas dan batas

Backup lama schema 1 tetap dapat dipulihkan. Versi baru yang memiliki blob gzip memakai schema 2 dan daftar hash `compressed` pada manifest. Fingerprint dan hash file tetap berdasarkan isi save asli. Aplikasi lama akan mengabaikan versi schema 2; gunakan aplikasi baru untuk memulihkannya. Nama folder dan file internal tidak diubah.

Ekspor `.hpb` tetap memakai transport schema 1 gzip JSON/base64 sehingga pembaca paket sebelumnya tetap kompatibel. Kompresi lokal dibuka sebelum paket dibuat. Impor cloud tetap menyimpan format mentah kompatibel schema 1. Format lokal yang baru tidak dimasukkan ke paket cloud.

Backup lama tidak ditulis ulang atau dikonversi otomatis. Penghematan mulai berlaku untuk versi baru; versi lama dapat diproses melalui tombol optimisasi lokal yang dijelaskan di bawah. Setiap versi tetap mandiri; ini belum deduplikasi lintas versi di folder cloud. Pembersihan OneDrive memerlukan tombol optimisasi cloud dan konfirmasi. Riwayat lokal mengikuti retensi yang ada dan backup pengaman tetap dipertahankan. Save yang sudah dikompresi atau terenkripsi mungkin hampir tidak mengecil. Pemeriksaan ruang sebelum backup tetap memakai perkiraan konservatif berdasarkan ukuran isi unik sebelum kompresi.

## Verifikasi lokal

`node scripts/benchmark-storage.mjs` membuat dan menghapus data sintetis di folder sementara: JSON berulang, 512 KiB data acak, dan tiga versi. Tidak mengakses game atau akun pengguna.

Hasil satu run pada 5 November 2026:

| Ukuran | Byte |
| --- | ---: |
| Data tanpa kompresi, tiga versi | 9.159.591 |
| Data backup tersimpan | 1.902.918 |
| Termasuk manifest dan penanda lengkap | 1.906.578 |

Penghematan data **79,22% pada fixture ini**, bukan perkiraan untuk semua game. Durasi capture 38/21/21 ms memakai jendela kestabilan 1 ms untuk benchmark; aplikasi tetap memakai jendela normal 1,2 detik. Belum ada pembandingan waktu terhadap implementasi lama atau pengukuran Windows.

Pengujian mencakup kompresi/isi acak, file duplikat, versi independen sesudah retensi, pemulihan backup lama, korupsi/truncation/output dekompresi berlebih, pertukaran `.hpb`, serta antrean duplikat dan pergantian akun. Pemeriksaan lokal tidak menggantikan build installer, uji Windows, atau unggahan OneDrive nyata.

## Tombol optimisasi (0.3.2)

**Settings → Personal Cloud Backup → Optimalkan backup lokal** memeriksa semua game yang terdaftar pada perangkat ini. Pada halaman game, buka **⋯ → Optimalkan backup lokal** untuk satu game. Ringkasan menunjukkan jumlah versi lama yang akan dikompresi dan jumlah versi di luar batas riwayat yang akan dihapus, beserta ukuran data versi yang akan dihapus. Penghematan kompresi tidak ditebak sebelum proses selesai. Batal adalah pilihan awal dialog.

Proses lokal mengompresi ulang versi lama yang masih diperlukan, termasuk backup pengaman bila belum memakai penyimpanan adaptif. Setiap versi disiapkan terpisah dan diperiksa sebelum direktori ditukar. Identitas versi, tanggal, fingerprint, isi save, dan status pengaman dipertahankan. Salinan asli disimpan sampai pengganti lolos verifikasi penuh. Jika aplikasi berhenti di antara dua langkah penukaran direktori, pemeriksaan berikutnya mengembalikan salinan asli atau menyelesaikan pembersihan setelah pengganti diverifikasi. Pengganti rusak disimpan tersembunyi dengan awalan `_opt-failed-` untuk pemeriksaan. Operasi lokal dapat melaporkan gagal setelah sebagian versi selesai; versi yang sudah selesai tetap sah. Backup pengaman tidak dipangkas.

**Optimalkan backup cloud** muncul di bagian OneDrive setelah akun terhubung. Di pengaturan cakupannya semua game terdaftar; di halaman game cakupannya game tersebut. Batas riwayat mengikuti pilihan riwayat lokal. Proses hanya memindahkan paket normal di luar batas itu ke Recycle Bin, bukan mengompresi ulang `.hpb` yang sudah memakai gzip. Semua backup pengaman, paket yang tidak dapat diverifikasi, paket menunggu unggahan, dan backup perangkat lain dipertahankan. File di luar folder aplikasi tidak disentuh.

Pemeriksaan cloud mengunduh paket satu per satu untuk memverifikasi hash, isi, identitas game/perangkat dan status pengaman, tanpa memasukkannya ke riwayat lokal. Hanya ringkasan kecil dipertahankan di memori. Setelah konfirmasi, daftar file dan ETag diperiksa ulang tanpa mengunduh semua paket untuk kedua kalinya. Pratinjau berlaku lima menit; perubahan akun, pengaturan, antrean terkait atau daftar cloud meminta pemeriksaan ulang. Penghapusan memakai `If-Match` sehingga file yang berubah ditolak oleh OneDrive. Pemanggilan DELETE biasa pada Graph memindahkan file ke Recycle Bin; tidak memakai permanentDelete. [Dokumentasi Microsoft](https://learn.microsoft.com/en-us/graph/api/driveitem-delete?view=graph-rest-1.0). Pembaruan kuota tergantung OneDrive; jumlah MiB paket yang dipindahkan tidak membuktikan kuota langsung bertambah sebesar itu.

Kedua operasi masuk antrean yang sama dengan backup/pemulihan dan menampilkan tahap pemeriksaan, kompresi/pembersihan serta hasil akhir. Save asli tidak dipulihkan atau diganti oleh optimisasi. Mode cloud offline gagal tanpa memulai penghapusan; bila koneksi gagal setelah sebagian versi dipindahkan, jumlah yang sudah dipindahkan dilaporkan dan sisanya dipertahankan. Belum ada penjadwalan pembersihan otomatis.
