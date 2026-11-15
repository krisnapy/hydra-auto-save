# Build Windows cepat dan installer

**Windows quick check** berjalan setiap perubahan kode di `main`. Jalur ini memakai cache dependensi yang sama, menjalankan tes modul/integrasi dan deteksi Ludusavi, lalu pemeriksaan tipe bersamaan dengan kompilasi. Setelah keduanya lulus, aplikasi dikemas sebagai folder `win-unpacked` dan diuji startup serta tray. Tidak dibuat installer/portable maupun ZIP aplikasi besar. Artifact `Windows-quick-build-report` memuat waktu tiap tahap, audit isi paket, dan hasil startup.

**Windows installer** menghasilkan kedua executable lengkap. Jalankan dari Actions → Windows installer → Run workflow → branch `main`. Perubahan konfigurasi workflow/pengemasan juga memicunya otomatis. Perubahan kode aplikasi biasa cukup melalui jalur cepat; buat installer manual ketika versi itu akan dibagikan. Jalur ini tetap melewati semua pemeriksaan, kemudian memicu **Verify Windows package** dan pengujian halaman game Windows seperti sebelumnya. Artifact unduhan terpisah tersedia setelah verifikasi berhasil.

Kedua jalur memakai `.github/workflows/windows-build.yml`, sumber Hydra dan cache yang dipatok, serta Secret OneDrive yang sama. Pemeriksaan tipe gagal atau kompilasi gagal menghentikan pengemasan. Cache baru tetap diuji dari runner terpisah. Pengujian cepat tidak berarti installer versi tersebut sudah tersedia.

## Membandingkan kompresi

Pada Run workflow installer, `normal` adalah bawaan distribusi yang sama dengan bawaan electron-builder sebelumnya. `store` tersedia sebagai percobaan kompresi ringan: hasil unduhan dapat lebih besar. Bandingkan `build-timings.json`, ukuran executable dan durasi keseluruhan pada sumber yang sama sebelum mengubah bawaan. Waktu runner bisa berbeda, jadi satu hasil bukan jaminan peningkatan tetap. Pemilihan ini tidak mengubah kompresi backup save.

`package-audit.json` mencatat ukuran aplikasi di disk, file terbesar, serta ukuran logis grup di `app.asar`. Rekaman ASAR yang diekstrak juga dilaporkan sebagai entri logis; jangan menjumlahkannya lagi ke ukuran disk. Gunakan laporan ini untuk menentukan pengecualian berikutnya tanpa menghapus dependensi runtime secara spekulatif. Hook pemeriksaan Legendary upstream dipertahankan.

## Acuan sebelum perubahan

