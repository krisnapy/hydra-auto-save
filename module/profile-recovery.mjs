import * as fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { accountMatch } from './backup-account.mjs';
import { BackupEngine, digest, safePath, portableManifest, overlappingPathIndices } from './engine.mjs';
import { unpackBundle, readSharedIndex, materializeShared, validateValue, validateManifest, importVersion, BUNDLE_LIMIT } from './cloud-bundle.mjs';

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !value.startsWith('_');
const MAX_PROFILE_ROOTS = 10_000;
const missing = error => { if (error.code === 'ENOENT') return []; throw error; };
const overlaps = (a, b) => {
  const contains = (parent, child) => {
    const relative = path.relative(parent, child);
    return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  return contains(a, b) || contains(b, a);
};
const fingerprint = m => digest(JSON.stringify({ roots: m.roots, files: m.files }));
// Keep only metadata between user steps, never a whole cloud save in memory.
const selectionValue = value => ({ schema: value.schema, manifest: value.manifest, ...(value.local ? { local: value.local } : {}) });
const mergeRoots = (configured, targets) => [...new Map([...configured, ...targets].map(root => [root.id, root])).values()];
const profileId = name => /^\d{1,20}$/.test(name);
const profileFileName = name => /^[a-z0-9_][a-z0-9_. -]*$/i.test(name) && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name);

export function assertWindowsProfileTarget(target, home) {
  const windows = path.win32;
  const relative = windows.relative(home, target);
  if (!relative) throw new Error('Pilih folder save game di dalam profil Windows aktif.');
  if (relative !== '..' && !relative.startsWith('..\\') && !windows.isAbsolute(relative)) return;

  const parts = target.slice(windows.parse(target).root.length).split('\\');
  const profileRoot = /^(users|documents and settings)$/i.test(parts[0]);
  const shared = parts.length > 2 && /^public$/i.test(parts[1]);
  if (profileRoot && !shared) throw new Error('Tujuan berada di luar profil Windows aktif. Pilih lokasi save yang digunakan game pada profil Windows ini.');
}

