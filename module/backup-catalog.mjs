import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safePath } from './engine.mjs';

const line = value => String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').trim();

async function writeText(file, text) {
  await safePath(file);
  try { if (await fs.readFile(file, 'utf8') === text) return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, text, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

// Descriptive sidecars only. Restore continues to trust verified manifests,
// never this editable catalog. Device-specific indexes avoid cross-PC clashes.
export async function writeBackupCatalog(engine, games) {
  const rows = [];
  for (const game of games) {
    const folder = engine.directory(game.id);
    await safePath(folder);
    try { if (!(await fs.lstat(folder)).isDirectory()) continue; }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const title = line(game.title) || line(game.id);
    const relative = path.relative(engine.destination, folder);
    const text = [
      'HYDRA PERSONAL BACKUP - INFORMASI GAME', '',
      `Nama game: ${title}`, `ID game: ${line(game.id)}`,
      `ID perangkat: ${engine.deviceId}`, `Folder backup: ${relative}`, '',
      'Lokasi save yang dikonfigurasi:',
      ...(game.roots ?? []).map(root => `- ${line(root.path)}`), '',
      'Subfolder waktu-ID berisi versi backup. manifest.json mencatat tanggal dan daftar file.',
      'Nama panjang adalah pengenal internal untuk memisahkan game/perangkat dan memeriksa integritas.',
      'Pulihkan melalui Hydra: Personal Cloud > Pulihkan > pilih versi.',
      'Berkas informasi ini bukan save game dan tidak digunakan untuk memulihkan data.',
      'Jangan mengganti nama folder, manifest.json, COMPLETE, atau file di dalam data.', '',
    ].join('\r\n');
    await writeText(path.join(folder, '_INFO GAME.txt'), text);
    rows.push({ title, id: line(game.id), relative });
  }
  if (!rows.length) return;
  rows.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const index = [
    'HYDRA PERSONAL BACKUP - DAFTAR GAME', '',
    `Perangkat: ${engine.deviceId}`,
    'Lokasi folder di bawah dihitung dari folder tempat berkas daftar ini berada.',
    'Setiap folder game juga berisi _INFO GAME.txt.', '',
    ...rows.flatMap(row => [row.title, `  ID game: ${row.id}`, `  Folder: ${row.relative}`, '']),
    'Daftar ini hanya keterangan. Pulihkan save melalui Hydra.', '',
  ].join('\r\n');
  await writeText(path.join(engine.destination, `DAFTAR GAME - ${engine.deviceId}.txt`), index);
}
