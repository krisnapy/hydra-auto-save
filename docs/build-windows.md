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
