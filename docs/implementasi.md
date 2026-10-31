# Catatan implementasi awal

Tanggal: 1 November 2026 WITA. Status: paket Windows awal tersedia; uji game nyata belum dilakukan.

## OneDrive langsung — 0.3.0

Tahap awal OAuth device authorization untuk akun Microsoft pribadi memakai endpoint consumers, scope Files.ReadWrite.AppFolder dan offline_access, tanpa client secret. Client ID publik proyek disediakan pengguna melalui .env lokal/GitHub Secret, lalu ditanamkan hanya pada hasil build sebagai bawaan. Nilai dihapus dari sumber terbaru setelah pengguna meminta konfigurasi environment; commit privat lama tetap memuat pengenal publik, tanpa token/client secret. Microsoft menerima permintaan device-code untuk ID tersebut (masa kode900detik); uji ini tidak melakukan login, pertukaran token, atau akses drive akun nyata.

Token akses/refresh dipertahankan di proses utama dengan Electron safeStorage. Refresh bersamaan berbagi satu permintaan, token berotasi disimpan; disconnect menunggu pekerjaan jaringan sebelum menghapus kredensial agar refresh terlambat tidak menghidupkan sesi kembali. Halaman tepercaya mengirim perintah terbatas melalui IPC. URL login ditetapkan oleh proses utama; renderer tidak menyediakan URL, token, path impor atau isi paket.

Setiap versi normal baru setelah akun terhubung dipaketkan JSON+gzip dan disalin ke outbox di profil aplikasi. Batas32MiB/10.000file,48MiB metadata/ekstraksi,512MiB/1.000pekerjaan tertunda. Outbox independen dari retensi lokal, terikat drive asal, satu unggahan aktif, retry/backoff dan Retry-After. Nama remote memuat hash game, perangkat, versi dan SHA-256 paket; path outbox pendek memuat hash drive+nama sehingga nama Windows tetap pendek dan dua akun tidak berbagi file antrean.200receipt unggahan terbaru disimpan; tidak ada penghapusan versi cloud otomatis.

Unduhan dari URL HTTPS OneDrive yang dikenali tidak menerima Authorization. Hash paket/blob, root lokal, jenis/root present, path Windows/duplikat huruf besar-kecil, fingerprint, perangkat dan game diverifikasi sebelum publish staging atomik. Hanya perangkat serta konfigurasi save yang sama didukung. Unduh memerlukan konfirmasi dan hanya menambah riwayat; pemulihan berikutnya tetap memakai konfirmasi native, restore gate, pemeriksaan proses, backup pengaman dan journal. Import tidak menulis save.