[Build 41247200550](https://github.com/krisnapy/hydra-auto-save/actions/runs/41247200550): job sekitar 10 menit 20 detik; cache dependensi 29 detik, typecheck 67 detik, kompilasi sekitar 70 detik, pengemasan sekitar 5 menit 30 detik. Jalur cepat menghilangkan pembuatan installer, tetapi tetap menyiapkan folder aplikasi dan menjalankan pemeriksaan. Angka percepatan harus diambil dari run baru, bukan dianggap sebagai hasil hanya dari perubahan konfigurasi.

## Hasil terverifikasi — 1 November 2026 WITA

Sumber akhir: [22a8d4a](https://github.com/krisnapy/hydra-auto-save/commit/22a8d4a95640c8b3e5a21747a664320a21f5f083).

| Jalur | Durasi job Windows | Hasil |
|---|---:|---|
| Acuan installer lama | 10 menit 20 detik | Lulus |
| [Quick terakhir](https://github.com/krisnapy/hydra-auto-save/actions/runs/41250093763) | 6 menit 21 detik | Lulus |
| [Installer terakhir](https://github.com/krisnapy/hydra-auto-save/actions/runs/41250093857) | 7 menit 56 detik | Lulus |

Ini pengukuran job pada runner berbeda, tanpa waktu antrean dan tanpa menambahkan durasi workflow verifikasi portable/visual sesudahnya. Jalur quick menguji folder aplikasi tanpa menghasilkan installer, jadi hasilnya bukan waktu membuat distribusi lengkap. Bukan jaminan durasi setiap run atau pembuktian kontribusi masing-masing perubahan secara terisolasi. Sebelum pengecualian berkas terakhir, run baru juga lulus: quick 6 menit 57 detik dan installer 9 menit 22 detik; variasi runner nyata terlihat.

80 tes modul/build lokal dan Windows lulus, pemeriksaan integrasi dan tipe Hydra lulus, serta startup unpacked, Ludusavi dan tutup/buka ulang tray lulus di kedua jalur. Audit mendapati `node_modules/classic-level/build/Release/leveldb.lib` berukuran39.286.398 byte (37,5 MiB), berupa masukan static linker yang sudah dikompilasi ke addon. Berkas ini dikecualikan tanpa menghapus addon `.node`. Audit akhir membuktikan jumlah entri ASAR berkurang satu, folder aplikasi quick turun dari 801,5 MiB menjadi 764,0 MiB, dan aplikasi tetap berjalan. Ukuran di disk berbeda dari ukuran installer terkompresi.

Kompresi bawaan tetap `normal`. Pilihan `store` sudah tersedia untuk percobaan manual; perbandingan kecepatan/ukuran installer `store` belum dijalankan. Bun dan runtime pengguna tidak diubah. Percobaan awal audit gagal karena pemisah jalur Windows; pembacaan metadata diperbaiki dan kedua jalur final lulus.

[Verifikasi checksum dan portable](https://github.com/krisnapy/hydra-auto-save/actions/runs/41250646812) serta [28 tes UI dan halaman game Windows](https://github.com/krisnapy/hydra-auto-save/actions/runs/41250646772) juga lulus pada sumber akhir. Artifact installer terpisah sekitar 205,9 MB dan portable 205,7 MB (ukuran ZIP artifact, bukan ukuran folder aplikasi). Repo tetap privat dan publikasi rilis publik dilewati. Tautan unduhan terverifikasi terbaru ada di README.


## Rilis 0.3.3 — 15 November 2026 WITA

Sumber executable: `5965683fdbb17558fe92f26b285ea4b90037fed2`. [Build installer](https://github.com/krisnapy/hydra-auto-save/actions/runs/43616693585), [quick check](https://github.com/krisnapy/hydra-auto-save/actions/runs/43616693506), [verifikasi portable/checksum dan unduhan anonim](https://github.com/krisnapy/hydra-auto-save/actions/runs/43617227568), serta [36 tes tampilan dan halaman game Windows](https://github.com/krisnapy/hydra-auto-save/actions/runs/43617227545) lulus. Sebanyak 118 tes modul dan pemeriksaan tipe seluruh Hydra lulus pada build Windows. Instalasi interaktif pengguna, OneDrive nyata, dan save game nyata belum diuji.

[Rilis publik 0.3.3](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.3.3) berstatus reguler dan menjadi Latest, dengan setup 207.905.884 byte, portable 207.669.834 byte, panduan, dan checksum. Rilis sebelumnya dipertahankan.


## Rilis 0.3.4 — 15 November 2026 WITA

Sumber executable: `03b6a159c971cfcf83f1b792cad053dfb63da30d`. [Build installer](https://github.com/krisnapy/hydra-auto-save/actions/runs/43623323794), [quick check](https://github.com/krisnapy/hydra-auto-save/actions/runs/43623323786), [verifikasi portable/checksum dan unduhan anonim](https://github.com/krisnapy/hydra-auto-save/actions/runs/43623886231), serta [36 tes tampilan dan halaman game Windows](https://github.com/krisnapy/hydra-auto-save/actions/runs/43623886282) lulus. Sebanyak 126 tes modul dan pemeriksaan tipe seluruh Hydra lulus pada build Windows.

[Rilis publik 0.3.4](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.3.4) berstatus reguler dan menjadi Latest saat diverifikasi, dengan setup 207.908.483 byte, portable 207.672.416 byte, panduan, dan checksum. Rilis sebelumnya dipertahankan. Folder baru per game/perangkat diuji memakai simulasi Graph, termasuk pemulihan dan retensi campuran data lama/baru. Instalasi interaktif pengguna, akun OneDrive nyata, dan save game nyata belum diuji.


## Rilis 0.3.5 — 15 November 2026 WITA

Sumber executable: `6e0748f0c57fe217eff5ac48a7161702461c62c3`. [Build installer](https://github.com/krisnapy/hydra-auto-save/actions/runs/43625707713), [quick check](https://github.com/krisnapy/hydra-auto-save/actions/runs/43625707767), [verifikasi portable/checksum dan unduhan anonim](https://github.com/krisnapy/hydra-auto-save/actions/runs/43626345678), serta [tampilan dan halaman game Windows](https://github.com/krisnapy/hydra-auto-save/actions/runs/43626345849) lulus. 128 tes modul, pemeriksaan tipe dan kompilasi Hydra lulus. Rilis [0.3.5](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.3.5) menjadi Latest saat diverifikasi; setup 207.906.124 byte, portable 207.670.097 byte, panduan dan checksum tersedia. Setup SHA256: `3d5809070c682d21f48f2fa2d55cdb4ac4e91114d805c6f256b252923c3d94c7`.

Batas isi save menjadi 128 MiB dan paket/pembacaan menjadi 192 MiB. Regresi mencakup unggah, unduh dan pemulihan 77 file acak total 67,82 MiB pada penyedia simulasi serta impor/pemulihan format legacy besar. Save game pengguna dan akun OneDrive nyata belum diuji. Setelah memperbarui, pilih **Unggah backup terbaru / coba lagi** untuk mengantrekan versi lokal yang dulu ditolak. Backup di atas 32 MiB memerlukan pembaca 0.3.5+.

## Rilis 0.3.6 — 15 November 2026 WITA

Sumber executable: `04993095b004f6d45b2d240cb0080e5e1d8a0d1d`. [Build installer](https://github.com/krisnapy/hydra-auto-save/actions/runs/43684662144), [quick check](https://github.com/krisnapy/hydra-auto-save/actions/runs/43684662086), [verifikasi portable/checksum dan unduhan anonim](https://github.com/krisnapy/hydra-auto-save/actions/runs/43685209396), serta [tampilan dan halaman game Windows](https://github.com/krisnapy/hydra-auto-save/actions/runs/43685209363) lulus. Sebanyak 132 tes modul, pemeriksaan tipe dan kompilasi Hydra lulus. [Rilis 0.3.6](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.3.6) reguler/Latest saat diverifikasi; setup 207.908.308 byte, portable 207.672.271 byte, panduan dan checksum tersedia. Setup SHA256: `d95401aeb77fc1cdf8f0a9cf4525d3d9d2128fff81d231df8fd7052d1bfbe25c`.

Menambahkan kode Graph yang dikenali dan tahap operasi pada pesan gagal, dengan pembacaan badan error dibatasi 16 KiB dan tanpa menampilkan pesan mentah/token/URL privat. Respons 400 pada pembacaan dengan proyeksi opsional dicoba sekali tanpa proyeksi; tidak mengulang operasi tulis atau mengubah pagination. Regresi menguji fallback berhasil, 404 lanjutan, kegagalan akhir, status/Retry-After, non-JSON/error terlalu besar, kode tidak dikenal, dan tidak ada replay operasi tulis/pagination/403/429. Penyebab respons 400 saat unggah pada akun pengguna versi 0.3.5 belum terkonfirmasi; ini bukan klaim bahwa semua kasus 400 terselesaikan. Pengujian akun OneDrive nyata belum dilakukan. Antrean tetap dipertahankan; pengguna diminta mencoba unggah lagi dan melaporkan diagnostik baru jika gagal.


## Rilis 0.3.7 — 15 November 2026 WITA

Sumber executable: `9b751e316ca860a3f6598f11c807f69a6feba990`. [Build installer](https://github.com/krisnapy/hydra-auto-save/actions/runs/43692171675), [quick check](https://github.com/krisnapy/hydra-auto-save/actions/runs/43692171653), [verifikasi portable/checksum dan unduhan anonim](https://github.com/krisnapy/hydra-auto-save/actions/runs/43692721083), serta [tampilan dan halaman game Windows](https://github.com/krisnapy/hydra-auto-save/actions/runs/43692721127) lulus. Sebanyak 135 tes modul, pemeriksaan tipe dan kompilasi Hydra lulus. [Rilis 0.3.7](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.3.7) reguler/Latest saat diverifikasi; setup 207.908.898 byte, portable 207.672.799 byte, panduan dan checksum tersedia. Setup SHA256: `db84a208df4559a4ea7077be64fa85e4370141de9fb5d73985279e025662dfce`.

Pengguna melaporkan diagnostik `400 invalidRequest; membuat folder` setelah 0.3.6. Pembuatan folder diperbarui: AppFolder diambil ID-nya, POST dilakukan pada endpoint parent-item/children, dan conflictBehavior=fail dikirim melalui parameter URL. Body hanya name/folder. Cache ID mengikuti pergantian akun/putus koneksi. Regresi mensimulasikan penolakan alias lama, memeriksa request baru, menolak metadata ID/akun yang tidak sesuai, serta membuktikan antrean/backup lokal tetap utuh pada 400 dan pekerjaan yang sama berhasil setelah retry. Konflik409 dan backup campuran lama/baru tetap diuji. Ini bukan verifikasi pada akun OneDrive pengguna; setelah update, coba unggah kembali dan periksa hasilnya tanpa menghapus atau memindahkan backup/folder lama.


## Rilis 0.3.8 — 15 November 2026 WITA

Sumber executable: `1365510346696f650d0c7b5b32826c24add91db3`. [Build installer](https://github.com/krisnapy/hydra-auto-save/actions/runs/43712106460), [quick check](https://github.com/krisnapy/hydra-auto-save/actions/runs/43712106491), [verifikasi portable/checksum dan unduhan anonim](https://github.com/krisnapy/hydra-auto-save/actions/runs/43712548948), serta [tampilan dan halaman game Windows](https://github.com/krisnapy/hydra-auto-save/actions/runs/43712548950) lulus. Sebanyak 142 tes modul, pemeriksaan tipe dan kompilasi Hydra lulus. [Rilis 0.3.8](https://github.com/krisnapy/hydra-auto-save/releases/tag/v0.3.8) reguler/Latest saat diverifikasi; setup 207.911.775 byte, portable 207.675.719 byte, panduan dan checksum tersedia. Setup SHA256: `481f59ee4246f805b36b92682f1932414b9ac40d9ec5eca7c6876be0b6404730`.

Pengguna melaporkan alamat unduhan OneDrive tidak dikenali, tetapi domain tidak terlihat. Kode lama menolak my.microsoftpersonalcontent.com; 0.3.8 mendukung host tersebut dan domain penyimpanan sebelumnya. Pengalihan manual dibatasi tiga kali dan setiap tujuan diperiksa (HTTPS, domain, port/kredensial URL), tanpa bearer token/cookie. Pesan penolakan menampilkan hostname aman saja, tanpa path/query/tanda tangan. Ukuran/hash tetap diperiksa. Tujuh regresi baru mencakup host tambahan, rantai relatif/lintas host yang didukung, domain palsu/lokal, tujuan berbahaya/hilang, loop/batas pengalihan, respons terpotong/berlebih/gagal dan fallback Graph content. Ini uji simulasi; host akun pengguna dan keberhasilan unggahan/pemulihan nyata belum dikonfirmasi. Setelah memasang, tekan Unggah backup terbaru / coba lagi tanpa menghapus antrean/backup.

Acuan alur pengalihan dan unduhan tanpa Authorization: [Microsoft Graph download content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).
