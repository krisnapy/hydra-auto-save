import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { createGzip, createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const digest = value => createHash('sha256').update(value).digest('hex');
const exists = async file => fs.lstat(file).then(() => true, e => {
  if (e.code === 'ENOENT') return false;
  throw e;
});
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unstable = message => Object.assign(new Error(message), { code: 'SAVE_UNSTABLE' });
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const contained = (parent, child) => {
  const relative = path.relative(parent, child);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Bound decompression by the recorded original length and verify the decoded
// bytes while streaming. A restore never links a live save to backup storage.
function checkedBytes(entry) {
  let bytes = 0;
  const hash = createHash('sha256');
  return new Transform({
    transform(chunk, _, callback) {
      bytes += chunk.length;
      if (bytes > entry.bytes) return callback(new Error('Ukuran isi backup tidak sesuai.'));
      hash.update(chunk); callback(null, chunk);
    },
    flush(callback) {
      callback(bytes === entry.bytes && hash.digest('hex') === entry.hash ? null : new Error('Integritas backup gagal.'));
    },
  });
}

export async function readBackupBlob(folder, manifest, entry) {
  const file = path.join(folder, 'data', entry.hash);
  await safePath(file);
  const chunks = [];
  await pipeline(createReadStream(file), ...(manifest.compressed?.includes(entry.hash) ? [createGunzip()] : []), checkedBytes(entry), async stream => {
    for await (const chunk of stream) chunks.push(chunk);
  });
  return Buffer.concat(chunks);
}

export function portableManifest(value) {
  const { compressed, storage, ...manifest } = value;
  manifest.schema = 1;
  return manifest;
}

export async function storeBackupBlob(source, target, entry, compressed = false) {
  await safePath(source); await safePath(target);
  if (compressed || entry.bytes < 4096) {
    await fs.copyFile(source, target, constants.COPYFILE_FICLONE);
    return compressed;
  }
  await pipeline(createReadStream(source), checkedBytes(entry), createGzip({ level: 1 }), createWriteStream(target, { flags: 'wx' }));
  if ((await fs.stat(target)).size + 64 < entry.bytes) return true;
  await fs.rm(target);
  await fs.copyFile(source, target, constants.COPYFILE_FICLONE);
  return false;
}

// Reject symlinks/junctions in every existing component, including parents.
export async function safePath(file) {
  if (!path.isAbsolute(file)) throw new Error('Lokasi harus berupa path absolut.');
  const resolved = path.resolve(file);
  let cursor = path.parse(resolved).root;
  for (const part of resolved.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error(`Tautan folder/file tidak didukung: ${cursor}`);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  return resolved;
}

export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function makeRoots(selections) {
  const roots = [];
  for (const selection of selections) {
    const file = await safePath(selection.path);
    if (file === path.parse(file).root) throw new Error('Pilih folder save, bukan seluruh drive.');
    const info = await fs.lstat(file);
    const kind = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : null;
    if (!kind) throw new Error('Lokasi save harus berupa file atau folder biasa.');
    if (roots.some(root => contained(root.path, file) || contained(file, root.path))) {
      throw new Error('Lokasi save ganda atau saling bertumpuk.');
    }
    roots.push({ id: digest(file).slice(0, 24), path: file, kind });
  }
  return roots.sort((a, b) => a.id.localeCompare(b.id));
}

export class BackupEngine {
  constructor({ destination, deviceId, stateDirectory, retention = 10, stableMs = 1200, assertStopped, onStatus = () => {}, onProgress = () => {} }) {
    if (!safeId(deviceId)) throw new Error('Identitas perangkat tidak valid.');
    if (!Number.isInteger(retention) || retention < 1 || retention > 100) throw new Error('Riwayat harus 1–100 versi.');
    this.destination = path.resolve(destination);
    this.deviceId = deviceId;
    this.stateDirectory = stateDirectory;
    this.retention = retention;
    this.stableMs = stableMs;
    this.assertStopped = assertStopped ?? (async () => { throw new Error('Status game belum dapat dipastikan.'); });
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.jobs = new Map();
    // Memory only: restart always revalidates cloud content. Bound the cache so
    // large libraries cannot grow it indefinitely.
    this.historyCache = new Map();
    this.historyChecks = new Map();
    this.historyCacheStats = { hits: 0, filesHashed: 0, bytesHashed: 0 };

  }

  directory(gameId) { return path.join(this.destination, 'HydraPersonalBackup', this.deviceId, digest(gameId)); }
  busy(gameId) { return this.jobs.has(gameId); }
  async idle() { await Promise.allSettled([...this.jobs.values()]); }
  async exclusive(gameId, action) {
    if (this.jobs.has(gameId)) throw new Error('Operasi backup atau pemulihan masih berjalan.');
    const pending = Promise.resolve().then(async () => { await this.repairJobs?.get(gameId); return action(); });
    this.jobs.set(gameId, pending);
    try { return await pending; } finally { this.jobs.delete(gameId); }
  }

  async validate(roots) {
    if (!roots.length) throw new Error('Perlu pengaturan: belum ada lokasi save.');
    await safePath(this.destination);
    await safePath(this.stateDirectory);
    const ids = new Set();
    for (const root of roots) {
      await safePath(root.path);
      if (!safeId(root.id) || ids.has(root.id) || !['directory', 'file'].includes(root.kind)) throw new Error('Konfigurasi lokasi save tidak valid.');
      ids.add(root.id);
      if (contained(root.path, this.destination) || contained(this.destination, root.path) || contained(root.path, path.resolve(this.stateDirectory))) {
        throw new Error('Folder backup dan data modul harus terpisah dari lokasi save.');
      }
    }
    for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
      if (contained(roots[i].path, roots[j].path) || contained(roots[j].path, roots[i].path)) throw new Error('Lokasi save saling bertumpuk.');
    }
  }

  changedFiles(before, after, roots) {
    const previous = new Map(before.files.map(file => [`${file.rootId}/${file.relative}`, file]));
    const changed = [];
    for (const entry of after.files) {
      const key = `${entry.rootId}/${entry.relative}`;
      const old = previous.get(key);
      if (!old || old.hash !== entry.hash || old.bytes !== entry.bytes) changed.push(this.source(roots, entry));
      previous.delete(key);
    }
    for (const entry of previous.values()) changed.push(this.source(roots, entry));
    for (const state of after.roots) if (before.roots.find(root => root.id === state.id)?.present !== state.present) changed.push(roots.find(root => root.id === state.id).path);
    return [...new Set(changed)];
  }
  unstableChange(message, before, after, roots) {
    const files = this.changedFiles(before, after, roots);
    return unstable(`${message}${files.length ? ` Lokasi berubah: ${files.slice(0, 3).join('; ')}${files.length > 3 ? `; dan ${files.length - 3} lokasi lain` : ''}.` : ''}`);
  }
  async scan(roots, onFile = () => {}) {
    await this.validate(roots);
    const files = [], states = [];
    const walk = async (root, file, relative) => {
      await safePath(file);
      const info = await fs.lstat(file);
      if (info.isDirectory()) {
        for (const name of (await fs.readdir(file)).sort()) await walk(root, path.join(file, name), relative ? `${relative}/${name}` : name);
      } else if (info.isFile()) {
        files.push({ rootId: root.id, relative: relative || '.', bytes: info.size, hash: await hashFile(file) });
        onFile(files.length);
      } else throw new Error(`File khusus tidak didukung: ${file}`);
    };
    for (const root of roots) {
      const present = await exists(root.path);
      states.push({ id: root.id, kind: root.kind, present });
      if (present) {
        try {
          const info = await fs.lstat(root.path);
          if ((root.kind === 'file' && !info.isFile()) || (root.kind === 'directory' && !info.isDirectory())) throw new Error('Jenis lokasi save berubah.');
          await walk(root, root.path, '');
        }
        catch (error) { if (['ENOENT', 'EBUSY'].includes(error.code)) throw unstable(`Save masih berubah atau sedang digunakan saat dibaca: ${error.path ?? root.path}.`); throw error; }
      }
    }
    return { roots: states, files };
  }

  source(roots, entry) {
    const root = roots.find(root => root.id === entry.rootId);
    if (!root || typeof entry.relative !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash)) throw new Error('Metadata backup tidak valid.');
    if (root.kind === 'file') {
      if (entry.relative !== '.') throw new Error('Path file backup tidak valid.');
      return root.path;
    }
    if (entry.relative === '.' || entry.relative.split('/').some(part => !part || part === '.' || part === '..' || /[\\:<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) throw new Error('Path backup tidak aman.');
    const file = path.resolve(root.path, ...entry.relative.split('/'));
    if (!contained(root.path, file)) throw new Error('Path backup di luar lokasi save.');
    return file;
  }

  async verifyHistoryBlob(blob, entry, fresh, compressed = false) {
    await safePath(blob);
    const signature = async () => {
      const info = await fs.lstat(blob, { bigint: true });
      if (!info.isFile() || (compressed ? info.size <= 0n || info.size > BigInt(entry.bytes) : info.size !== BigInt(entry.bytes))) throw new Error('Isi backup belum lengkap.');
      return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
    };
    const before = await signature();
    const key = `${before}:${entry.hash}:${entry.bytes}:${compressed}`;
    if (!fresh && this.historyCache.get(blob) === key) {
      this.historyCache.delete(blob);
      this.historyCache.set(blob, key);
      this.historyCacheStats.hits++;
      return;
    }
    // Concurrent UI snapshots share only a check of the same file identity.
    // A restore's fresh check never trusts a prior result or pending UI check.
    const pendingKey = `${blob}\0${key}`;
    if (!fresh && this.historyChecks.has(pendingKey)) return this.historyChecks.get(pendingKey);
    const check = (async () => {
      this.historyCacheStats.filesHashed++;
      this.historyCacheStats.bytesHashed += entry.bytes;
      await pipeline(createReadStream(blob), ...(compressed ? [createGunzip()] : []), checkedBytes(entry), async stream => { for await (const _ of stream) { /* drain verified bytes */ } });
      if (await signature() !== before) throw new Error('Isi backup berubah saat diperiksa.');
      this.historyCache.delete(blob);
      this.historyCache.set(blob, key);
      while (this.historyCache.size > 8192) this.historyCache.delete(this.historyCache.keys().next().value);
    })();
    if (!fresh) this.historyChecks.set(pendingKey, check);
    try { await check; }
    catch (error) { this.historyCache.delete(blob); throw error; }
    finally { if (!fresh && this.historyChecks.get(pendingKey) === check) this.historyChecks.delete(pendingKey); }
  }

  repairOptimizations(gameId) {
    this.repairJobs ??= new Map();
    if (this.repairJobs.has(gameId)) return this.repairJobs.get(gameId);
    const job = (async () => {
      const directory = this.directory(gameId);
      await safePath(directory);
      if (!await exists(directory)) return;
      for (const name of await fs.readdir(directory)) {
        if (!name.startsWith('_opt-old-')) continue;
        const id = name.slice('_opt-old-'.length);
        if (!safeId(id) || id.startsWith('_')) continue;
        const old = path.join(directory, name), target = path.join(directory, id);
        await safePath(old); await safePath(target);
        // Both directories have the same immutable identity. Keep the original
        // until the replacement is fully verified, including after a restart.
        const original = await json(path.join(old, 'manifest.json'));
        if (original.id !== id || original.gameId !== gameId || original.deviceId !== this.deviceId) throw new Error('Catatan optimisasi tidak sesuai game. Folder pengaman dipertahankan.');
        const replacement = (await this.versions(gameId, { fresh: true, versionId: id, skipRepair: true }))[0];
        if (replacement && same(portableManifest(original), portableManifest(replacement))) {
          const trash = path.join(directory, `_opt-trash-${randomUUID()}`);
          await fs.rename(old, trash);
          await fs.rm(trash, { recursive: true });
        } else {
          if (await exists(target)) await fs.rename(target, path.join(directory, `_opt-failed-${randomUUID()}`));
          await fs.rename(old, target);
        }
      }
    })().finally(() => this.repairJobs.delete(gameId));
    this.repairJobs.set(gameId, job);
    return job;
  }

  async versions(gameId, { fresh = false, versionId, skipRepair = false } = {}) {
    if (!skipRepair && !this.busy(gameId)) await this.repairOptimizations(gameId);
    const directory = this.directory(gameId);
    await safePath(directory);
    if (!await exists(directory)) return [];
    const versions = [];
    for (const name of await fs.readdir(directory)) {
      if (!safeId(name) || name.startsWith('_') || (versionId && name !== versionId)) continue;
      const folder = path.join(directory, name);
      try {
        await safePath(folder);
        const bytes = await fs.readFile(path.join(folder, 'manifest.json'), 'utf8');
        const marker = await fs.readFile(path.join(folder, 'COMPLETE'), 'utf8');
        if (digest(bytes) !== marker) continue;
        const manifest = JSON.parse(bytes);
        if (![1, 2].includes(manifest.schema) || manifest.gameId !== gameId || manifest.deviceId !== this.deviceId || manifest.id !== name) continue;
        if (manifest.schema === 1 && manifest.compressed !== undefined) continue;
        if (manifest.schema === 2 && (!Array.isArray(manifest.compressed) || new Set(manifest.compressed).size !== manifest.compressed.length || manifest.compressed.some(hash => !/^[a-f0-9]{64}$/.test(hash) || !manifest.files.some(file => file.hash === hash)))) continue;
        // Do not offer partially downloaded/corrupt cloud versions for restoration.
        for (const entry of manifest.files) {
          if (!/^[a-f0-9]{64}$/.test(entry.hash) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error('Metadata file tidak valid.');
          const blob = path.join(folder, 'data', entry.hash);
          await this.verifyHistoryBlob(blob, entry, fresh, manifest.compressed?.includes(entry.hash));
        }
        versions.push(manifest);
      } catch { /* Missing or incomplete cloud files are not restorable versions. */ }
    }
    return versions.sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  journal(gameId) { return path.join(this.stateDirectory, `${digest(gameId)}-restore.json`); }
  async assertNoRecovery(gameId) {
    if (await exists(this.journal(gameId))) throw new Error('Pemulihan sebelumnya terputus. Selesaikan penanganan pemulihan sebelum membuat backup baru.');
  }
  async recovery(gameId) {
    const journal = this.journal(gameId);
    await safePath(journal);
    if (!await exists(journal)) return null;
    try {
      if ((await fs.stat(journal)).size > 1024 * 1024) throw new Error('Catatan terlalu besar.');
      const value = await json(journal);
      return { journal, automatic: value.schema === 2 && value.gameId === gameId, committed: value.committed === true };
    } catch { return { journal, automatic: false, committed: false }; }
  }
  async availableSpace(directory) {
    await safePath(directory);
    let current = directory;
    while (!await exists(current)) {
      const parent = path.dirname(current);
      if (parent === current) throw new Error('Volume penyimpanan tidak tersedia.');
      current = parent;
    }
    const info = await fs.statfs(current, { bigint: true });
    return { availableBytes: Number(info.bavail * info.bsize), totalBytes: Number(info.blocks * info.bsize) };
  }
  async storage() {
    if (this.storageCheckedAt && Date.now() - this.storageCheckedAt < 30000) return this.storageResult;
    try {
      const space = await this.availableSpace(this.destination);
      this.storageResult = { ...space, warning: space.availableBytes < 1024 ** 3, detail: space.availableBytes < 1024 ** 3 ? 'Ruang folder backup kurang dari 1 GB. Kosongkan ruang agar backup dapat terus berjalan.' : '' };
    } catch { this.storageResult = { warning: true, detail: 'Ruang folder backup belum dapat diperiksa. Periksa ketersediaan drive atau folder cloud.' }; }
    this.storageCheckedAt = Date.now();
    return this.storageResult;
  }
  async requireSpace(directory, bytes) {
    let space;
    try { space = await this.availableSpace(directory); }
    catch { return; } // Unsupported statfs is advisory; actual copy errors still fail safely.
    if (space.availableBytes < bytes + 16 * 1024 ** 2) throw Object.assign(new Error('Ruang penyimpanan tidak cukup untuk operasi ini. Kosongkan ruang; backup lama dipertahankan.'), { code: 'ENOSPC' });
  }
  recover(gameId, roots) {
    return this.exclusive(gameId, async () => {
      await this.validate(roots);
      await this.assertStopped(gameId);
      const summary = await this.recovery(gameId);
      if (!summary?.automatic) throw new Error('Catatan pemulihan lama atau rusak memerlukan pemeriksaan manual. Buka folder catatan pemulihan dan jangan hapus file pengaman.');
      const journal = this.journal(gameId);
      const value = await json(journal);
      if (value.schema !== 2 || value.gameId !== gameId || typeof value.committed !== 'boolean' || !Array.isArray(value.plans) || value.plans.length !== roots.length || !/^[a-f0-9]{64}$/.test(value.safetyFingerprint) || !/^[a-f0-9]{64}$/.test(value.targetFingerprint)) throw new Error('Catatan pemulihan tidak valid.');
      const ids = new Set();
      for (const plan of value.plans) {
        const root = roots.find(root => root.id === plan.id);
        if (!root || ids.has(plan.id) || plan.path !== root.path || plan.kind !== root.kind || typeof plan.originalPresent !== 'boolean') throw new Error('Lokasi pemulihan berbeda dari pengaturan. Pemeriksaan manual diperlukan.');
        ids.add(plan.id);
        for (const [key, suffix] of [['stage', 'restore'], ['rollback', 'previous'], ['preserved', 'interrupted']]) {
          if (key === 'preserved' && !plan[key]) continue;
          const prefix = `${root.path}.hydra-${suffix}-`;
          if (typeof plan[key] !== 'string' || !plan[key].startsWith(prefix) || !/^[a-f0-9-]{36}$/.test(plan[key].slice(prefix.length))) throw new Error('Path catatan pemulihan tidak aman.');
          await safePath(plan[key]);
        }
      }
      if (!value.committed) {
        for (const plan of [...value.plans].reverse()) {
          await this.assertStopped(gameId);
          await safePath(plan.path);
          const rollback = await exists(plan.rollback);
          if ((rollback || !plan.originalPresent) && await exists(plan.path)) {
            plan.preserved ??= `${plan.path}.hydra-interrupted-${randomUUID()}`;
            await safePath(plan.preserved);
            if (await exists(plan.preserved)) throw new Error('File pengaman penanganan sudah ada. Pemeriksaan manual diperlukan.');
            await atomicJson(journal, value);
            await fs.rename(plan.path, plan.preserved);
          }
          if (rollback) await fs.rename(plan.rollback, plan.path);
        }
      }
      // Only clear the block after content matches the recorded complete state.
      await this.assertStopped(gameId);
      const current = digest(JSON.stringify(await this.scan(roots)));
      if (current !== (value.committed ? value.targetFingerprint : value.safetyFingerprint)) throw new Error('Isi save belum sesuai kondisi pemulihan. Catatan dan file pengaman dipertahankan untuk pemeriksaan manual.');
      await fs.rm(journal);
      this.onStatus(gameId, 'restored', value.committed ? 'Pemulihan sebelumnya sudah lengkap; pemeriksaan selesai.' : 'Kondisi sebelum pemulihan dikembalikan. File yang dipindahkan disimpan di samping lokasi save dengan nama hydra-interrupted.');
    });
  }

  backup(gameId, roots, options = {}) {
    return this.exclusive(gameId, () => this.capture(gameId, roots, options));
  }

  async capture(gameId, roots, { reason = 'manual', safety = false } = {}) {
    await this.repairOptimizations(gameId);
    await this.assertNoRecovery(gameId);
    this.onStatus(gameId, 'preparing');
    const report = (phase, completed, total) => this.onProgress(gameId, safety ? `safety-${phase}` : phase, completed, total);
    let temporary;
    try {
      const scan = phase => { report(phase); return this.scan(roots, count => report(phase, count)); };
      let first = await scan('scanning');
      if (!safety && !first.roots.some(root => root.present)) throw new Error('Lokasi save belum tersedia.');
      report('checking-history');
      const versions = await this.versions(gameId);
      const unchanged = value => !safety && versions.find(version => !version.safety)?.fingerprint === digest(JSON.stringify(value));
      if (unchanged(first)) {
        this.onStatus(gameId, 'waiting', 'Isi save tidak berubah; backup baru tidak diperlukan.');
        return null;
      }
      // Only changed content needs a quiet window. Retry short write bursts a
      // bounded number of times; never publish a snapshot that keeps changing.
      for (let attempt = 0; attempt < 3; attempt++) {
        report('stabilizing');
        await delay(this.stableMs);
        const next = await scan('checking-stability');
        if (same(first, next)) break;
        if (attempt === 2) throw this.unstableChange('Save masih berubah atau sedang ditulis setelah 3 pemeriksaan; tutup game bila terus berulang.', first, next, roots);
        first = next;
      }
      if (!safety && !first.roots.some(root => root.present)) throw new Error('Lokasi save belum tersedia.');
      if (unchanged(first)) {
        this.onStatus(gameId, 'waiting', 'Isi save kembali sama dengan backup terakhir; backup baru tidak diperlukan.');
        return null;
      }
      const fingerprint = digest(JSON.stringify(first));
      const id = `${Date.now()}-${randomUUID()}`;
      const directory = this.directory(gameId);
      await safePath(directory);
      const uniqueFiles = new Map(first.files.map(file => [file.hash, file]));
      await this.requireSpace(this.destination, [...uniqueFiles.values()].reduce((sum, file) => sum + file.bytes, 0));
      temporary = path.join(directory, `_pending-${id}`);
      await fs.mkdir(path.join(temporary, 'data'), { recursive: true });
      let copied = 0;
      const compressed = [], written = new Set();
      const reusable = new Map();
      for (const version of versions) for (const entry of version.files) if (!reusable.has(entry.hash)) reusable.set(entry.hash, { version, entry });
      report('copying', 0, first.files.length);
      for (const entry of first.files) {
        const source = this.source(roots, entry);
        await safePath(source);
        const target = path.join(temporary, 'data', entry.hash);
        if (!written.has(entry.hash)) {
          try {
            const prior = reusable.get(entry.hash);
            if (prior && prior.entry.bytes === entry.bytes && (entry.bytes < 4096 || prior.version.storage === 'adaptive-gzip-v1' || prior.version.compressed?.includes(entry.hash))) {
              const previous = path.join(directory, prior.version.id, 'data', entry.hash);
              await safePath(previous);
              // Reflink when supported, ordinary independent copy otherwise.
              // Avoid hardlinks: editing a backup must not alter other versions.
              await fs.copyFile(previous, target, constants.COPYFILE_FICLONE);
              if (prior.version.compressed?.includes(entry.hash)) compressed.push(entry.hash);
            } else if (await storeBackupBlob(source, target, entry)) compressed.push(entry.hash);
          }
          catch (error) {
            if (error.code === 'ENOENT' && !await exists(source)) throw unstable(`Sumber berubah selama penyalinan: ${source}. File hilang atau sedang diganti; backup akan dicoba lagi.`);
            if (/Integritas backup gagal|Ukuran isi backup/.test(error.message)) throw unstable(`Sumber berubah selama penyalinan: ${source}. Backup akan dicoba lagi setelah stabil.`);
            throw error;
          }
          try { await this.verifyHistoryBlob(target, entry, true, compressed.includes(entry.hash)); }
          catch (error) {
            if (/Integritas backup gagal|Ukuran isi backup|Isi backup belum lengkap/.test(error.message)) throw unstable(`Sumber atau salinan berubah selama penyalinan: ${source}. Backup akan dicoba lagi setelah stabil.`);
            throw error;
          }
          written.add(entry.hash);
        }
        report('copying', ++copied, first.files.length);
      }
      const final = await scan('verifying');
      if (!same(first, final)) throw this.unstableChange('Sumber berubah selama penyalinan; backup akan dicoba lagi setelah stabil.', first, final, roots);
      const order = Math.max(0, ...versions.map(version => version.order ?? 0)) + 1;
      const manifest = { schema: compressed.length ? 2 : 1, storage: 'adaptive-gzip-v1', ...(compressed.length ? { compressed } : {}), id, gameId, deviceId: this.deviceId, order, createdAt: new Date().toISOString(), reason, safety, fingerprint, ...first };
      report('publishing');
      const bytes = JSON.stringify(manifest, null, 2);
      await fs.writeFile(path.join(temporary, 'manifest.json'), bytes);
      await fs.writeFile(path.join(temporary, 'COMPLETE'), digest(bytes));
      await fs.rename(temporary, path.join(directory, id));
      temporary = undefined;
      // Only this device's completed normal versions count toward retention.
      // Safety copies are pinned and never automatically pruned.
      report('retention');
      // Never prune old versions based solely on cached verification.
      if (!(await this.versions(gameId, { fresh: true, versionId: id })).length) throw new Error('Backup baru gagal pemeriksaan integritas; riwayat lama dipertahankan.');
      for (const old of (await this.versions(gameId)).filter(version => !version.safety).slice(this.retention)) {
        await fs.rm(path.join(directory, old.id), { recursive: true, force: true });
      }
      this.onStatus(gameId, 'complete');
      return manifest;
    } catch (error) {
      if (error.code === 'EBUSY') error = unstable(`File sedang digunakan saat backup: ${error.path ?? error.dest ?? 'lokasi tidak dilaporkan sistem'}. Periksa sumber save dan folder tujuan; backup akan dicoba lagi.`);
      this.onStatus(gameId, error.code === 'SAVE_UNSTABLE' ? 'waiting' : 'failed', error.code === 'ENOSPC' ? 'Ruang penyimpanan tidak cukup. Backup lama tetap dipertahankan.' : error.message);
      throw error;
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  restore(gameId, roots, versionId, confirmed) {
    return this.exclusive(gameId, async () => {
      if (confirmed !== true) throw new Error('Pemulihan memerlukan konfirmasi.');
      await this.repairOptimizations(gameId);
      this.onProgress(gameId, 'checking-restore');
      await this.validate(roots);
      await this.assertStopped(gameId);
      const journal = path.join(this.stateDirectory, `${digest(gameId)}-restore.json`);
      if (await exists(journal)) throw new Error(`Pemulihan sebelumnya terputus. Periksa catatan pemulihan: ${journal}`);
      const manifest = (await this.versions(gameId, { fresh: true, versionId })).find(version => version.id === versionId);
      if (!manifest) throw new Error('Versi tidak tersedia, belum lengkap, atau gagal pemeriksaan integritas.');
      const configured = new Map(roots.map(root => [root.id, root]));
      const recorded = new Map(manifest.roots.map(root => [root.id, root]));
      if (recorded.size !== manifest.roots.length || manifest.roots.some(root => configured.get(root.id)?.kind !== root.kind || typeof root.present !== 'boolean') || roots.some(root => !recorded.has(root.id) && root.kind !== 'file')) throw new Error('Lokasi save berubah sejak backup. Kembalikan pengaturan lokasi yang sesuai.');
      const unique = new Set();
      for (const entry of manifest.files) {
        const target = this.source(roots, entry);
        if (unique.has(target)) throw new Error('Metadata memiliki file ganda.');
        unique.add(target);
        if (!manifest.roots.find(root => root.id === entry.rootId)?.present) throw new Error('Metadata lokasi tidak konsisten.');
      }
      // Fail before writing live data if the safety backup cannot complete.
      const safety = await this.capture(gameId, roots, { reason: 'before-restore', safety: true });
      const plans = roots.map(root => ({ ...root, stage: `${root.path}.hydra-restore-${randomUUID()}`, rollback: `${root.path}.hydra-previous-${randomUUID()}`, moved: false, installed: false, present: recorded.get(root.id)?.present ?? false, originalPresent: safety.roots.find(item => item.id === root.id)?.present ?? false }));
      const writeJournal = (committed = false) => atomicJson(journal, { schema: 2, gameId, committed, safety: safety.id, safetyFingerprint: safety.fingerprint, targetFingerprint: manifest.fingerprint, plans });
      let journalWritten = false, committed = false;
      let staged = 0;
      this.onProgress(gameId, 'restore-staging', 0, manifest.files.length);
      try {
        for (const plan of plans) {
          await safePath(plan.path);
          await this.requireSpace(path.dirname(plan.path), manifest.files.filter(file => file.rootId === plan.id).reduce((sum, file) => sum + file.bytes, 0));
          await fs.mkdir(path.dirname(plan.stage), { recursive: true });
          if (plan.present && plan.kind === 'directory') await fs.mkdir(plan.stage);
          for (const entry of manifest.files.filter(file => file.rootId === plan.id)) {
            const target = plan.kind === 'file' ? plan.stage : path.join(plan.stage, ...entry.relative.split('/'));
            await fs.mkdir(path.dirname(target), { recursive: true });
            const blob = path.join(this.directory(gameId), manifest.id, 'data', entry.hash);
            await safePath(blob);
            await pipeline(createReadStream(blob), ...(manifest.compressed?.includes(entry.hash) ? [createGunzip()] : []), checkedBytes(entry), createWriteStream(target, { flags: 'wx' }));
            this.onProgress(gameId, 'restore-staging', ++staged, manifest.files.length);
          }
          if (plan.present && plan.kind === 'file' && !await exists(plan.stage)) throw new Error('Isi file backup tidak lengkap.');
        }
        await this.assertStopped(gameId);
        this.onProgress(gameId, 'restore-checking-source');
        const before = await this.scan(roots);
        if (digest(JSON.stringify(before)) !== safety.fingerprint) throw new Error('Save berubah setelah backup pengaman. Pemulihan dibatalkan.');
        await writeJournal();
        journalWritten = true;
        let replaced = 0;
        this.onProgress(gameId, 'restore-replacing', 0, plans.length);
        for (const plan of plans) {
          await this.assertStopped(gameId);
          await safePath(plan.path);
          if (await exists(plan.path)) {
            await fs.rename(plan.path, plan.rollback);
            plan.moved = true;
          }
          if (plan.present) {
            await fs.rename(plan.stage, plan.path);
            plan.installed = true;
          }
          await writeJournal();
          this.onProgress(gameId, 'restore-replacing', ++replaced, plans.length);
        }
        committed = true;
        await writeJournal(true);
        this.onProgress(gameId, 'restore-cleanup');
        for (const plan of plans) await fs.rm(plan.rollback, { recursive: true, force: true });
        await fs.rm(journal);
        this.onStatus(gameId, 'restored');
        return { restored: manifest.id, safety: safety.id };
      } catch (error) {
        if (!committed) {
          this.onProgress(gameId, 'rolling-back');
          try {
            for (const plan of [...plans].reverse()) {
              if (plan.installed) await fs.rm(plan.path, { recursive: true, force: true });
              if (plan.moved) await fs.rename(plan.rollback, plan.path);
            }
            if (journalWritten) await fs.rm(journal, { force: true });
          } catch (rollbackError) {
            throw new Error(`${error.message}; rollback gagal: ${rollbackError.message}. Backup pengaman: ${safety.id}; catatan: ${journal}`);
          }
        }
        this.onStatus(gameId, 'failed', error.message);
        throw error;
      } finally {
        for (const plan of plans) await fs.rm(plan.stage, { recursive: true, force: true });
      }
    });
  }
}