async function validateTarget(target, kind) {
  const resolved = await safePath(target);
  if (resolved === path.parse(resolved).root) throw new Error('Pilih lokasi save game di dalam drive.');
  if (process.platform === 'win32') assertWindowsProfileTarget(resolved, homedir());

  const folder = kind === 'file' ? path.dirname(resolved) : resolved;
  try {
    if (!(await fs.lstat(folder)).isDirectory()) throw new Error('Jenis lokasi tujuan tidak sesuai backup.');
    if (kind === 'file') {
      const info = await fs.lstat(resolved).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (info && !info.isFile()) throw new Error('Jenis lokasi tujuan tidak sesuai backup.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Folder save tujuan belum ada. Buka game pada profil Windows ini, buat save, lalu tutup game dan pilih lokasi lagi.');
  }
  return resolved;
}

function recoveryLocationKey(location) {
  // Keep the parent name, which can be the game account ID.
  const paths = path.win32;
  return [paths.basename(paths.dirname(location)), paths.basename(location)].join('/').toLowerCase();
}

// Each renderer-visible ID is an opaque, session-only capability. Paths, source
// manifests and account identity remain in the main process.
export class ProfileRecovery {
  constructor(controller, gameId) {
    this.controller = controller;
    this.gameId = gameId;
    this.reset();
  }
  ownership(manifest, driveId) {
    this.controller.assertAccount?.();
    if (!this.controller.getAccount) return 'legacy';
    return accountMatch(manifest.account, this.controller.hydraAccount, driveId);
  }
  snapshot() {
    this.controller.assertAccount?.();
    const visible = this.gameId ? this.sources.keys() : this.profiles.get(this.profileToken)?.sources ?? [];
    const sources = [...visible].map(token => {
      const { ownership, title, deviceId, createdAt, gameId, cloud } = this.sources.get(token);
      return { token, ownership, title, deviceId, createdAt, gameId, source: cloud ? 'onedrive' : 'local', restorable: this.library.has(gameId) };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const profiles = [...this.profiles].map(([token, { deviceId, name, source, createdAt, games }]) => (
      { token, deviceId, name, source, createdAt, gameCount: games.size }
    )).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { profiles, profileToken: this.profileToken, sources,
      selection: this.selection ? { token: this.selection.token, ownership: this.selection.ownership, gameId: this.selection.gameId, title: this.selection.source.title, targetTitle: this.selection.gameTitle, sourceGameId: this.selection.value.manifest.gameId, deviceId: this.selection.source.deviceId, createdAt: this.selection.value.manifest.createdAt,
        targetProfiles: this.selection.targetProfiles.map(({ token, name, folder }) => ({ token, name, folder })),
        roots: this.selection.rootSummaries.map(root => ({ ...root, target: this.selection.mapping[root.id] || '' })) } : null };
  }
  reset() {
    this.sources = new Map();
    this.library = new Map();
    this.profiles = new Map();
    this.profileToken = undefined;
    this.selection = undefined;
    return this.sources;
  }
  finishListing(scan, sources, library) {
    this.controller.assertAccount?.();
    if (this.sources !== scan) throw new Error('Pencarian backup sudah berubah.');
    this.library = library;
    this.sources = sources;
    if (!this.gameId) {
      const profiles = new Map();
      for (const [token, source] of sources) {
        let profile = profiles.get(source.deviceId);
        if (!profile) {
          profile = { deviceId: source.deviceId, name: '', source: source.cloud ? 'onedrive' : 'local', createdAt: source.createdAt, games: new Set(), sources: new Set() };
          profiles.set(source.deviceId, profile);
          this.profiles.set(randomUUID(), profile);
        }
        if (source.deviceName) profile.name = source.deviceName;
        if (source.createdAt > profile.createdAt) profile.createdAt = source.createdAt;
        profile.games.add(source.gameId);
        profile.sources.add(token);
      }
    }
    return this.snapshot();
  }
  details(token) {
    this.controller.assertAccount?.();
    if (this.gameId || (token !== undefined && !this.profiles.has(token))) throw new Error('Pilih ulang profil lama.');
    this.profileToken = token;
    this.selection = undefined;
    return this.snapshot();
  }
  visible(token) {
    return this.gameId ? this.sources.get(token)?.gameId === this.gameId : this.profiles.get(this.profileToken)?.sources.has(token);
  }
  async listLocal(destination) {
    const scan = this.reset(), sources = new Map();
    const library = new Map((await this.controller.getGames()).map(game => [game.id, game]));
    const gameHash = this.gameId && digest(this.gameId);
    const base = path.join(await safePath(destination), 'HydraPersonalBackup');
    await safePath(base);
    let inspected = 0;
    const entries = async folder => { await safePath(folder); return fs.readdir(folder, { withFileTypes: true }).catch(missing); };
    for (const device of await entries(base)) {
      if (!device.isDirectory() || !id(device.name) || (!this.gameId && device.name === this.controller.state.deviceId)) continue;
      for (const game of await entries(path.join(base, device.name))) {
        if (!game.isDirectory() || !/^[a-f0-9]{64}$/.test(game.name) || (gameHash && game.name !== gameHash)) continue;
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
            if (digest(bytes) !== await fs.readFile(path.join(folder, 'COMPLETE'), 'utf8') || m.id !== version.name || m.deviceId !== device.name || typeof m.gameId !== 'string' || digest(m.gameId) !== game.name || typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt))) continue;
            const ownership = this.ownership(m);
            if (ownership === 'different') continue;
            sources.set(randomUUID(), { ownership, destination, deviceId: m.deviceId, gameId: m.gameId, versionId: m.id, signature: digest(bytes), createdAt: m.createdAt, title: library.get(m.gameId)?.title || title || m.gameId, locations });
          } catch { /* Incomplete versions are not selectable. Full validation follows selection. */ }
        }
      }
    }
    return this.finishListing(scan, sources, library);
  }
  async listCloud(cloud) {
    const scan = this.reset(), sources = new Map();
    const library = new Map((await this.controller.getGames()).map(game => [game.id, game]));
    const gameHash = this.gameId && digest(this.gameId);
    cloud.assertBinding?.();
    if (!cloud.connected || !cloud.state.driveId) throw new Error('Hubungkan OneDrive terlebih dahulu.');
    const driveId = cloud.state.driveId;
    if (await cloud.provider.identity() !== driveId) throw new Error('Akun OneDrive berubah. Hubungkan ulang.');
    const items = await cloud.provider.listProfiles(gameHash);
    if (!cloud.connected || cloud.state.driveId !== driveId) throw new Error('Akun OneDrive berubah.');
    let inspected = 0;
    for (const item of items) {
      if (gameHash && !item.name.startsWith(`${gameHash}_`)) continue;
      if (++inspected > 5000) throw new Error('Terlalu banyak versi cloud.');
      const bytes = await cloud.provider.download(item.name);
      if (bytes.length > BUNDLE_LIMIT || digest(bytes) !== item.name.slice(-68, -4)) continue;
      let manifest;
      try { manifest = bytes[0] === 0x1f ? (await unpackBundle(bytes)).manifest : readSharedIndex(bytes).manifest; }
      catch { continue; }
      if (!manifest || typeof manifest.gameId !== 'string' || !id(manifest.deviceId) || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) continue;
      if (!item.name.startsWith(`${digest(manifest.gameId)}_${manifest.deviceId}_${manifest.id}_`)) continue;
      if (this.gameId ? manifest.gameId !== this.gameId : manifest.deviceId === this.controller.state.deviceId) continue;
      const ownership = this.ownership(manifest, driveId);
      if (ownership === 'different') continue;
      const title = library.get(manifest.gameId)?.title || (item.title === 'Backup lama' ? '' : item.title) || manifest.gameId;
      sources.set(randomUUID(), { ownership, gameId: manifest.gameId, cloud, driveId, name: item.name, deviceId: manifest.deviceId, createdAt: manifest.createdAt, title, deviceName: item.device?.replace(/ \[.*\]$/, '') });
    }
    await this.checkCloud({ cloud, driveId });
    return this.finishListing(scan, sources, library);
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
  async select(token) {
    const c = this.controller;
    c.assertAccount?.();
    this.selection = undefined;
    const source = this.visible(token) && this.sources.get(token);
    if (!source) throw new Error('Pilih sumber backup yang tersedia.');
    const { gameId } = source;
    const game = (await c.getGames()).find(g => g.id === gameId);
    if (!game || !c.engine) throw new Error('Game yang sama harus tersedia di pustaka dan folder backup lokal harus dipilih.');
    const value = await this.sourceValue(source), m = value.manifest;
    if (!m || !id(m.deviceId) || m.deviceId !== source.deviceId || m.gameId !== gameId) throw new Error('Identitas game atau perangkat pada backup profil lama tidak cocok.');
    if (!Array.isArray(m.roots) || !m.roots.length) throw new Error('Backup profil lama tidak mencatat lokasi save. Pilih versi backup lain.');
    if (m.roots.length > MAX_PROFILE_ROOTS) throw new Error(`Backup ini mencatat ${m.roots.length} lokasi save. Pemulihan mendukung hingga ${MAX_PROFILE_ROOTS} lokasi per versi.`);
    if (m.roots.some(root => !root || typeof root.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(root.id) || !['directory', 'file'].includes(root.kind))) {
      throw new Error('Jenis atau ID lokasi save pada backup profil lama tidak valid. Pilih versi backup lain.');
    }
    // Validate foreign manifest BEFORE rewriting identity or fingerprint. Virtual
    // roots only validate relative paths; foreign absolute paths are never used.
    const ownership = this.ownership(m, source.cloud ? source.driveId : undefined);
    if (ownership === 'different') throw new Error('Backup bukan milik pasangan akun Hydra dan OneDrive aktif.');
    const sourceEngine = new BackupEngine({ destination: c.engine.destination, deviceId: m.deviceId, stateDirectory: c.stateDirectory });
    const validationDirectory = path.join(path.dirname(c.stateDirectory), `hydra-validation-${randomUUID()}`);
    const virtual = m.roots.map((r, i) => ({ id: r.id, kind: r.kind, path: path.join(validationDirectory, String(i)) }));
    if (value.local) await validateManifest(sourceEngine, m.gameId, virtual, m, { local: true });
    else await validateValue(sourceEngine, m.gameId, virtual, value);
    const config = c.state.games[gameId];
    const rootSummaries = m.roots.map(root => ({ id: root.id, kind: root.kind, files: 0, samples: [], originalPath: source.locations?.[root.id] || '' }));
    const summariesById = new Map(rootSummaries.map(root => [root.id, root]));
    for (const file of m.files) {
      const summary = summariesById.get(file.rootId);
      summary.files++;
      if (summary.samples.length < 3) summary.samples.push(file.relative);
    }
    const selection = { token: randomUUID(), gameId, gameTitle: game.title, ownership, source, value: selectionValue(value), rootSummaries, engine: c.engine, config: JSON.stringify(config ?? null) };
    selection.mapping = await this.detectTargets(selection, config?.roots ?? []);
    selection.targetProfiles = await this.detectTargetProfiles(selection, config?.roots ?? []);
    if (selection.targetProfiles.length === 1) selection.mapping = selection.targetProfiles[0].mapping;
    if (!this.visible(token) || this.sources.get(token) !== source || selection.engine !== c.engine || selection.config !== JSON.stringify(c.state.games[gameId] ?? null)) {
      throw new Error('Pengaturan berubah. Pilih ulang backup lama.');
    }
    this.selection = selection;
    return this.snapshot();
  }
  async detectTargetProfiles(selection, configured) {
    const manifest = selection.value.manifest;
    const windows = path.win32;
    const pathsById = new Map(configured.map(root => [root.id, root.path]));
    const sourceFiles = manifest.roots.map(root => ({ ...root, location: selection.source.locations?.[root.id] ?? pathsById.get(root.id) }));
    if (sourceFiles.some(root => root.kind !== 'file' || !root.location)) return [];
    const accountFiles = sourceFiles.filter(root => profileId(windows.basename(windows.dirname(root.location))));
    const sourceFolder = accountFiles[0] && windows.dirname(accountFiles[0].location);
    if (!sourceFolder || accountFiles.some(root => windows.dirname(root.location).toLowerCase() !== sourceFolder.toLowerCase())) return [];
    const names = accountFiles.map(root => windows.basename(root.location));
    const sourceGameFolder = windows.dirname(sourceFolder);
    const gameFolder = windows.basename(sourceGameFolder).toLowerCase();
    const shared = sourceFiles.filter(root => !accountFiles.includes(root));
    if (!sourceFiles.every(root => profileFileName(windows.basename(root.location))) ||
      shared.some(root => windows.dirname(root.location).toLowerCase() !== sourceGameFolder.toLowerCase())) return [];

    // A current profile must be anchored by a configured save that still exists.
    const profiles = new Map();
    const pathKey = location => process.platform === 'win32' ? location.toLowerCase() : location;
    const configuredPaths = new Map(configured.map(root => [pathKey(root.path), root.path]));
    const filenames = new Set(names.map(pathKey));
    for (const root of configured) {
      const folder = path.dirname(root.path);
      const name = path.basename(folder);
      const file = path.basename(root.path);
      if (root.kind !== 'file' || !profileId(name) || path.basename(path.dirname(folder)).toLowerCase() !== gameFolder ||
        !filenames.has(pathKey(file))) continue;
      const stat = await fs.lstat(root.path).catch(() => null);
      if (stat?.isFile()) profiles.set(folder, { name, folder });
    }

    const choices = [];
    for (const profile of profiles.values()) {
      const mapping = Object.fromEntries(sourceFiles.map(root => {
        const folder = shared.includes(root) ? path.dirname(profile.folder) : profile.folder;
        const target = path.join(folder, windows.basename(root.location));
        return [root.id, configuredPaths.get(pathKey(target)) ?? target];
      }));
      try {
        const roots = await this.validateMapping(selection, mapping);
        await selection.engine.validate(mergeRoots(configured, roots));
        choices.push({ ...profile, token: randomUUID(), mapping });
      } catch {
        // Unsafe or incompatible layouts remain available through manual mapping.
      }
    }
    return choices.sort((a, b) => a.name.localeCompare(b.name));
  }
  async detectTargets(selection, configured) {
    const proposals = [];
    const byId = new Map(configured.map(root => [root.id, root]));
    const byLocation = new Map();
    for (const root of configured) {
      const key = `${root.kind}:${recoveryLocationKey(root.path)}`;
      const candidates = byLocation.get(key) ?? [];
      candidates.push(root);
      byLocation.set(key, candidates);
    }
    for (const root of selection.value.manifest.roots) {
      const original = selection.source.locations?.[root.id];
      const possible = new Set(original ? byLocation.get(`${root.kind}:${recoveryLocationKey(original)}`) : []);
      const exact = byId.get(root.id);
      if (exact?.kind === root.kind) possible.add(exact);
      if (possible.size !== 1) continue;
      const [candidate] = possible;
      try {
        // Automatic matches need an existing save. Manual recovery can create a missing file.
        await fs.lstat(candidate.path);
        const target = await validateTarget(candidate.path, root.kind);
        await selection.engine.validate([{ ...candidate, path: target }]);
        this.assertTargetProtection(selection, [target]);
        proposals.push({ id: root.id, target });
      } catch {
        // Stale or unsafe configured locations require manual selection.
      }
    }
    const conflicts = overlappingPathIndices(proposals.map(proposal => proposal.target));
    return Object.fromEntries(proposals.filter((_, index) => !conflicts.has(index)).map(({ id, target }) => [id, target]));
  }
  current(token) {
    const s = this.selection, c = this.controller;
    if (!s || s.token !== token || s.engine !== c.engine || s.config !== JSON.stringify(c.state.games[s.gameId] ?? null)) throw new Error('Pengaturan berubah. Pilih ulang backup lama.');
    return s;
  }
  forkForRestore(token) {
    const selection = this.current(token);
    const { gameId, gameTitle, source, ownership } = selection;
    const recovery = new ProfileRecovery(this.controller, gameId);
    const sourceToken = randomUUID();
    recovery.sources.set(sourceToken, source);
    recovery.selection = { ...selection, mapping: selection.targetProfiles.length ? selection.mapping : { ...selection.mapping } };
    return { recovery, sourceToken, gameId, title: gameTitle, claimLegacy: ownership === 'legacy' };
  }
  async map(token, rootId, target) {
    const s = this.current(token);
    if (s.targetProfiles.length) throw new Error('Pilih profil save sebagai tujuan pemulihan.');
    const root = s.value.manifest.roots.find(r => r.id === rootId);
    if (!root) throw new Error('Lokasi sumber tidak valid.');
    const resolved = await validateTarget(target, root.kind);
    this.current(token).mapping[rootId] = resolved;
    return this.snapshot();
  }
  chooseTargetProfile(token, profileToken) {
    const selection = this.current(token);
    const profile = selection.targetProfiles.find(choice => choice.token === profileToken);
    if (!profile) throw new Error('Pilih profil tujuan yang tersedia.');
    selection.mapping = profile.mapping;
  }
  async targets(token) {
    const s = this.current(token);
    if (s.targetProfiles.length > 1 && !s.targetProfiles.some(profile => profile.mapping === s.mapping)) {
      throw new Error('Pilih profil save sebagai tujuan pemulihan.');
    }
    const roots = await this.validateMapping(s, s.mapping);
    if (!(await this.controller.getGames()).some(g => g.id === s.gameId)) throw new Error('Game tidak tersedia di pustaka.');
    return roots;
  }
  async validateMapping(s, mapping) {
    const roots = [];
    for (const root of s.value.manifest.roots) {
      const target = mapping[root.id];
      if (!target) throw new Error('Pilih tujuan untuk setiap lokasi save.');
      await validateTarget(target, root.kind);
      roots.push({ id: digest(target).slice(0, 24), path: target, kind: root.kind });
    }
    await s.engine.validate(roots);
    this.assertTargetProtection(s, roots.map(root => root.path));
    return roots;
  }
  assertTargetProtection(selection, targets) {
    // Never allow recovery targets to contain or overwrite the source backup.
    const source = selection.source.destination;
    const protectedPaths = [this.controller.stateDirectory, ...(source ? [path.join(path.resolve(source), 'HydraPersonalBackup')] : [])];
    if (targets.some(target => protectedPaths.some(p => overlaps(target, p)))) throw new Error('Lokasi tujuan bertumpuk dengan backup sumber atau data modul.');
    const otherRoots = Object.entries(this.controller.state.games).flatMap(([gameId, config]) => gameId === selection.gameId ? [] : config.roots);
    if (targets.some(target => otherRoots.some(other => overlaps(target, other.path)))) throw new Error('Lokasi tujuan bertumpuk dengan lokasi save game lain.');
  }
  async importLocal(engine, roots, manifest, source, signal) {
    await validateManifest(engine, manifest.gameId, roots, manifest, { local: true });
    const entries = [...new Map(manifest.files.map(f => [f.hash, f])).values()];
    const directory = engine.directory(manifest.gameId);
    await safePath(directory);
    await engine.requireSpace(engine.destination, entries.reduce((n, f) => n + f.bytes, 0));
    const stage = path.join(directory, `_profile-${randomUUID()}`);
    try {
      await fs.mkdir(path.join(stage, 'data'), { recursive: true });
      for (const entry of entries) {
        signal?.throwIfAborted();
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
      signal?.throwIfAborted();
      await fs.rename(stage, path.join(directory, manifest.id));
      return manifest.id;
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  }
  async import(token, confirmedTargets, claimLegacy = false, { restore = false, signal, onCommit } = {}) {
    const gameId = this.current(token).gameId;
    return this.controller.control(async () => {
      signal?.throwIfAborted();
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
      const scoped = s.targetProfiles.length > 0;
      const current = c.state.games[s.gameId];
      const configured = scoped ? mergeRoots(current.roots, roots) : roots;
      await c.engine.validate(configured);
      const map = new Map(original.roots.map((r, i) => [r.id, roots[i].id]));
      const manifest = { ...portableManifest(original), id: randomUUID(), deviceId: c.engine.deviceId, gameId: s.gameId, order: Date.now(), reason: 'profile-recovery', scoped,
        origin: { gameId: original.gameId, deviceId: original.deviceId, versionId: original.id, account: original.account ?? null, claimedLegacy: s.ownership === 'legacy' },
        ...(c.engine.account !== undefined ? { account: c.engine.account } : {}),
        roots: original.roots.map(r => ({ ...r, id: map.get(r.id) })), files: original.files.map(f => ({ ...f, rootId: map.get(f.rootId) })) };
      manifest.fingerprint = fingerprint(manifest);
      signal?.throwIfAborted();
      const versionId = value.local ? await this.importLocal(c.engine, roots, manifest, value.local, signal) : await importVersion(c.engine, s.gameId, roots, { ...value, manifest }, { signal });
      c.state.games[s.gameId] = { roots: configured, mode: scoped ? current.mode : 'manual', title: s.gameTitle };
      await c.save();
      c.lastScan.delete(s.gameId);
      this.selection = undefined;
      if (restore) await c.restoreInternal(s.gameId, versionId, true, { signal, onCommit });
      return { gameId: s.gameId, versionId };
    }, restore ? 'restore' : 'profile-import', gameId);
  }
}
