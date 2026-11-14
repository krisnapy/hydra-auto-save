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
    name: `Hydra Personal Backup ${version} — Windows x64`, draft: true, prerelease: false,
    body: [
      'Versi uji awal berbasis Hydra Launcher 4.3.0.', '',
      `## Perubahan ${version}`,
      '- Unggahan baru OneDrive masuk folder nama game dan nama PC, dengan ID tetap untuk membedakan game/perangkat yang namanya sama.',
      '- Backup lama tetap ditemukan di lokasi semula; tidak dipindahkan atau dihapus otomatis. Data save lama yang masih dipakai versi baru tetap dipertahankan.',
      '- Daftar, unduhan, pemulihan dan optimisasi mendukung susunan lama serta folder baru. Pembersihan memakai lokasi terverifikasi dan ETag; file/folder ganda menghalangi pembersihan.',
      '- Pesan kegagalan unggahan kini menyebut nama dan ID game. Jika batas terlampaui, ukuran save serta jumlah file yang terdeteksi ditampilkan.',
      '- Batas unggahan tetap 32 MiB dan 10.000 file per versi sebelum kompresi. Periksa lokasi save jika folder yang terdeteksi terlalu luas.',
      '- Indeks .hpb dan data .hpd harus dipertahankan bersama. Folder baru memerlukan pembaca 0.3.4 atau lebih baru. Pemulihan lintas PC belum ditambahkan.',
      '- Deduplikasi per file, retensi cloud opsional dan optimisasi background dari 0.3.3 tetap tersedia. Rilis sebelumnya tidak dihapus.', '',
      '## Cara menggunakan',
      '- Pilih setup.exe untuk instalasi atau portable.exe untuk langsung mencoba. Tidak perlu keduanya, Node.js, atau login GitHub.',
      '- Tutup Hydra resmi dan Personal Backup lama. Pasang ke folder Personal Backup yang terpisah dari Hydra resmi. Profil lokal masih dibagi; jangan jalankan kedua salinan bersamaan.',
      '- Buka Settings → Personal Cloud Backup. Pilih folder sinkronisasi lokal dan aktifkan Auto Backup.',
      '- Optimisasi lokal tersedia di pengaturan atau menu ⋯ halaman game; optimisasi cloud pada panel OneDrive setelah terhubung.',
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
