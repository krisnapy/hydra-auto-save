# Pemulihan dari profil atau perangkat lama

Pemulihan dimulai dari Settings atau halaman game dan memerlukan konfirmasi pengguna.

Login akun Hydra yang sama dan hubungkan OneDrive yang sama agar [identitas pemilik backup cocok](pencocokan-akun.md). Backup tanpa metadata pemilik memerlukan konfirmasi penautan manual.

Profil Windows/Hydra lama boleh hilang, selama folder backup atau paket OneDrive beserta datanya masih lengkap. Identitas perangkat baru tetap dipakai. Fitur membuat salinan versi terpilih di riwayat baru dan menyimpan identitas game/perangkat/versi asal pada metadata `origin`.

## Cara memakai

1. Tambahkan game ke pustaka Hydra baru dan atur executable `.exe`. Game Steam dan game kustom dapat dipulihkan jika ID game di pustaka saat ini sama dengan ID di backup.
2. Pilih folder backup lokal di **Settings → Personal Cloud Backup**. Untuk sumber OneDrive, hubungkan akun Microsoft pemilik backup lama.
3. Buka **Pulihkan dari perangkat/profil lama** dari halaman game atau **Settings → Personal Cloud Backup**.
4. Pilih **Cari backup di folder lama**, lalu pilih folder induk yang berisi `HydraPersonalBackup`; atau pilih **Cari backup akun ini di OneDrive**. Halaman game hanya menampilkan backup game tersebut. Settings mengelompokkan backup berdasarkan ID profil perangkat lama.
5. Dari Settings, tekan **Lihat detail profil** untuk melihat daftar game. Game tanpa ID yang cocok di pustaka hanya tampil sebagai informasi. Pilih versi untuk game yang ingin dipulihkan.
6. Jika lokasi save belum tersedia, pilih **Pulihkan setelah game ditutup** dan konfirmasi antrean. Buka game pada profil Windows saat ini, buat save pertama, lalu tutup game. Hydra memeriksa lokasi lagi saat mendeteksi game ditutup. Anda dapat mengantrekan pemulihan dari halaman game maupun Settings.
7. Jika satu profil tujuan cocok, Hydra meneruskan pemulihan yang sudah diantrekan. Jika ada beberapa profil, tekan **Pulihkan di sini** di samping ID profil tujuan. Jika lokasi belum bisa dicocokkan, batalkan antrean, pilih ulang backup, lalu isi tujuan secara manual. Untuk tujuan yang sudah diketahui sebelum mengantre, periksa tujuan di dialog konfirmasi dan tekan **Pulihkan**.
8. Pantau status pemulihan di panel. Saat masih menunggu atau menyiapkan file, tekan **Batalkan pemulihan** jika perlu. Setelah tahap penggantian dimulai, Hydra menyelesaikan operasi dengan journal pemulihan. Antrean aktif selama Hydra berjalan, termasuk saat diminimalkan ke tray, dan berakhir saat keluar dari Hydra atau berganti akun.

Pemulihan hanya menyentuh lokasi tujuan untuk game terpilih. Lokasi yang bertumpuk dengan save game lain yang sudah dikonfigurasi ditolak. File dengan nama dan lokasi yang sama dipulihkan dari versi lama. File tambahan tetap tersedia. Gunakan lokasi khusus save game. Hydra membuat backup pengaman kondisi tujuan sebelum mengganti save. Backup yang sudah mencatat pemilik akun lain tidak ditawarkan. Backup lama tanpa pemilik memerlukan tombol konfirmasi **Tautkan dan pulihkan**. Backup sumber tidak dipindahkan, diubah identitasnya, atau dihapus. Versi impor di profil baru mengikuti aturan retensi profil baru, sedangkan versi pengaman tetap dilindungi.

Jika import selesai tetapi restore gagal, versi impor tetap ada di **Pulihkan** biasa. Tutup proses game atau perbaiki masalah yang dilaporkan, lalu coba versi tersebut lagi. Jika operasi penggantian terputus, gunakan **Tangani pemulihan** yang sudah tersedia; jangan hapus journal atau file pengaman.

## Pemeriksaan dan batas

- Identitas sumber, penanda selesai lokal, hash data, fingerprint, jenis file/folder, path relatif, serta tujuan ganda/bertumpuk diperiksa. Path dari backup tidak dipakai sebagai path tujuan.
- Pencocokan otomatis memakai ID lokasi atau, bila metadata lokal tersedia, nama file/folder beserta nama folder induknya. Tujuannya selalu berasal dari konfigurasi game saat ini. Hydra menolak folder tujuan yang belum ada dan lokasi di bawah profil Windows lain pada direktori standar `Users`. Perubahan konfigurasi atau tujuan setelah konfirmasi membatalkan import.
- Pemilihan profil tersedia untuk backup file dengan satu folder akun bernomor dan file bersama di tingkat folder game. Hydra memakai lokasi yang diketahui dari metadata lokal atau ID lokasi yang masih cocok. Saat memilih satu profil, file akun lain tetap tersedia dan file bersama yang tercakup dalam versi dapat dipulihkan.
- Pemulihan memakai penguncian peluncuran Hydra, pemeriksaan proses game, backup pengaman, staging dan journal yang sama dengan restore biasa.
- Sumber OneDrive diikat ke akun asal. Pergantian akun membatalkan pemulihan. Paket `.hpb` baru tetap memerlukan blob `.hpd` yang dirujuknya. Batas OneDrive tetap 128 MiB isi save/10.000 file per versi, paket 192 MiB.
- Backup lokal disalin dan diverifikasi lewat streaming, tanpa batas ukuran paket OneDrive. Metadata lokal dibatasi 8 MiB per versi, maksimal 100 lokasi dan 5.000 versi per pencarian. Pencarian OneDrive dibatasi 500 folder dan 40.000 file pada tata folder aplikasi yang dikenali; tidak menelusuri seluruh drive.
- Ini pemulihan satu versi yang dipilih, dengan penggantian pada tingkat file. Isi dua versi dari file yang sama tidak digabung.

## Bukti pengujian

Tes lokal mencakup profil lama dan save asli yang sudah dihapus, lokasi tujuan yang belum dibuat, file tujuan yang belum ada di folder valid, penolakan jalur profil Windows lain, penolakan game kustom dengan ID berbeda, perlindungan save dan riwayat game lain, beberapa root, backup pengaman dan pemulihannya, data rusak, traversal, akun berubah, tujuan berubah, proses game aktif, serta backup lokal di atas 128 MiB. Pengujian Graph simulasi menemukan folder profil lama dan paket datar tanpa membuat folder sumber. Handler IPC diuji untuk pemilih native, pembatalan, konfirmasi dan penerusan ke restore berpengaman.

Tes antrean mencakup save pertama yang muncul setelah game berjalan, pemilihan satu atau beberapa profil, serta pembatalan saat menunggu dan selama staging. Tes browser memakai data contoh pada dua ukuran jendela, termasuk indikator yang tetap terlihat saat panel pemilihan ditutup dan tombol pembatalan. Pemeriksaan sintaks integrasi, tipe komponen React dan bundle modul utama dilakukan lokal. Perubahan antrean ini belum diuji di Electron Windows atau dikemas dalam installer Windows.
