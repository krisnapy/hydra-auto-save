import * as fs from 'node:fs/promises';
import path from 'node:path';
import { digest, safePath, storeBackupBlob } from './engine.mjs';

async function dataBytes(engine, gameId, version) {
  let bytes = 0;
  for (const entry of new Map(version.files.map(file => [file.hash, file])).values()) {
    const file = path.join(engine.directory(gameId), version.id, 'data', entry.hash);
    await safePath(file);
    bytes += (await fs.stat(file)).size;
  }
  return bytes;
}

export async function localPlan(engine, gameIds, progress = () => {}) {
  const games = [];
  for (const [index, gameId] of gameIds.entries()) {
    progress('optimization-inspecting', index, gameIds.length);
    await engine.assertNoRecovery(gameId);
    await engine.repairOptimizations(gameId);
    const versions = await engine.versions(gameId, { fresh: true });
    const remove = versions.filter(v => !v.safety).slice(engine.retention).map(v => v.id);
    const keep = versions.filter(v => !remove.includes(v.id));
    const compress = keep.filter(v => v.storage !== 'adaptive-gzip-v1' && v.files.some(f => f.bytes >= 4096)).map(v => v.id);
    const sizes = await Promise.all(versions.map(async v => [v.id, await dataBytes(engine, gameId, v)]));
    games.push({ gameId, versions, remove, compress, sizes });
    progress('optimization-inspecting', index + 1, gameIds.length);
  }
  const token = digest(JSON.stringify({ retention: engine.retention, games }));
  return { token, retention: engine.retention, games, compress: games.reduce((n, g) => n + g.compress.length, 0), remove: games.reduce((n, g) => n + g.remove.length, 0), removableBytes: games.reduce((n, g) => n + g.sizes.filter(([id]) => g.remove.includes(id)).reduce((s, [, bytes]) => s + bytes, 0), 0) };
}

async function compressVersion(engine, gameId, version) {
  const directory = engine.directory(gameId);
  const target = path.join(directory, version.id);
  const stage = path.join(directory, `_opt-stage-${version.id}`);
  const original = path.join(directory, `_opt-old-${version.id}`);
  for (const file of [target, stage, original]) await safePath(file);
  await engine.requireSpace(engine.destination, [...new Map(version.files.map(f => [f.hash, f])).values()].reduce((n, f) => n + f.bytes, 0));
  // Reserved staging names can remain from a crash before the original moved.
  await fs.rm(stage, { recursive: true, force: true });
  const before = await dataBytes(engine, gameId, version);
  let moved = false;
  try {
    await fs.mkdir(path.join(stage, 'data'), { recursive: true });
    const compressed = [];
    for (const entry of new Map(version.files.map(f => [f.hash, f])).values()) {
      const source = path.join(target, 'data', entry.hash);
      const destination = path.join(stage, 'data', entry.hash);
      const zipped = await storeBackupBlob(source, destination, entry, version.compressed?.includes(entry.hash));
      await engine.verifyHistoryBlob(destination, entry, true, zipped);
      if (zipped) compressed.push(entry.hash);
    }
    const replacement = { ...version, schema: compressed.length ? 2 : 1, storage: 'adaptive-gzip-v1' };
    if (compressed.length) replacement.compressed = compressed;
    else delete replacement.compressed;
    const metadata = JSON.stringify(replacement, null, 2);
    await fs.writeFile(path.join(stage, 'manifest.json'), metadata, { flag: 'wx' });
    await fs.writeFile(path.join(stage, 'COMPLETE'), digest(metadata), { flag: 'wx' });
    // Directory swap is recoverable at either rename boundary. Never modify
    // the only copy in place or delete the original before fresh verification.
    await fs.rename(target, original); moved = true;
    await fs.rename(stage, target);
    const verified = (await engine.versions(gameId, { fresh: true, versionId: version.id }))[0];
    if (!verified) throw new Error('Hasil kompresi gagal pemeriksaan. Backup asli dipertahankan.');
    const after = await dataBytes(engine, gameId, verified);
    await engine.repairOptimizations(gameId);
    return Math.max(0, before - after);
  } finally {
    if (moved) await engine.repairOptimizations(gameId);
    await fs.rm(stage, { recursive: true, force: true });
  }
}

export async function optimizeLocal(engine, gameIds, token, progress = () => {}) {
  const plan = await localPlan(engine, gameIds, progress);
  if (plan.token !== token) throw new Error('Riwayat backup berubah sejak diperiksa. Tekan optimalkan lagi untuk melihat ringkasan terbaru.');
  let compressed = 0, removed = 0, savedBytes = 0, completed = 0;
  const total = plan.compress + plan.remove;
  for (const game of plan.games) {
    await engine.exclusive(game.gameId, async () => {
      for (const id of game.compress) {
        progress('optimization-compressing', completed, total);
        const version = game.versions.find(v => v.id === id);
        savedBytes += await compressVersion(engine, game.gameId, version);
        compressed++; completed++;
      }
      // Re-evaluate fresh integrity after compression before pruning anything.
      const old = new Set((await engine.versions(game.gameId, { fresh: true })).filter(v => !v.safety).slice(engine.retention).map(v => v.id));
      for (const id of game.remove) {
        progress('optimization-cleaning', completed, total);
        if (!old.has(id)) throw new Error('Riwayat berubah saat optimisasi. Versi yang tersisa dipertahankan.');
        const target = path.join(engine.directory(game.gameId), id);
        await safePath(target);
        await fs.rm(target, { recursive: true });
        savedBytes += game.sizes.find(([version]) => version === id)[1];
        removed++; completed++;
      }
    });
  }
  progress('optimization-cleaning', completed, total);
  return { compressed, removed, savedBytes, detail: `Optimisasi lokal selesai: ${compressed} versi diproses, ${removed} versi lama dihapus, ${(savedBytes / 1024 ** 2).toFixed(2)} MiB data dihemat.` };
}
