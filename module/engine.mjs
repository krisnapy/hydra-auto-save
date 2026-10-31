import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const digest = value => createHash('sha256').update(value).digest('hex');
const exists = async file => fs.lstat(file).then(() => true, e => {
  if (e.code === 'ENOENT') return false;
  throw e;
});
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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
    const pending = Promise.resolve().then(action);
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

  async scan(roots) {
    await this.validate(roots);
    const files = [], states = [];
    const walk = async (root, file, relative) => {
      await safePath(file);
      const info = await fs.lstat(file);
      if (info.isDirectory()) {
        for (const name of (await fs.readdir(file)).sort()) await walk(root, path.join(file, name), relative ? `${relative}/${name}` : name);
      } else if (info.isFile()) {
        files.push({ rootId: root.id, relative: relative || '.', bytes: info.size, hash: await hashFile(file) });
      } else throw new Error(`File khusus tidak didukung: ${file}`);
    };
    for (const root of roots) {
      const present = await exists(root.path);
      states.push({ id: root.id, kind: root.kind, present });
      if (present) {
        const info = await fs.lstat(root.path);
        if ((root.kind === 'file' && !info.isFile()) || (root.kind === 'directory' && !info.isDirectory())) throw new Error('Jenis lokasi save berubah.');
        await walk(root, root.path, '');
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

  async verifyHistoryBlob(blob, entry, fresh) {
    await safePath(blob);
    const signature = async () => {
      const info = await fs.lstat(blob, { bigint: true });
      if (!info.isFile() || info.size !== BigInt(entry.bytes)) throw new Error('Isi backup belum lengkap.');
      return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
    };
    const before = await signature();
    const key = `${before}:${entry.hash}`;
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
      if (await hashFile(blob) !== entry.hash) throw new Error('Integritas backup gagal.');
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

  async versions(gameId, { fresh = false, versionId } = {}) {
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
        if (manifest.schema !== 1 || manifest.gameId !== gameId || manifest.deviceId !== this.deviceId || manifest.id !== name) continue;
        // Do not offer partially downloaded/corrupt cloud versions for restoration.
        for (const entry of manifest.files) {
          if (!/^[a-f0-9]{64}$/.test(entry.hash) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error('Metadata file tidak valid.');
          const blob = path.join(folder, 'data', entry.hash);
          await this.verifyHistoryBlob(blob, entry, fresh);
        }
        versions.push(manifest);
      } catch { /* Missing or incomplete cloud files are not restorable versions. */ }
    }
    return versions.sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  backup(gameId, roots, options = {}) {
    return this.exclusive(gameId, () => this.capture(gameId, roots, options));
  }

  async capture(gameId, roots, { reason = 'manual', safety = false } = {}) {
    this.onStatus(gameId, 'preparing');
    const report = (phase, completed, total) => this.onProgress(gameId, safety ? `safety-${phase}` : phase, completed, total);
    let temporary;
    try {
      report('scanning');
      const first = await this.scan(roots);
      if (!safety && !first.roots.some(root => root.present)) throw new Error('Lokasi save belum tersedia.');
      report('stabilizing');
      await delay(this.stableMs);
      if (!same(first, await this.scan(roots))) throw new Error('Save masih berubah; backup akan dicoba lagi.');
      const fingerprint = digest(JSON.stringify(first));
      report('checking-history');
      const versions = await this.versions(gameId);
      if (!safety && versions.find(version => !version.safety)?.fingerprint === fingerprint) {
        this.onStatus(gameId, 'waiting');
        return null;
      }
      const id = `${Date.now()}-${randomUUID()}`;
      const directory = this.directory(gameId);
      await safePath(directory);
      temporary = path.join(directory, `_pending-${id}`);
      await fs.mkdir(path.join(temporary, 'data'), { recursive: true });
      let copied = 0;
      report('copying', 0, first.files.length);
      for (const entry of first.files) {
        const source = this.source(roots, entry);
        await safePath(source);
        const target = path.join(temporary, 'data', entry.hash);
        if (!await exists(target)) await fs.copyFile(source, target);
        if (await hashFile(target) !== entry.hash) throw new Error('Sumber berubah selama penyalinan.');
        report('copying', ++copied, first.files.length);
      }
      report('verifying');
      if (!same(first, await this.scan(roots))) throw new Error('Sumber berubah selama penyalinan.');
      const order = Math.max(0, ...versions.map(version => version.order ?? 0)) + 1;
      const manifest = { schema: 1, id, gameId, deviceId: this.deviceId, order, createdAt: new Date().toISOString(), reason, safety, fingerprint, ...first };
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
      this.onStatus(gameId, 'failed', error.message);
      throw error;
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  restore(gameId, roots, versionId, confirmed) {
    return this.exclusive(gameId, async () => {
      if (confirmed !== true) throw new Error('Pemulihan memerlukan konfirmasi.');
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
      const plans = roots.map(root => ({ ...root, stage: `${root.path}.hydra-restore-${randomUUID()}`, rollback: `${root.path}.hydra-previous-${randomUUID()}`, moved: false, installed: false, present: recorded.get(root.id)?.present ?? false }));
      let journalWritten = false, committed = false;
      let staged = 0;
      this.onProgress(gameId, 'restore-staging', 0, manifest.files.length);
      try {
        for (const plan of plans) {
          await safePath(plan.path);
          await fs.mkdir(path.dirname(plan.stage), { recursive: true });
          if (plan.present && plan.kind === 'directory') await fs.mkdir(plan.stage);
          for (const entry of manifest.files.filter(file => file.rootId === plan.id)) {
            const target = plan.kind === 'file' ? plan.stage : path.join(plan.stage, ...entry.relative.split('/'));
            await fs.mkdir(path.dirname(target), { recursive: true });
            const blob = path.join(this.directory(gameId), manifest.id, 'data', entry.hash);
            await safePath(blob);
            await fs.copyFile(blob, target);
            if (await hashFile(target) !== entry.hash) throw new Error('File backup rusak atau belum tersedia secara lokal.');
            this.onProgress(gameId, 'restore-staging', ++staged, manifest.files.length);
          }
          if (plan.present && plan.kind === 'file' && !await exists(plan.stage)) throw new Error('Isi file backup tidak lengkap.');
        }
        await this.assertStopped(gameId);
        this.onProgress(gameId, 'restore-checking-source');
        const before = await this.scan(roots);
        if (digest(JSON.stringify(before)) !== safety.fingerprint) throw new Error('Save berubah setelah backup pengaman. Pemulihan dibatalkan.');
        await atomicJson(journal, { safety: safety.id, plans });
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
          await atomicJson(journal, { safety: safety.id, plans });
          this.onProgress(gameId, 'restore-replacing', ++replaced, plans.length);
        }
        committed = true;
        await atomicJson(journal, { committed: true, safety: safety.id, plans });
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
