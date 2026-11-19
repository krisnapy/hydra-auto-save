import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { accountMatch } from './backup-account.mjs';
import { BackupEngine, digest, safePath, portableManifest } from './engine.mjs';
import { unpackBundle, readSharedIndex, materializeShared, validateValue, validateManifest, importVersion, BUNDLE_LIMIT } from './cloud-bundle.mjs';

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !value.startsWith('_');
const missing = error => { if (error.code === 'ENOENT') return []; throw error; };
const fingerprint = m => digest(JSON.stringify({ roots: m.roots, files: m.files }));
// Keep only metadata between user steps, never a whole cloud save in memory.
const selectionValue = value => ({ schema: value.schema, manifest: value.manifest, ...(value.local ? { local: value.local } : {}) });

// Each renderer-visible ID is an opaque, session-only capability. Paths, source
// manifests and account identity remain in the main process.
export class ProfileRecovery {
  constructor(controller) { this.controller = controller; this.sources = new Map(); }
  ownership(manifest, driveId) {
    this.controller.assertAccount?.();
    if (!this.controller.getAccount) return 'legacy';
    return accountMatch(manifest.account, this.controller.hydraAccount, driveId);
  }
  snapshot() {
    this.controller.assertAccount?.();
    return { sources: [...this.sources].map(([token, source]) => ({ token, ownership: source.ownership, title: source.title, deviceId: source.deviceId, createdAt: source.createdAt, gameId: source.gameId, source: source.cloud ? 'onedrive' : 'local' })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      selection: this.selection ? { token: this.selection.token, ownership: this.selection.ownership, gameId: this.selection.gameId, title: this.selection.source.title, targetTitle: this.selection.gameTitle, sourceGameId: this.selection.value.manifest.gameId, deviceId: this.selection.source.deviceId, createdAt: this.selection.value.manifest.createdAt,
        roots: this.selection.value.manifest.roots.map(root => ({ id: root.id, kind: root.kind, files: this.selection.value.manifest.files.filter(f => f.rootId === root.id).length, samples: this.selection.value.manifest.files.filter(f => f.rootId === root.id).slice(0, 3).map(f => f.relative), originalPath: this.selection.source.locations?.[root.id] || '', target: this.selection.mapping[root.id] || '' })) } : null };
  }
  reset() { this.sources.clear(); this.selection = undefined; }
  async listLocal(destination) {
    this.reset();
    const base = path.join(await safePath(destination), 'HydraPersonalBackup');
    await safePath(base);
    let inspected = 0;
    const entries = async folder => { await safePath(folder); return fs.readdir(folder, { withFileTypes: true }).catch(missing); };
    for (const device of await entries(base)) {
      if (!device.isDirectory() || !id(device.name)) continue;
      for (const game of await entries(path.join(base, device.name))) {
        if (!game.isDirectory() || !/^[a-f0-9]{64}$/.test(game.name)) continue;
        const directory = path.join(base, device.name, game.name);
        let title = '', locations = {};
        // Display hint only, never trusted for selecting a game or destination.
        try { const sidecar = path.join(directory, '_INFO GAME.txt'); await safePath(sidecar); if ((await fs.stat(sidecar)).size > 1024 * 1024) throw new Error('Metadata terlalu besar.'); const text = await fs.readFile(sidecar, 'utf8'); title = text.match(/^Nama game: (.+)$/m)?.[1]?.trim() || ''; for (const line of text.split(/\r?\n/)) if (line.startsWith('- ')) { const location = line.slice(2); locations[digest(location).slice(0, 24)] = location; } } catch { /* optional sidecar */ }
        for (const version of await entries(directory)) {
          if (!version.isDirectory() || !id(version.name)) continue;
          if (++inspected > 5000) throw new Error('Terlalu banyak versi. Pilih folder backup yang lebih kecil.');
          const folder = path.join(directory, version.name);
          try {
            await safePath(folder);
            for (const name of ['manifest.json', 'COMPLETE']) { await safePath(path.join(folder, name)); if ((await fs.stat(path.join(folder, name))).size > 8 * 1024 ** 2) throw new Error('Metadata terlalu besar.'); }
            const bytes = await fs.readFile(path.join(folder, 'manifest.json'), 'utf8');
            const m = JSON.parse(bytes);
            if (digest(bytes) !== await fs.readFile(path.join(folder, 'COMPLETE'), 'utf8') || m.id !== version.name || m.deviceId !== device.name || typeof m.gameId !== 'string' || digest(m.gameId) !== game.name || !Number.isFinite(Date.parse(m.createdAt))) continue;
            const ownership = this.ownership(m);
            if (ownership === 'different') continue;
            this.sources.set(randomUUID(), { ownership, destination, deviceId: m.deviceId, gameId: m.gameId, versionId: m.id, signature: digest(bytes), createdAt: m.createdAt, title: title || m.gameId, locations });
          } catch { /* Incomplete versions are not selectable. Full validation follows selection. */ }
        }
      }
    }
    return this.snapshot();
  }
  async listCloud(cloud) {
    this.reset();
    cloud.assertBinding?.();
    if (!cloud.connected || !cloud.state.driveId) throw new Error('Hubungkan OneDrive terlebih dahulu.');
    const driveId = cloud.state.driveId;
    if (await cloud.provider.identity() !== driveId) throw new Error('Akun OneDrive berubah. Hubungkan ulang.');
    const items = await cloud.provider.listProfiles();
    if (!cloud.connected || cloud.state.driveId !== driveId) throw new Error('Akun OneDrive berubah.');
    for (const item of items) {
      if (this.sources.size >= 5000) throw new Error('Terlalu banyak versi cloud.');
      const bytes = await cloud.provider.download(item.name);
      if (bytes.length > BUNDLE_LIMIT || digest(bytes) !== item.name.slice(-68, -4)) continue;
      let manifest;
      try { manifest = bytes[0] === 0x1f ? (await unpackBundle(bytes)).manifest : readSharedIndex(bytes).manifest; }
      catch { continue; }
      if (!manifest || !Number.isFinite(Date.parse(manifest.createdAt))) continue;
      if (!item.name.startsWith(`${digest(manifest.gameId)}_${manifest.deviceId}_${manifest.id}_`)) continue;
      const ownership = this.ownership(manifest, driveId);
      if (ownership === 'different') continue;
      const library = await this.controller.getGames();
      const title = item.title === 'Backup lama' ? library.find(g => g.id === manifest.gameId)?.title || manifest.gameId : item.title;
      this.sources.set(randomUUID(), { ownership, gameId: manifest.gameId, cloud, driveId, name: item.name, deviceId: item.name.slice(65, 101), createdAt: manifest.createdAt, title: title || manifest.gameId, deviceName: item.device });
    }
    await this.checkCloud({ cloud, driveId });
    return this.snapshot();
  }
  async checkCloud(source) {
    const c = source.cloud;
    c.assertBinding?.();
    if (!c.connected || c.stopped || c.state.driveId !== source.driveId || await c.provider.identity() !== source.driveId) throw new Error('Akun OneDrive berubah. Muat ulang backup lama.');
  }
  async sourceValue(source) {
    if (source.cloud) {
      await this.checkCloud(source);
      const bytes = await source.cloud.provider.download(source.name);
      if (bytes.length > BUNDLE_LIMIT || digest(bytes) !== source.name.slice(-68, -4)) throw new Error('Integritas paket cloud gagal.');
      let value;
      if (bytes[0] === 0x1f) value = await unpackBundle(bytes);
      else {
        const { manifest } = readSharedIndex(bytes);
        if (!source.name.startsWith(`${digest(manifest.gameId)}_${manifest.deviceId}_${manifest.id}_`)) throw new Error('Identitas paket cloud tidak sesuai.');
        value = await materializeShared(bytes, (_, name) => source.cloud.provider.download(name));
      }
      if (!source.name.startsWith(`${digest(value.manifest.gameId)}_${value.manifest.deviceId}_${value.manifest.id}_`)) throw new Error('Identitas paket cloud tidak sesuai.');
      await this.checkCloud(source);
      return value;
    }
    const engine = new BackupEngine({ destination: source.destination, deviceId: source.deviceId, stateDirectory: this.controller.stateDirectory });
    const folder = path.join(engine.directory(source.gameId), source.versionId);
    await safePath(folder); await safePath(path.join(folder, 'manifest.json')); await safePath(path.join(folder, 'COMPLETE'));
    if ((await fs.stat(path.join(folder, 'manifest.json'))).size > 8 * 1024 ** 2 || digest(await fs.readFile(path.join(folder, 'manifest.json'))) !== source.signature) throw new Error('Backup sumber berubah. Muat ulang daftar.');
    const manifest = (await engine.versions(source.gameId, { fresh: true, versionId: source.versionId, skipRepair: true }))[0];
    if (!manifest) throw new Error('Backup sumber rusak atau tidak lengkap.');
    return { schema: 1, manifest: portableManifest(manifest), local: { folder, compressed: manifest.compressed ?? [] } };
  }
  async select(token, gameId) {
    this.selection = undefined;
    const source = this.sources.get(token), c = this.controller;
    const game = (await c.getGames()).find(g => g.id === gameId);
    if (!source || !game || !c.engine) throw new Error('Pilih sumber, game di pustaka, dan folder backup lokal terlebih dahulu.');
    const value = await this.sourceValue(source), m = value.manifest;
    if (!m || !id(m.deviceId) || typeof m.gameId !== 'string' || !Array.isArray(m.roots) || !m.roots.length || m.roots.length > 100) throw new Error('Metadata profil lama tidak valid.');
    // Validate foreign manifest BEFORE rewriting identity or fingerprint. Virtual
    // roots only validate relative paths; foreign absolute paths are never used.
    const ownership = this.ownership(m, source.cloud ? source.driveId : undefined);
    if (ownership === 'different') throw new Error('Backup bukan milik pasangan akun Hydra dan OneDrive aktif.');
    const sourceEngine = new BackupEngine({ destination: c.engine.destination, deviceId: m.deviceId, stateDirectory: c.stateDirectory });
    const virtual = m.roots.map((r, i) => ({ id: r.id, kind: r.kind, path: path.join(path.dirname(c.stateDirectory), `hydra-validation-${randomUUID()}`, String(i)) }));
    if (value.local) await validateManifest(sourceEngine, m.gameId, virtual, m, { local: true });
    else await validateValue(sourceEngine, m.gameId, virtual, value);
    this.selection = { token: randomUUID(), gameId, gameTitle: game.title, ownership, source, value: selectionValue(value), mapping: {}, engine: c.engine, config: JSON.stringify(c.state.games[gameId] ?? null) };
    return this.snapshot();
  }
  current(token) {
    const s = this.selection, c = this.controller;
    if (!s || s.token !== token || s.engine !== c.engine || s.config !== JSON.stringify(c.state.games[s.gameId] ?? null)) throw new Error('Pengaturan berubah. Pilih ulang backup lama.');
    return s;
  }
  async map(token, rootId, target) {
    const s = this.current(token);
    if (!s.value.manifest.roots.some(r => r.id === rootId)) throw new Error('Lokasi sumber tidak valid.');
    s.mapping[rootId] = await safePath(target);
    return this.snapshot();
  }
  async targets(token) {
    const s = this.current(token);
    const roots = [];
    for (const root of s.value.manifest.roots) {
      const target = s.mapping[root.id];
      if (!target) throw new Error('Pilih tujuan untuk setiap lokasi save.');
      await safePath(target);
      if (target === path.parse(target).root) throw new Error('Pilih lokasi save, bukan seluruh drive.');
      const info = await fs.lstat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (info && (root.kind === 'file' ? !info.isFile() : !info.isDirectory())) throw new Error('Jenis lokasi tujuan tidak sesuai backup.');
      roots.push({ id: digest(target).slice(0, 24), path: target, kind: root.kind });
    }
    await this.controller.engine.validate(roots);
    // Never allow recovery targets to contain or overwrite the source backup.
    const overlaps = (a, b) => { const relative = path.relative(a, b); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
    const protectedPaths = [this.controller.stateDirectory, ...(s.source.destination ? [path.join(path.resolve(s.source.destination), 'HydraPersonalBackup')] : [])];
    if (roots.some(r => protectedPaths.some(p => overlaps(r.path, p) || overlaps(p, r.path)))) throw new Error('Lokasi tujuan bertumpuk dengan backup sumber atau data modul.');
    if (!(await this.controller.getGames()).some(g => g.id === s.gameId)) throw new Error('Game tidak tersedia di pustaka.');
    return roots;
  }
  async importLocal(engine, roots, manifest, source) {
    await validateManifest(engine, manifest.gameId, roots, manifest, { local: true });
    const entries = [...new Map(manifest.files.map(f => [f.hash, f])).values()];
    const directory = engine.directory(manifest.gameId);
    await safePath(directory);
    await engine.requireSpace(engine.destination, entries.reduce((n, f) => n + f.bytes, 0));
    const stage = path.join(directory, `_profile-${randomUUID()}`);
    try {
      await fs.mkdir(path.join(stage, 'data'), { recursive: true });
      for (const entry of entries) {
        const original = path.join(source.folder, 'data', entry.hash);
        await safePath(original);
        await fs.copyFile(original, path.join(stage, 'data', entry.hash));
        await engine.verifyHistoryBlob(path.join(stage, 'data', entry.hash), entry, true, source.compressed.includes(entry.hash));
      }
      const local = { ...manifest, ...(source.compressed.length ? { schema: 2, compressed: source.compressed } : {}) };
      const bytes = JSON.stringify(local, null, 2);
      await fs.writeFile(path.join(stage, 'manifest.json'), bytes, { flag: 'wx' });
      await fs.writeFile(path.join(stage, 'COMPLETE'), digest(bytes), { flag: 'wx' });
      this.controller.assertAccount?.();
      await fs.rename(stage, path.join(directory, manifest.id));
      return manifest.id;
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  }
  async import(token, confirmedTargets, claimLegacy = false) {
    return this.controller.control(async () => {
      const s = this.current(token), c = this.controller;
      if (c.getAccount && s.ownership === 'legacy' && !claimLegacy) throw new Error('Backup lama belum memiliki pemilik. Konfirmasi penautan ke profil Hydra aktif diperlukan.');
      const roots = await this.targets(token);
      if (JSON.stringify(roots) !== confirmedTargets) throw new Error('Tujuan berubah setelah konfirmasi. Pilih ulang backup lama.');
      await c.engine.assertNoRecovery(s.gameId);
      if (s.source.cloud) await this.checkCloud(s.source);
      // Re-read source after dialogs, including full hashes and account checks.
      const value = await this.sourceValue(s.source);
      if (JSON.stringify(selectionValue(value)) !== JSON.stringify(s.value)) throw new Error('Backup sumber berubah. Pilih ulang versi.');
      const original = value.manifest;
      const map = new Map(original.roots.map((r, i) => [r.id, roots[i].id]));
      const manifest = { ...portableManifest(original), id: randomUUID(), deviceId: c.engine.deviceId, gameId: s.gameId, order: Date.now(), reason: 'profile-recovery',
        origin: { gameId: original.gameId, deviceId: original.deviceId, versionId: original.id, account: original.account ?? null, claimedLegacy: s.ownership === 'legacy' },
        ...(c.engine.account !== undefined ? { account: c.engine.account } : {}),
        roots: original.roots.map(r => ({ ...r, id: map.get(r.id) })), files: original.files.map(f => ({ ...f, rootId: map.get(f.rootId) })) };
      manifest.fingerprint = fingerprint(manifest);
      const versionId = value.local ? await this.importLocal(c.engine, roots, manifest, value.local) : await importVersion(c.engine, s.gameId, roots, { ...value, manifest });
      c.state.games[s.gameId] = { roots, mode: 'manual', title: s.gameTitle };
      await c.save();
      c.lastScan.delete(s.gameId);
      this.selection = undefined;
      return { gameId: s.gameId, versionId };
    }, 'profile-import', this.selection?.gameId);
  }
}