77tes modul dan28tes UI/interaksi lulus lokal, termasuk roundtrip file asli fixture melalui paket/impor/pemulihan, korupsi/traversal, offline/restart, akun berbeda, refresh tunggal dan pemisahan bearer dari URL unduhan. UI memakai data contoh, bukan akun Microsoft nyata. Pemeriksaan integrasi lokal lulus. CI Windows juga lulus: [build41247200550](https://github.com/krisnapy/hydra-auto-save/actions/runs/41247200550), [verifikasi41248027671](https://github.com/krisnapy/hydra-auto-save/actions/runs/41248027671), [visual41248027689](https://github.com/krisnapy/hydra-auto-save/actions/runs/41248027689).77tes modul,28tes UI, typecheck Hydra, startup unpacked/portable, tray dan halaman game native lulus. Paket0.3.0 bersumber9dcc75a, menggunakan Secret wajib yang lolos validasi; repo tetap privat dan publikasi publik dilewati. Unduhan terbaru tercantum di README dan galeri. [Panduan dan batas OneDrive](onedrive.md).

## Panel backup ringkas — 0.2.3

Desain Panel samping diterapkan hanya pada bagian backup di halaman game. Grid menempatkan konteks/lokasi save di kiri dan kartu Personal Cloud di kanan; pada lebar jendela sampai1100 px susunannya menjadi satu kolom. Navigasi, hero, tombol Mainkan dan halaman Settings Hydra tidak didesain ulang. Path lengkap serta aktivitas berada dalam detail yang dapat dibuka. Nama folder pendek tetap membuka rootId tersimpan melalui IPC yang sama, tanpa menerima path dari renderer.

Kartu menampilkan waktu backup normal terakhir, jumlah versi perangkat ini, Auto Backup, progres, serta dua tindakan utama. Pulihkan membuka daftar versi dan Pilih versi memanggil konfirmasi native yang sudah ada. Backup pengaman dan pengecekan game berhenti tetap di layanan utama. Menu pilihan menampung deteksi ulang, pemilihan folder/file save dan buka backup. Lokasi belum diatur langsung menawarkan deteksi/pemilihan folder. Kegagalan, ruang penyimpanan rendah dan pemulihan terputus tetap terlihat tanpa membuka detail; versi pemulihan diblokir jika recovery terputus.

Polling progres tetap serial,250 ms aktif/1 detik idle, dan berhenti ketika tersembunyi. Perubahan hasil operasi memicu satu penyegaran snapshot sehingga waktu/jumlah versi segera mengikuti backup otomatis yang selesai; hasil identik tidak memicu pembacaan riwayat berulang.70 tes modul dan24 tes visual/interaksi lulus lokal serta Windows. Uji tambahan pada390 px tidak menemukan overflow horizontal. Pengujian browser memakai IPC contoh dan tidak membuktikan save/cloud nyata.

Repository terverifikasi privat. Workflow verifikasi tetap menyediakan artifact installer/portable terpisah, tetapi melewati publikasi rilis publik. Workflow visual memakai paket dari build yang memicunya dan checkout SHA yang sama, bukan paket 0.2.2 yang dipatok sebelumnya. Pengemasan renderer pada runner mencapai batas heap sekitar2 GB; NODE_OPTIONS4 GB diterapkan hanya pada langkah build dan tidak mengubah runtime aplikasi pengguna.

Build dan paket 0.2.3 terverifikasi: [build 41244821443](https://github.com/krisnapy/hydra-auto-save/actions/runs/41244821443), [verifikasi 41245568250](https://github.com/krisnapy/hydra-auto-save/actions/runs/41245568250), [visual 41245568264](https://github.com/krisnapy/hydra-auto-save/actions/runs/41245568264). Seluruh70 tes modul,24 tes UI, typecheck Hydra, startup unpacked/portable, tray dan halaman game native lulus. [Galeri dan batas pengujian](pengujian-tampilan.md) mencatat sumber serta unduhan privat. Pengemasan berhasil setelah batas heap build dinaikkan. Tes progres lama diperbarui agar mendukung useRef dan memeriksa penyegaran sekali per hasil operasi.

## Pemeriksaan backup dan status jeda aman — 0.2.2

Kode 0.1.5 yang diperiksa ([edff5cd](https://github.com/krisnapy/hydra-auto-save/commit/edff5cd80094d9e0eb1731de2dddd622f9ddbd51)) menampilkan stabilizing, menunggu 1,2 detik, lalu membaca ulang seluruh sumber sebelum membandingkan fingerprint dengan backup sebelumnya. Ini menjelaskan mengapa label menunggu dapat muncul pada semua game walaupun isinya tidak berubah; label juga menetap selama pembacaan ulang yang lama. Ini penyebab umum yang terverifikasi di kode; kondisi file/drive PC pengguna belum diobservasi.

0.2.2 membandingkan pembacaan awal dengan versi normal terakhir yang lolos pemeriksaan riwayat sebelum jeda. Isi identik langsung menghasilkan tidak ada versi baru; backup pengaman restore selalu dipaksa menjalani pemeriksaan penuh. Isi baru menunggu jeda aman dan dibaca ulang; perubahan singkat mendapat maksimum tiga jendela kestabilan, lalu berhenti jika masih berubah. Sumber tetap dibandingkan setelah penyalinan dan pending tidak dipublikasikan jika tidak sesuai. Pesan menyertakan maksimal tiga lokasi yang berubah/bertambah/hilang serta jumlah sisanya.

Phase checking-stability memisahkan pembacaan ulang dari waktu tunggu; callback scan menampilkan jumlah file yang telah diperiksa, termasuk scan awal dan verifikasi setelah penyalinan. Jumlah total yang belum diketahui tetap tanpa persentase. Tidak ada pengecualian file log/cache otomatis atau pengurangan pemeriksaan untuk versi baru.

Retry otomatis per game memakai backoff 5,10,20,40 hingga maksimum60 detik; event watcher tidak melewati batas ini. Game lain tetap diproses dan kontrol manual/game ditutup boleh mencoba langsung. Keberhasilan, penonaktifan, tujuan baru, atau lokasi baru mereset backoff terkait. State retry hanya di memori. File sumber yang hilang saat copy atau diganti saat scan ditandai transient; kesalahan akses/tujuan lain tetap dilaporkan.

70 tes lokal dan pemeriksaan integrasi lulus. Skenario mencakup skip kestabilan/scan kedua untuk isi identik, penulisan singkat yang selesai dalam satu backup, penulisan terus-menerus yang dibatasi beserta lokasi penyebab, serta backoff/fairness/manual bypass. Windows: seluruh70 tes, pemeriksaan integrasi dan typecheck Hydra lulus; startup unpacked/portable, pengaturan backup, endpoint progres dan tutup/buka ulang tray lulus. [Build41234708380](https://github.com/krisnapy/hydra-auto-save/actions/runs/41234708380), [verifikasi/publikasi41235274406](https://github.com/krisnapy/hydra-auto-save/actions/runs/41235274406), sumber [e2e62a4](https://github.com/krisnapy/hydra-auto-save/commit/e2e62a4be8f0e296710a06e7e06fe9ac493ac88b). [Rilis v0.2.2](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.2.2) publik; checksum/digest dan4 tautan anonim lulus. Pengujian file/game/cloud nyata di PC pengguna belum dilakukan.

## Progres halus dan folder save — 0.2.1

Panel progres terpisah dari state/pembaruan halaman utama. Endpoint `progress` membaca salinan operasi dan hasil terakhir dari memori secara sinkron; tidak membaca riwayat, ruang disk, journal, atau pustaka game. Polling serial dilakukan tiap 250 ms selama operasi/permintaan aktif, satu detik saat idle, berhenti saat halaman tersembunyi/unmount, dan mengabaikan respons terlambat. Hasil identik tidak menggambar ulang panel. Bar memakai transform dengan transisi 220 ms; tahap tanpa jumlah memakai animasi aktivitas tanpa persentase perkiraan. Preferensi reduced motion dihormati. Riwayat tetap diperbarui terpisah setiap 10 detik.

Lokasi save ditampilkan sebagai folder unik: file memakai folder induknya, folder memakai lokasinya sendiri, dan beberapa file dalam folder sama dikelompokkan. Ini tidak memperluas cakupan backup. Proses utama tetap mengambil lokasi dari konfigurasi tersimpan dan membuka folder melalui `shell.openPath`, termasuk ketika file save belum ada tetapi foldernya masih ada. Folder berbeda tidak digabung menjadi induk umum yang terlalu luas.

67 tes lokal dan pemeriksaan integrasi lulus. Pengujian baru memeriksa status murni memori/salinan terpisah, deduplikasi lokasi folder, serta polling serial, hasil identik, visibility, dan unmount. Windows: seluruh 67 tes, pemeriksaan integrasi dan typecheck Hydra lulus; startup unpacked/portable, endpoint progres, panduan awal dan tutup/buka ulang tray lulus. [Build 41233591174](https://github.com/krisnapy/hydra-auto-save/actions/runs/41233591174), [verifikasi/publikasi 41234172863](https://github.com/krisnapy/hydra-auto-save/actions/runs/41234172863), sumber [67366fc](https://github.com/krisnapy/hydra-auto-save/commit/67366fcdd3315bdd29fb30e6a14775bacc4d5090). [Rilis v0.2.1](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.2.1) publik dengan checksum/digest dan 4 tautan anonim lulus. Tes Windows pertama menemukan urutan cleanup fixture yang menghapus folder sebelum controller berhenti; helper tes diperbaiki untuk menghentikan pemantau dan menyelesaikan operasi dahulu. Kehalusan visual pada PC pengguna, Explorer nyata, game dan cloud nyata belum diverifikasi.

## Fondasi backup andal — 0.2.0

Versi ini mengimplementasikan tahap 0.2 roadmap Personal Cloud. `SaveMonitor` memantau folder save secara rekursif dan folder induk untuk penggantian file/folder. Event terkait save digabung selama 1,5 detik; penggantian/galat pemantau memicu pemasangan ulang. Folder yang belum ada dipantau dari induk terdekat sambil mempertahankan fallback. Watcher tidak dipasang untuk pemanggilan tick satu kali; ia aktif bersama lifecycle controller dan dilepas saat dinonaktifkan atau dihentikan.

Ketika pemantauan sehat, scan isi penuh tetap berjalan paling sering setiap 60 detik sebagai cadangan. Ketika pemantauan tidak tersedia, fallback 5 detik saat aktif dan 30 detik saat tray idle tetap berlaku. Event perubahan melewati pembatas tray setelah debounce. Backup manual/game ditutup tetap memakai antrean langsung. Pemeriksaan hash/kestabilan 1,2 detik dipertahankan; perubahan di tengah scan/copy menghasilkan retry otomatis dengan status menunggu. Event baru saat pekerjaan berjalan tidak sengaja dihapus dari daftar perubahan.

Volume diperiksa melalui statfs jika tersedia: peringatan kurang dari 1 GiB dan pemeriksaan kebutuhan payload ditambah ruang cadangan 16 MiB sebelum copy. Tidak ada klaim menjamin kuota penyedia cloud atau ruang yang berubah selama operasi. Ketika statfs tidak tersedia, status peringatan ditampilkan dan kegagalan copy tetap ditangani.

Journal pemulihan schema 2 mencatat fingerprint sebelum/sesudah serta keberadaan awal tiap root. Journal terputus memblokir capture baru. Penanganan melalui konfirmasi, restore/launch gate Hydra dan pemeriksaan game berhenti: rollback memakai folder hydra-previous, live data yang perlu dipindahkan disimpan sebagai hydra-interrupted; journal hanya dibuang setelah scan penuh sesuai fingerprint. Pemulihan yang sudah committed tidak dibalik; hasilnya diverifikasi. File pengaman tersisa dipertahankan. Journal lama/rusak/path berbeda ditolak untuk pemeriksaan manual. Ini bukan jaminan terhadap kehilangan daya dan tidak melakukan pemulihan diam-diam.

Panduan Settings meminta tujuan, pilihan game/lokasi, backup percobaan berhasil dan aktivasi. Status panduan tersimpan; tujuan baru meminta percobaan baru. Pengguna lama dengan riwayat berhasil dan Auto Backup aktif tidak dipaksa mengulang. Snapshot progres memakai cache daftar game dan overview agar tidak membaca ulang pustaka setiap detik.

64 tes lokal serta pemeriksaan integrasi lulus. Skenario baru mencakup event native/penggantian folder, burst/debounce, fallback tanpa watcher, save sibuk, low space sebelum retensi, journal tak aman, kondisi committed, gap rename sebelum penanda tersimpan, retry penanganan setelah live data dipindahkan, serta validasi panduan. Windows: 64 tes lulus, pemeriksaan integrasi dan typecheck Hydra lulus; startup unpacked/portable, panduan awal, serta tutup/buka ulang tray lulus. Sumber [f1a4d01](https://github.com/krisnapy/hydra-auto-save/commit/f1a4d019665df64c061b4366a07d3582b297744f); [build 41232551624](https://github.com/krisnapy/hydra-auto-save/actions/runs/41232551624), [verifikasi/publikasi 41232966750](https://github.com/krisnapy/hydra-auto-save/actions/runs/41232966750). [Rilis v0.2.0](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.2.0) publik, checksum/digest cocok dan keempat tautan unduh anonim lulus. Pengujian game/save/cloud nyata pengguna belum dilakukan.

## Cache pemeriksaan riwayat — 0.1.5

Tahap pertama tindak lanjut optimasi: kurangi pembacaan isi backup yang berulang. `versions()` tetap membaca manifest/penanda COMPLETE serta memeriksa keberadaan dan metadata setiap blob. Hash payload dipakai ulang hanya ketika hash yang diharapkan, device/inode file, ukuran, mtime nanodetik, dan ctime nanodetik sama. File yang berubah selama pemeriksaan ditolak. Cache LRU berada di memori, maksimum 8192 file; pemeriksaan bersamaan atas file/signature yang sama berbagi satu pekerjaan. Restart mengosongkan cache. Ini bukan pengganti autentikasi backup dan tidak menghilangkan pembacaan metadata atau pemeriksaan pertama terhadap berkas cloud.

Pemulihan memakai pemeriksaan hash baru yang melewati cache hanya untuk versi yang dipilih. Penyalinan ke staging juga tetap diverifikasi. Backup baru diperiksa penuh sebelum retensi boleh menghapus versi lama. Format penyimpanan tetap schema 1, tanpa migrasi atau deduplikasi antarversi.

51 tes lokal lulus dan pemeriksaan integrasi lokal lulus. Pada fixture payload 8 MiB, dua permintaan riwayat awal bersamaan berbagi satu pembacaan 8.388.608 byte; 20 pembaruan riwayat berikutnya menambah 0 byte payload yang di-hash. Uji ini membuktikan pengurangan pembacaan payload dalam fixture, bukan persentase peningkatan waktu/RAM di PC pengguna. Uji lain mencakup kerusakan berukuran sama dengan mtime dikembalikan, blob hilang, marker berubah, pemulihan yang melewati cache, serta kegagalan retensi ketika versi baru rusak. Belum ada perubahan ukuran installer, kompresi/deduplikasi, pemantauan folder, enkripsi, tanda tangan digital, atau pemulihan journal lewat UI dalam tahap ini.

51 tes juga lulus di Windows; log membuktikan 8.388.608 byte pada pemeriksaan riwayat awal dan 0 byte payload tambahan pada 20 pembaruan berikutnya. Pemeriksaan tipe seluruh Hydra serta [build Windows 41229882605](https://github.com/krisnapy/hydra-auto-save/actions/runs/41229882605) lulus dari commit `edff5cd80094d9e0eb1731de2dddd622f9ddbd51`. Uji startup executable unpacked dan tutup/buka ulang tray lulus. [Verifikasi/publikasi 41230472435](https://github.com/krisnapy/hydra-auto-save/actions/runs/41230472435) membuka portable, memeriksa checksum, dan menerbitkan [rilis publik 0.1.5](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.1.5). Keempat aset lolos pemeriksaan unduh anonim. Pengujian game/cloud nyata dan dampak performa di PC pengguna tetap diperlukan.

## Buka lokasi save dan backup — 0.1.4

Halaman game menampilkan tombol **Buka lokasi save** di setiap lokasi yang terdaftar, serta **Buka lokasi backup** untuk folder game/perangkat tersebut. Settings membuka folder tujuan backup utama. Lokasi backup berasal dari `BackupEngine.directory`, sehingga memakai struktur yang sama dengan penyimpanan riwayat.

Permintaan dari renderer hanya membawa ID lokasi; proses utama mencari path dari konfigurasi tersimpan dan memeriksa pengirim tepercaya. Folder dibuka dengan `shell.openPath`; file save disorot melalui `shell.showItemInFolder` dan tidak dieksekusi. Lokasi yang hilang, ID tidak dikenal, dan kegagalan Explorer menghasilkan pesan. Membuka lokasi memakai snapshot ringan dan tidak masuk antrean penyalinan/pemulihan. Tidak membuat folder atau memulihkan save yang hilang.

47 tes lokal lulus, termasuk pemilihan lokasi tersimpan, penolakan ID/pengirim tidak tepercaya, penyorotan file, serta kegagalan membuka folder. Pemeriksaan integrasi lokal lulus. Pemeriksaan tipe seluruh Hydra dan [build Windows 41228565492](https://github.com/krisnapy/hydra-auto-save/actions/runs/41228565492) lulus dari commit `057c047c4a5bc300d82d3750d6982aaf492d2233`. Uji startup executable unpacked serta tutup/buka ulang tray lulus. [Verifikasi 41229156190](https://github.com/krisnapy/hydra-auto-save/actions/runs/41229156190) membuka portable, memeriksa checksum dan layanan backup, lalu menerbitkan [rilis 0.1.4](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.1.4). Keempat aset lolos pemeriksaan unduh anonim. Pemanggilan Explorer diuji memakai stub shell; interaksi Explorer pada desktop pengguna dan save game nyata belum diuji.

## Build, startup, dan tray — 0.1.3

Permintaan pengguna: percepat build dan pembukaan aplikasi serta kurangi pekerjaan tray yang tidak diperlukan. Tidak ada klaim bahwa tray menggunakan CPU/RAM nol. Layanan pemantauan game, unduhan aktif, dan backup tetap memerlukan proses utama serta layanan Hydra terkait.

- Cache memakai kecocokan tepat Windows 2022/x64, Node 22.21.0, commit Hydra yang dipatok, serta hash package/lockfile. Tidak ada fallback ke cache dari sumber lain. Isi dependensi, runtime Legendary, Ludusavi, dan addon native digunakan kembali. Integritas Yarn dan pemuatan addon dengan Electron diperiksa sebelum build; cache yang baru diisi juga diuji dari runner baru.
- Penyiapan auth lokal tetap ditunggu. Pembaruan profil internet berjalan di latar dengan pemeriksaan generasi auth agar hasil sesi lama tidak mengganti sesi baru. Inisialisasi Epic opsional memakai satu promise bersama pada dua jalur startup.
- Tray dipegang sebagai satu instance. Menu awal/cached tampil tanpa menunggu database pustaka; penyegaran digabung dan dibatasi minimal 15 detik ketika diminta, tanpa timer penyegaran menu. Status menu dapat tertinggal sampai dibuka berikutnya. Klik ganda juga memulihkan jendela yang diminimalkan. Permintaan pembukaan yang bersamaan berbagi satu proses pembuatan jendela. Game Steam/custom dari tray melewati penguncian peluncuran/pemulihan Hydra.
- Snapshot ukuran/bounds jendela diambil sebelum await pada handler close; renderer utama tetap dilepaskan ketika ditutup. Tidak mempertahankan renderer utama tersembunyi untuk mempercepat pembukaan ulang.
- Saat semua jendela tersembunyi/minimized dan tidak ada game terpantau berjalan, hashing otomatis dijadwalkan paling sering setiap 30 detik. Saat jendela terlihat atau game berjalan, tetap 5 detik. Backup manual dan kejadian game ditutup langsung masuk antrean. Interval adalah jadwal pemeriksaan; satu putaran pada pustaka besar dapat memerlukan waktu lebih lama. Pengaturan yang sama tidak ditulis ulang; polling UI tersembunyi tidak mengirim IPC progres/riwayat.

45 pengujian lokal dan Windows lulus, termasuk menu tray ketika pustaka belum selesai dibaca, penggabungan refresh, pemulihan jendela yang diminimalkan, startup ketika profil internet belum selesai, pengabaian profil dari generasi auth lama, dan penjadwalan tray idle. Pemeriksaan integrasi lokal serta pemeriksaan tipe seluruh Hydra di Windows lulus. Pada [run pengisian cache 41226571051](https://github.com/krisnapy/hydra-auto-save/actions/runs/41226571051), instalasi/kompilasi dependensi memerlukan 524,89 detik; cache lolos pemuatan addon native/classic-level dengan Electron dan tersimpan sebelum run tersebut digantikan build sumber akhir. [Build akhir 41227437585](https://github.com/krisnapy/hydra-auto-save/actions/runs/41227437585) memulihkan cache pada runner baru dalam 21 detik dan memvalidasinya dalam sekitar 1 detik; instalasi serta kompilasi native dilewati. Ini perbandingan tahap dependensi, bukan waktu seluruh build. Build berhasil dari commit `3ec4623750631f67ee561f5882ef252fb79b1873`. Uji executable hasil instalasi/unpacked memverifikasi jendela utama benar-benar ditutup, proses tray tetap hidup, jendela dapat dibuka ulang, dan device ID/layanan backup tetap sama. Layanan IPC siap pada 3.225 ms, pengaturan terlihat pada 5.138 ms, dan IPC setelah pembukaan ulang siap pada 2.232 ms. Ini pengukuran pertama pada versi baru, bukan perbandingan startup dengan versi lama. Snapshot proses saat jendela terbuka berjumlah 7 dengan working set agregat 1.547.821.056 byte; setelah jendela ditutup ke tray berjumlah 4 dengan working set agregat 791.445.504 byte. Nilai tersebut menjelaskan perbedaan keadaan jendela/tray pada runner uji, bukan bukti penghematan RAM terhadap versi sebelumnya. Selama sampel idle dengan jeda 5 detik, penambahan waktu CPU proses yang tetap hidup sekitar 0,015625 detik; ini bukan jaminan pemakaian CPU nol. `Startup-installed.json` mencatat hasil terperinci. Pengukuran CI memakai profil/pustaka uji; hasilnya tidak menjamin pemakaian CPU/RAM atau waktu startup di PC pengguna.

[Verifikasi/publikasi 41228030414](https://github.com/krisnapy/hydra-auto-save/actions/runs/41228030414) berhasil membuka portable, memeriksa layanan backup/pengaturan dan checksum, lalu menerbitkan [rilis publik 0.1.3](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.1.3). Pada peluncuran portable pertama, IPC siap pada 20.502 ms dan pengaturan pada 22.645 ms; angka ini mencakup jalur peluncuran portable dan berbeda dari executable unpacked, sehingga angka 3,2 detik tidak berlaku untuk semua bentuk paket. Installer dan portable tersedia terpisah bersama panduan serta SHA256SUMS. Keempat aset lolos pemeriksaan unduh anonim dan ukuran; metadata digest diperiksa sebelum publikasi.

## Antrean dan progres operasi — 0.1.2

Laporan pengguna: permintaan terus mendapat pesan “Tunggu operasi backup atau pemulihan selesai”, tanpa indikator progres. Controller lama mengunci kontrol selama satu putaran pemeriksaan seluruh pustaka. Pada pustaka besar, permintaan pengguna sering ditolak. Refresh antarmuka setiap 10 detik juga dapat melewatkan operasi singkat.

Controller kini memasukkan permintaan ke antrean berurutan. Pemeriksaan otomatis menyelesaikan game aktif, lalu berhenti sebelum game berikutnya agar permintaan mendapat giliran. Kegagalan satu permintaan tidak merusak antrean berikutnya. Pengaturan baru hanya diterapkan setelah operasi aktif selesai.

Settings dan halaman game menampilkan operasi aktif/menunggu, tahap, waktu mulai/pembaruan, serta hasil terakhir per game. Progress bar menunjukkan jumlah file/lokasi pada tahap yang memiliki total; tahap lain memakai indikator tak tentu. Ini bukan persentase keseluruhan atau bukti unggahan cloud. Snapshot ringan setiap satu detik tidak memeriksa ulang semua blob riwayat; daftar riwayat diperbarui terpisah setiap 10 detik. Hasil backup terakhir dipertahankan ketika pemeriksaan otomatis berikutnya menemukan isi yang sama.

Sebanyak 38 pengujian lokal dan Windows lulus, termasuk antrean saat pemindaian otomatis aktif, prioritas permintaan sebelum game berikutnya, pemulihan antrean setelah kegagalan, snapshot ringan, progres backup/pemulihan, dan isi file setelah pemulihan. Pemeriksaan integrasi lokal serta pemeriksaan tipe seluruh Hydra di Windows lulus. [Build Windows 41222946095](https://github.com/krisnapy/hydra-auto-save/actions/runs/41222946095) berhasil dari commit `5472a7d46c009812e9509b788246fe66d87407b3`. [Verifikasi 41224208570](https://github.com/krisnapy/hydra-auto-save/actions/runs/41224208570) membuka aplikasi portable, memeriksa IPC/snapshot operasi, dan memastikan pengaturan menampilkan status tidak ada operasi aktif. [Rilis publik 0.1.2](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.1.2) menyediakan installer dan portable terpisah beserta panduan/checksum. Pengujian save game nyata, pustaka besar, dan cloud pengguna tetap diperlukan.

## Perbaikan deteksi Steam ID — 0.1.1

Uji Windows [41217704915](https://github.com/krisnapy/hydra-auto-save/actions/runs/41217704915), selesai 1 November 2026 WITA, mereproduksi timeout pencarian Steam ID pada Ludusavi 0.29.0 asli. `find` membaca nama tambahan dari stdin sampai EOF meskipun `--steam-id` sudah diberikan. Runner lama membiarkan stdin terbuka. Runner baru menutupnya segera, tanpa shell.

Uji yang sama memverifikasi pencarian Steam ID, judul persis, preview file save contoh, dan penanganan JSON error pada exit nonzero. Database terbaru mengenali `292030` sebagai The Witcher 3: Wild Hunt dan `3751260` sebagai The Blood of Dawnwalker; `1245629` tidak dikenali pada pemeriksaan tersebut. Pengguna kemudian mengoreksi salah ketik tersebut menjadi `1245620`; [uji lanjutan 41218017829](https://github.com/krisnapy/hydra-auto-save/actions/runs/41218017829) berhasil mengenalinya sebagai Elden Ring. Ini membuktikan pencocokan database, bukan lokasi save nyata di PC pengguna.

Paket 0.1.1 berhasil dibangun melalui [41217615393](https://github.com/krisnapy/hydra-auto-save/actions/runs/41217615393), lalu [41218865374](https://github.com/krisnapy/hydra-auto-save/actions/runs/41218865374) membuka aplikasi Windows, memeriksa checksum, dan menerbitkan [rilis publik 0.1.1](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.1.1). Keempat tautan asset berhasil diperiksa tanpa autentikasi.

Sebanyak 34 pengujian lokal dan Windows lulus. Error game tidak dikenal kini memberi petunjuk memperbarui database atau memilih lokasi save manual. Kegagalan proses dan timeout mendapat pesan yang berbeda.

## Paket Windows terverifikasi

- [Build Windows 41194991037](https://github.com/krisnapy/hydra-auto-save/actions/runs/41194991037) berhasil dari source commit `6f6125393c1f611cd8fc2256d0327a978b224141`.
- 31 pengujian modul lulus di Windows; pemeriksaan tipe seluruh Hydra dan bundling Electron berhasil. Installer NSIS dan portable x64 dibuat tanpa publikasi ke repository upstream.
- [Uji paket 41195867955](https://github.com/krisnapy/hydra-auto-save/actions/runs/41195867955) memeriksa checksum file unduhan, membuka portable di Windows, memanggil IPC snapshot, mendeteksi Ludusavi bawaan, dan membuka halaman Personal Cloud Backup. Screenshot dan log startup disertakan dalam artifact.
- [Paket terverifikasi](https://github.com/krisnapy/hydra-auto-save/actions/runs/41195867955/artifacts/13040881038) tersedia sampai 30 November 2026. Pengguna tidak perlu memasang Node.js. Build belum ditandatangani dengan sertifikat Windows.
- Pembaruan resmi otomatis dinonaktifkan; renderer menggunakan file lokal agar antarmuka backup tidak terganti. Profil/pustaka Hydra tetap memakai identitas produk yang sama; jalankan satu salinan saja dan pilih folder instalasi berbeda.
- Endpoint publik build disalin dari log release resmi Hydra v4.3.0 [41142471461](https://github.com/hydralauncher/hydra/actions/runs/41142471461); tidak ada kredensial cloud atau token pribadi dalam konfigurasi build.
- Temuan Windows: checkout CRLF harus dinormalisasi untuk pemeriksaan sumber, sedangkan cadangan sumber mempertahankan format aslinya. Metadata `.DS_Store` dikecualikan dari integrasi.

Catatan di bawah merekam hasil tahap awal sebelum build Windows. Verifikasi Windows di atas memperbarui status build/typecheck; pengujian game/cloud nyata dan pemasangan interaktif di PC pengguna masih diperlukan.

## Dasar integrasi yang diperiksa

Sumber Hydra dibaca melalui plugin GitHub dari tag `v4.3.0`, commit `5845549311a20d485d027da875307fc70897bfdc`:

- `src/main/index.ts`: awal/akhir masa aktif pemantauan.
- `src/main/services/process-watcher.ts`: kejadian game ditutup, sebelum pengembalian awal untuk game custom; pemicu ini dilewati saat shutdown.
- `src/main/helpers/launch-game.ts`: penguncian peluncuran selama pemulihan untuk game PC Steam/custom di Windows.
- `src/main/events/index.ts` dan `src/preload/index.ts`: pendaftaran operasi modul dan jembatan khusus `window.personalBackup`.
- Pengaturan desktop dan halaman detail game: komponen pengaturan/status/riwayat, terpisah dari Hydra Cloud/Nexus.
- `src/main/services/ludusavi.ts`: lokasi binary bawaan Hydra; konfigurasi modul tetap terpisah dari konfigurasi cloud Hydra.

Sumber rujukan: [Hydra 4.3.0](https://github.com/hydralauncher/hydra/tree/v4.3.0), [dokumentasi CLI Ludusavi](https://github.com/mtkennerly/ludusavi/blob/master/docs/cli.md), dan [schema keluaran Ludusavi](https://github.com/mtkennerly/ludusavi/blob/master/docs/schema/general-output.yaml).

## Keputusan implementasi sementara

Pilihan ini dibuat untuk prototipe dan belum merupakan validasi produk di Windows:

| Hal | Pilihan awal |
| --- | --- |
| Masa aktif | Selama proses Hydra berjalan; penutupan menunggu operasi berjalan selesai |
| Pemantauan | Poll 5 detik; masa stabil 1,2 detik; pemindaian lokasi otomatis tiap 60 detik |
| Deteksi | Ludusavi `find --api`, lalu `backup --preview --api --no-cloud-sync`; tidak menjalankan backup/pemulihan Ludusavi |
| Database | Unduh pada deteksi pertama bila cache belum ada; pembaruan berikutnya lewat tombol pengguna |
| Penyimpanan | Folder per perangkat/game/versi; metadata, blob SHA-256, dan penanda `COMPLETE` |
| Retensi | 10 versi normal per game per perangkat, dapat diubah; backup pengaman dipertahankan |
| Identitas perangkat | UUID dalam pengaturan lokal Hydra; jangan menyalin pengaturan perangkat ini ke PC lain |
| Pemulihan | Hanya versi perangkat ini, target dipetakan dari konfigurasi lokal, bukan path absolut dari metadata cloud |
| Pengamanan | Konfirmasi native, pemeriksaan proses, penguncian peluncuran Hydra, backup pengaman, staging dan rollback lintas lokasi |
| Game awal | Steam/custom dengan executable diketahui; pemulihan memerlukan `.exe` langsung |
| Pengaturan | `%APPDATA%`/lokasi `userData` Hydra di subfolder `personal-cloud-backup`; tidak ikut diunggah bersama backup |

Layout tujuan:

```text
<folder-cloud>/HydraPersonalBackup/<device-id>/<hash-game>/<version-id>/
  manifest.json
  COMPLETE
  data/<sha256>
```

Backup dikumpulkan di direktori `_pending-…`. Setelah sumber diperiksa lagi dan file tersalin diverifikasi, direktori dipublikasikan sebagai versi final. Klien cloud dapat mengirim file dengan urutan berbeda; karena itu penanda selesai saja tidak cukup: daftar versi juga memeriksa seluruh blob. Tidak ada status unggahan cloud.

Sebelum pemulihan, seluruh versi tujuan diverifikasi, backup pengaman dibuat, dan hasil pemulihan disiapkan di lokasi lokal di samping save. Setiap lokasi diganti dengan rename, dengan salinan sebelumnya dipertahankan sampai semua lokasi berhasil. Penggantian beberapa lokasi bukan satu transaksi filesystem atomik; rollback menangani kegagalan yang terdeteksi, sedangkan journal lokal memblokir operasi lanjutan setelah penghentian tak terduga.

## Hasil terverifikasi di lingkungan pengerjaan

- `npm test`: **28 pengujian lulus**, tanpa pengujian dilewati, pada Node.js 20 di macOS.
- Pengujian otomatis lokal terhadap backup, perubahan isi, save yang terus berubah, file rusak/hilang, retensi antarperangkat, backup pengaman, konfirmasi, rollback lintas lokasi, path tidak aman, slot save baru/hilang, dan penguncian operasi.
- Kontrak detektor diuji memakai runner tiruan, bukan binary Ludusavi sungguhan.
- Pemasang diterapkan pada fixture sumber asli Hydra 4.3.0. Sumber yang sudah diedit, pemasangan ulang, dan file tambahan yang sudah ada ditolak sebelum penulisan.
- Pemeriksaan sintaks file TypeScript yang dihubungkan, pemeriksaan tipe komponen React, dan bundle modul utama.
- Demo backup dan pemulihan berhasil memakai data contoh lokal di macOS.

## Verifikasi yang masih diperlukan

1. Build dan pemeriksaan tipe seluruh sumber Hydra pada Windows beserta komponen native.
2. Binary Ludusavi bawaan: versi/flag CLI, unduhan manifest pertama, pencocokan Steam ID, lokasi Windows yang dialihkan, dan game kustom.
3. Beberapa game nyata: satu file, banyak file, penambahan slot, file terkunci, dan save yang terus ditulis.
4. Pemulihan saat game ditutup/dibuka melalui Hydra maupun dari luar Hydra; uji proses turunan dan gangguan antivirus.
5. Folder cloud sungguhan pada kondisi online/offline, placeholder, konflik, pengiriman metadata lebih dahulu daripada blob, dan ruang habis.
6. Pengukuran waktu serta beban disk untuk pustaka besar sebelum menetapkan interval pemantauan dan batas ukuran.

Rancangan tidak dianggap memenuhi seluruh kriteria keberhasilan sebelum pengujian Windows dan game nyata tersebut selesai.
