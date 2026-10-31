const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const verifyPublicDownload = require('./verify-public-download.cjs');

module.exports = async ({ github, context, core }) => {
  const { owner, repo } = context.repo;
  const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const tag = `v${version}`;
  const lines = (await fs.readFile('package/SHA256SUMS.txt', 'utf8')).trim().split(/\r?\n/);
  const files = [];
  const kinds = new Set();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (Hydra-Personal-Backup-[\w.-]+-windows-x64-(setup|portable)\.exe)$/i.exec(line);
    if (!match || kinds.has(match[3])) throw new Error('Unexpected checksum entry');
    kinds.add(match[3]);
    files.push({name: match[2], file: path.join('package', match[2]), hash: match[1].toLowerCase()});
  }
  if (files.length !== 2 || !kinds.has('setup') || !kinds.has('portable')) throw new Error('Expected installer and portable');
  files.push({name: 'SHA256SUMS.txt', file: 'package/SHA256SUMS.txt'});
  files.push({name: 'Panduan-Windows.md', file: 'package/README.md'});
  const verifyPublicDownloads = async () => {
    const { data: release } = await github.rest.repos.getReleaseByTag({ owner, repo, tag });
    if (release.draft || release.assets.length !== files.length) throw new Error('Release incomplete');
    for (const file of files) {
      const data = await fs.readFile(file.file);
      const digest = createHash('sha256').update(data).digest('hex');
      const asset = release.assets.find(item => item.name === file.name);
      if (file.hash && file.hash !== digest) throw new Error(`Checksum mismatch: ${file.name}`);
      if (!asset || asset.state !== 'uploaded' || asset.size !== data.length || asset.digest !== `sha256:${digest}`) throw new Error(`Asset mismatch: ${file.name}`);
      await verifyPublicDownload(asset, { log: message => core.info(message) });
    }
  };
  try {
    const { data: existing } = await github.rest.repos.getReleaseByTag({owner, repo, tag});
    if (existing.draft) throw new Error('Inspect existing draft before publishing again');
    await verifyPublicDownloads();
    return;
  } catch (error) { if (error.status !== 404) throw error; }
  const build = context.payload.workflow_run;
  if (!build || build.conclusion !== 'success' || build.head_repository.full_name !== context.repo.owner + '/' + context.repo.repo) throw new Error('Expected successful trusted build');
  const { data: release } = await github.rest.repos.createRelease({
    owner, repo, tag_name: tag, target_commitish: context.sha,
    name: `Hydra Personal Backup ${version} — Windows x64`, draft: true, prerelease: true,
    body: [
      'Versi uji awal berbasis Hydra Launcher 4.3.0.', '',
      '## Panel backup ringkas 0.2.3',
      '- Lokasi save di kiri dan kartu backup di kanan; otomatis satu kolom pada jendela sempit.',
      '- Status, waktu backup terakhir, jumlah versi dan dua tindakan utama lebih mudah dibaca.',
      '- Pulihkan membuka riwayat; menu pilihan menampung pengaturan save. Konfirmasi dan backup pengaman tetap berlaku.',
      '', '## Perbaikan pemeriksaan backup 0.2.2',
      '- Save yang isinya sama dengan backup normal terakhir langsung dilewati setelah pembacaan awal, tanpa jeda kestabilan atau pembacaan sumber kedua.',
      '- Status jeda aman dipisahkan dari pembacaan ulang; jumlah file yang sudah diperiksa ditampilkan selama pemindaian.',
      '- Perubahan singkat mendapat maksimum tiga pemeriksaan kestabilan. Jika terus berubah, backup dihentikan dengan lokasi penyebab dan tidak dipublikasikan.',
      '- Percobaan otomatis yang terus sibuk memakai jeda 5, 10, 20, 40 hingga 60 detik per game; game lain tetap diproses. Backup manual dan setelah game ditutup dapat langsung dicoba.',
      '- Pemeriksaan integritas setelah penyalinan, backup pengaman sebelum restore, dan perlindungan riwayat tetap berlaku.',
      '', '## Perbaikan tampilan 0.2.1',
      '- Progres memakai jalur status di memori setiap 250 ms saat operasi berjalan, tanpa membaca riwayat, disk, atau daftar game.',
      '- Animasi bar lebih halus; pembaruan identik dilewati dan polling berhenti saat halaman tersembunyi.',
      '- Buka folder save membuka folder penyimpanan; beberapa file di folder yang sama dikelompokkan menjadi satu lokasi.',
      '', '## Fondasi backup 0.2.0',
      '- Memantau perubahan save, menggabungkan perubahan berdekatan, dan mempertahankan pemeriksaan berkala sebagai cadangan.',
      '- Save yang masih ditulis menunggu stabil dan dicoba ulang tanpa menandai kegagalan otomatis.',
      '- Peringatan ruang backup kurang dari 1 GB dan pemeriksaan ruang sebelum penyalinan.',
      '- Pemulihan terputus memblokir backup baru. Catatan baru mendukung penanganan terpandu dengan konfirmasi, verifikasi isi, dan penyimpanan file pengaman; catatan lama/rusak memerlukan pemeriksaan manual.',
      '- Panduan pengaturan awal: pilih tujuan, tentukan save game, buat backup percobaan, lalu aktifkan Auto Backup.',
      '- Format backup lama tetap dapat digunakan. OAuth dan sinkronisasi achievement belum termasuk versi ini.',
      '', '## Cache riwayat 0.1.5 yang disertakan',
      '- Cache hasil pemeriksaan isi backup menghindari pembacaan ulang file yang identitas, ukuran, dan waktu perubahannya tetap sama.',
      '- Cache hanya berada di memori dan dibatasi 8192 file; metadata dan keberadaan file tetap diperiksa.',
      '- Pemulihan selalu memeriksa ulang isi versi terpilih. Backup baru diperiksa penuh sebelum retensi menghapus versi lama.',
      '- Permintaan riwayat bersamaan berbagi pemeriksaan file yang sama. Format backup dan dukungan versi lama tetap dipertahankan.',
      '', '## Akses lokasi 0.1.4 yang disertakan',
      '- Tombol Buka folder save membuka folder penyimpanan di File Explorer, dengan lokasi file dalam satu folder dikelompokkan.',
      '- Tombol Buka lokasi backup membuka folder backup game/perangkat ini; Settings membuka folder tujuan utama.',
      '- Lokasi yang hilang dan kegagalan membuka Explorer menampilkan alasan yang jelas. Membuka folder tidak menunggu antrean backup.',
      '', '## Perbaikan performa 0.1.3 yang disertakan',
      '- Cache dependensi/native terikat sumber Hydra dan lockfile; cache diverifikasi dengan runtime Electron sebelum dipakai.',
      '- Pembaruan profil melalui internet dan integrasi Epic tidak lagi menahan pembukaan jendela.',
      '- Menu tray langsung memakai cache, menampilkan akses pengaturan/status backup, dan membuka kembali jendela yang diminimalkan.',
      '- Pemeriksaan cadangan tiap 60 detik ketika pemantauan sehat; jika pemantauan tidak tersedia, pemeriksaan tetap 5 detik saat aktif atau 30 detik saat tray idle. Backup manual dan game ditutup langsung masuk antrean.',
      '- Pengaturan identik tidak ditulis ulang; polling antarmuka berhenti ketika halaman tersembunyi.',
      '', '## Perbaikan backup 0.1.2 yang disertakan',
      '- Permintaan pengaturan, deteksi, backup manual, dan pemulihan kini menunggu giliran setelah operasi aktif selesai, lalu mendapat prioritas sebelum pemindaian game berikutnya.',
      '- Menampilkan progress bar, tahap operasi, jumlah file pada tahap penyalinan/pemulihan, dan waktu pembaruan tahap di Settings serta halaman game.',
      '- Menampilkan hasil operasi terakhir, termasuk kegagalan dan save yang tidak berubah.',
      '- Pembaruan progres memakai status di memori, terpisah dari pembaruan riwayat.',
      '- Perbaikan deteksi Steam ID dari 0.1.1 tetap disertakan.', '',
      '## Cara menggunakan',
      '- Pilih setup.exe untuk instalasi atau portable.exe untuk langsung mencoba. Tidak perlu keduanya, Node.js, atau login GitHub.',
      '- Tutup Hydra resmi dan Personal Backup lama. Pasang ke folder Personal Backup yang terpisah dari Hydra resmi. Profil lokal masih dibagi; jangan jalankan kedua salinan bersamaan.',
      '- Buka Settings → Personal Cloud Backup. Pilih folder sinkronisasi lokal dan aktifkan Auto Backup.',
      '- Setelah memperbarui, perbarui database lokasi save dan ulangi deteksi game.',
      '- Jika game tidak dikenali, gunakan Pilih folder save atau Pilih file save.', '',
      'Aplikasi belum ditandatangani secara digital. Pengujian memakai save contoh; game nyata dan sinkronisasi cloud nyata belum terverifikasi. Backup lokal selesai tidak membuktikan unggahan cloud selesai.', '',
      `Sumber executable: commit \`${build.head_sha}\`; [build Windows](${build.html_url}). Tag menunjuk commit publikasi.`,
      `Checksum SHA-256, startup aplikasi, serta pengaturan backup diperiksa sebelum publikasi melalui [verifikasi](https://github.com/${owner}/${repo}/actions/runs/${context.runId}).`,
      'Panduan dan checksum tersedia bersama kedua executable di bawah.'
    ].join('\n')
  });
  for (const file of files) {
    const data = await fs.readFile(file.file);
    const digest = createHash('sha256').update(data).digest('hex');
    if (file.hash && file.hash !== digest) throw new Error(`Checksum mismatch: ${file.name}`);
    const { data: asset } = await github.rest.repos.uploadReleaseAsset({
      owner, repo, release_id: release.id, name: file.name, data,
      headers: { 'content-type': file.name.endsWith('.exe') ? 'application/octet-stream' : 'text/plain', 'content-length': data.length }
    });
    if (asset.state !== 'uploaded' || asset.size !== data.length || (asset.digest && asset.digest !== `sha256:${digest}`)) throw new Error(`Upload mismatch: ${file.name}`);
    core.info(`Uploaded ${file.name}: sha256:${digest}`);
  }
  await github.rest.repos.updateRelease({ owner, repo, release_id: release.id, draft: false });
  await verifyPublicDownloads();
};
