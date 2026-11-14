# Efisiensi background — pengembangan lokal

Status: belum dirilis sebagai installer. Perubahan ini berlaku untuk modul Personal Cloud Backup; proses lain milik Hydra/Electron tetap dapat berjalan.

- **Tray idle:** pemeriksaan pustaka dan fallback dijadwalkan 30 detik setelah pemeriksaan sebelumnya selesai, dibanding heartbeat tetap 5 detik. Saat game terdeteksi berjalan atau jendela berada di depan, interval normal 5 detik dipakai. Tidak ada pemeriksaan yang bertumpuk.
- **Perubahan save:** watcher tetap aktif di tray. Event save membangunkan pemeriksaan setelah debounce sekitar 1,5 detik; tidak menunggu heartbeat 30 detik. Pemeriksaan kestabilan dan integritas tetap berlaku. Fallback berkala tetap tersedia bila event tidak diterima atau watcher bermasalah. Jalur backup setelah game ditutup tidak diubah.
- **OneDrive:** tidak ada timer antrean saat kosong. Antrean baru memasang timer; kegagalan menjadwalkan percobaan berdasarkan deadline retry yang sudah tersimpan. Login mengikuti interval polling dan masa berlaku kode. Hanya antrean akun aktif yang membangunkan unggahan. Timer dilepas saat putus koneksi atau aplikasi berhenti.
- **UI:** panel riwayat dan OneDrive membatalkan timer saat halaman tersembunyi. Respons yang masih berjalan tidak boleh memasang ulang timer tersembunyi. Saat jendela terlihat lagi, status diperbarui dan polling dilanjutkan. Pembaruan progres yang sudah berhenti saat tersembunyi tetap dipertahankan.

Pengujian dengan jam virtual memeriksa tidak adanya polling saat idle/tersembunyi, bangun saat diperlukan, deadline retry, interval tray, dan pembersihan timer. Pengujian watcher serta pemulihan yang sudah ada tetap dijalankan. Ini membuktikan perilaku penjadwalan, bukan persentase penghematan CPU/RAM/baterai. Pengukuran nyata lewat Task Manager saat tray idle, bermain, backup dan unggah di Windows masih diperlukan.
