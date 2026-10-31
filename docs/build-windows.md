# Build Windows cepat dan installer

**Windows quick check** berjalan setiap perubahan kode di `main`. Jalur ini memakai cache dependensi yang sama, menjalankan tes modul/integrasi dan deteksi Ludusavi, lalu pemeriksaan tipe bersamaan dengan kompilasi. Setelah keduanya lulus, aplikasi dikemas sebagai folder `win-unpacked` dan diuji startup serta tray. Tidak dibuat installer/portable maupun ZIP aplikasi besar. Artifact `Windows-quick-build-report` memuat waktu tiap tahap, audit isi paket, dan hasil startup.

**Windows installer** menghasilkan kedua executable lengkap. Jalankan dari Actions → Windows installer → Run workflow → branch `main`. Perubahan konfigurasi workflow/pengemasan juga memicunya otomatis. Perubahan kode aplikasi biasa cukup melalui jalur cepat; buat installer manual ketika versi itu akan dibagikan. Jalur ini tetap melewati semua pemeriksaan, kemudian memicu **Verify Windows package** dan pengujian halaman game Windows seperti sebelumnya. Artifact unduhan terpisah tersedia setelah verifikasi berhasil.

Kedua jalur memakai `.github/workflows/windows-build.yml`, sumber Hydra dan cache yang dipatok, serta Secret OneDrive yang sama. Pemeriksaan tipe gagal atau kompilasi gagal menghentikan pengemasan. Cache baru tetap diuji dari runner terpisah. Pengujian cepat tidak berarti installer versi tersebut sudah tersedia.

## Membandingkan kompresi

Pada Run workflow installer, `normal` adalah bawaan distribusi yang sama dengan bawaan electron-builder sebelumnya. `store` tersedia sebagai percobaan kompresi ringan: hasil unduhan dapat lebih besar. Bandingkan `build-timings.json`, ukuran executable dan durasi keseluruhan pada sumber yang sama sebelum mengubah bawaan. Waktu runner bisa berbeda, jadi satu hasil bukan jaminan peningkatan tetap. Pemilihan ini tidak mengubah kompresi backup save.

`package-audit.json` mencatat ukuran aplikasi di disk, file terbesar, serta ukuran logis grup di `app.asar`. Rekaman ASAR yang diekstrak juga dilaporkan sebagai entri logis; jangan menjumlahkannya lagi ke ukuran disk. Gunakan laporan ini untuk menentukan pengecualian berikutnya tanpa menghapus dependensi runtime secara spekulatif. Hook pemeriksaan Legendary upstream dipertahankan.

## Acuan sebelum perubahan

[Build 41247200550](https://github.com/krisnapy/hydra-auto-save/actions/runs/41247200550): job sekitar 10 menit 20 detik; cache dependensi 29 detik, typecheck 67 detik, kompilasi sekitar 70 detik, pengemasan sekitar 5 menit 30 detik. Jalur cepat menghilangkan pembuatan installer, tetapi tetap menyiapkan folder aplikasi dan menjalankan pemeriksaan. Angka percepatan harus diambil dari run baru, bukan dianggap sebagai hasil hanya dari perubahan konfigurasi.
