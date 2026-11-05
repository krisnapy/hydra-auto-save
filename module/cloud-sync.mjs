import * as fs from 'node:fs/promises';
import path from 'node:path';
import { OneDrive, validClientId, cloudName, DEFAULT_CLIENT_ID } from './onedrive.mjs';
import { packVersion, importVersion, validateBundle } from './cloud-bundle.mjs';
import { atomicJson, digest, safePath } from './engine.mjs';

// Persistent outbox owns a copy of each package, independent of local retention.
// Remote cleanup is explicit, previewed and confirmed; never automatic.
export class CloudSync {
  constructor({ directory, controller, vault, fetcher }) {
    Object.assign(this, { directory, controller, vault, fetcher });
    this.error = ''; this.remote = new Map(); this.stopped = false;
  }
  async init() {
    await safePath(this.directory);
    await fs.mkdir(this.directory, { recursive: true });
    this.file = path.join(this.directory, 'cloud.json');
    await safePath(this.file);
    try { this.state = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Pengaturan OneDrive rusak; data dipertahankan.'); this.state = { clientId: '', driveId: '', jobs: [] }; }
    if (!Array.isArray(this.state.jobs) || this.state.jobs.length > 1200 || this.state.jobs.some(job => !cloudName(job.name) || typeof job.driveId !== 'string' || !job.driveId || typeof job.gameId !== 'string' || !Number.isSafeInteger(job.bytes) || job.bytes < 0 || !Number.isFinite(job.nextAt) || !Number.isSafeInteger(job.attempts) || job.attempts < 0)) throw new Error('Antrean cloud tidak valid.');
    this.state.clientId ||= DEFAULT_CLIENT_ID;
    this.provider = new OneDrive({ clientId: this.state.clientId, loadTokens: () => this.vault.load(), saveTokens: value => this.vault.save(value), fetcher: this.fetcher });
    this.connected = Boolean(await this.vault.load());
    if (this.connected) this.startTimer();
    return this;
  }
  startTimer() {
    if (!this.timer && !this.stopped) { this.timer = setInterval(() => void this.tick().catch(() => {}), 5000); this.timer.unref?.(); }
  }
  save() {
    this.saving = (this.saving ?? Promise.resolve()).catch(() => {}).then(() => atomicJson(this.file, this.state));
    return this.saving;
  }
  snapshot(gameId) {
    const jobs = this.state.jobs.filter(j => (!gameId || j.gameId === gameId) && j.driveId === this.state.driveId);
    return { provider: 'onedrive', clientId: this.state.clientId, connected: this.connected, login: this.login ? { userCode: this.login.userCode, expiresAt: this.login.expiresAt, url: this.login.url } : null,
      pending: jobs.filter(j => !j.uploadedAt).length, uploaded: jobs.filter(j => j.uploadedAt).length,
      uploading: jobs.some(j => j.name === this.uploading), error: this.error, lastUploadedAt: jobs.filter(j => j.uploadedAt).map(j => j.uploadedAt).sort().at(-1),
      versions: this.remote.get(gameId)?.map(item => ({ name: item.name, modifiedAt: item.lastModifiedDateTime, size: item.size })) ?? [] };
  }
  async begin(clientId) {
    if (this.connected || this.login || this.job || this.loginJob) throw new Error('Putuskan koneksi atau batalkan login sebelumnya terlebih dahulu.');
    if (!validClientId(clientId)) throw new Error('Application (client) ID tidak valid.');
    // Serialize before the first await, including device-code creation.
    this.loginJob = (async () => {
      await this.vault.save(null);
      this.state.clientId = clientId; this.provider.clientId = clientId;
      await this.save();
      this.error = '';
      this.login = await this.provider.beginLogin(); this.nextLoginAt = Date.now() + this.login.interval; this.startTimer();
    })().finally(() => { this.loginJob = undefined; });
    await this.loginJob;
  }
  async disconnect() {
    // Drain existing network work before removing credentials. No late refresh can resurrect them.
    this.stopped = true; clearInterval(this.timer); this.timer = undefined;
    await this.loginJob?.catch(() => {}); await this.job?.catch(() => {}); await this.maintenanceJob?.catch(() => {});
    this.login = null; this.connected = false; this.remote.clear();
    await this.vault.save(null); this.error = ''; this.stopped = false;
  }
  packageFile(job) { return path.join(this.directory, `${digest(`${job.driveId}:${job.name}`)}.hpb`); }
  async enqueue(engine, gameId, versionId) {
    if (!this.state.driveId || !this.connected) return;
    const driveId = this.state.driveId;
    // Check before reading/repacking saves. Uploaded receipts and pending jobs
    // both already own this immutable version for this account.
    const prefix = `${digest(gameId)}_${engine.deviceId}_${versionId}_`;
    if (this.state.jobs.some(j => j.driveId === driveId && j.gameId === gameId && j.name.startsWith(prefix))) return;
    const bytes = await packVersion(engine, gameId, versionId);
    if (!this.connected || this.stopped || this.state.driveId !== driveId) throw new Error('Koneksi OneDrive berubah selama persiapan. Coba unggah ulang dari riwayat lokal.');
    const name = `${digest(gameId)}_${engine.deviceId}_${versionId}_${digest(bytes)}.hpb`;
    if (this.state.jobs.some(j => j.name === name && j.driveId === this.state.driveId)) return;
    const pending = this.state.jobs.filter(j => !j.uploadedAt);
    if (pending.length >= 1000) throw new Error('Antrean OneDrive penuh (1.000 versi). Backup lokal tetap tersedia.');
    const total = pending.reduce((n, j) => n + j.bytes, 0);
    if (total + bytes.length > 512 * 1024 ** 2) throw new Error('Antrean OneDrive mencapai batas 512 MiB. Backup lokal tetap berjalan.');
    const file = this.packageFile({ driveId: this.state.driveId, name });
    await safePath(file);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    this.state.jobs.push({ name, gameId, driveId: this.state.driveId, bytes: bytes.length, attempts: 0, nextAt: 0 });
    await this.save();
  }
  async backupCompleted(engine, gameId, manifest) {
    if (!manifest) return;
    try { await this.enqueue(engine, gameId, manifest.id); }
    catch (error) { this.error = error.message; }
  }
  tick() {
    if (this.job || this.stopped || this.loginJob || this.maintenanceJob) return this.job ?? Promise.resolve();
    this.job = this.run().catch(error => { this.error = error.message; }).finally(() => { this.job = undefined; if (!this.connected && !this.login) { clearInterval(this.timer); this.timer = undefined; } });
    return this.job;
  }
  async run() {
    if (this.login) {
      if (Date.now() >= this.login.expiresAt) { this.login = null; throw new Error('Kode login Microsoft kedaluwarsa. Mulai login kembali.'); }
      if (Date.now() < this.nextLoginAt) return;
      try {
        await this.provider.completeLogin(this.login.code);
        const driveId = await this.provider.identity();
        // Jobs remain bound to their original drive. Connecting another account never uploads them.
        this.state.driveId = driveId; this.connected = true; this.login = null; this.error = ''; await this.save();
      } catch (error) {
        if (error.code === 'authorization_pending' || error.code === 'slow_down') {
          if (error.code === 'slow_down') this.login.interval += 5000;
          this.nextLoginAt = Date.now() + this.login.interval; return;
        }
        this.login = null; this.connected = false; await this.vault.save(null); throw error;
      }
      return;
    }
    if (!this.connected) return;
    const job = this.state.jobs.find(j => !j.uploadedAt && j.driveId === this.state.driveId && j.nextAt <= Date.now());
    if (!job) return;
    this.uploading = job.name;
    try {
      if (await this.provider.identity() !== job.driveId) throw new Error('Akun OneDrive berbeda. Unggahan dihentikan untuk melindungi data.');
      const file = this.packageFile(job); await safePath(file);
      const bytes = await fs.readFile(file);
      if (bytes.length !== job.bytes || digest(bytes) !== job.name.slice(-68, -4)) throw new Error('Paket antrean rusak. Buat ulang dari riwayat backup lokal.');
      await this.provider.upload(job.name, bytes);
      job.uploadedAt = new Date().toISOString(); this.error = '';
      await this.save();
      await fs.rm(file, { force: true });
      const receipts = this.state.jobs.filter(j => j.uploadedAt).slice(-200);
      this.state.jobs = this.state.jobs.filter(j => !j.uploadedAt || receipts.includes(j));
      await this.save();
    } catch (error) {
      job.attempts++; job.nextAt = Date.now() + Math.max(error.retryAfter || 0, Math.min(300000, 5000 * 2 ** Math.min(job.attempts, 6)));
      await this.save(); throw error;
    } finally { this.uploading = undefined; }
  }
  async sync(gameId) {
    if (!this.connected) throw new Error('Hubungkan OneDrive terlebih dahulu.');
    await this.controller.control(async () => {
      const engine = this.controller.engine;
      if (!engine) throw new Error('Pilih folder backup lokal terlebih dahulu.');
      const games = gameId ? [gameId] : Object.keys(this.controller.state.games);
      for (const id of games) {
        const latest = (await engine.versions(id)).find(v => !v.safety);
        if (latest) await this.enqueue(engine, id, latest.id);
      }
    }, 'cloud-queue', gameId);
    this.error = '';
    for (const j of this.state.jobs) if (j.driveId === this.state.driveId && !j.uploadedAt) j.nextAt = 0;
    await this.save(); void this.tick();
  }
  async list(gameId) {
    if (!this.connected) throw new Error('Hubungkan OneDrive terlebih dahulu.');
    const prefix = `${digest(gameId)}_${this.controller.state.deviceId}_`;
    const versions = await this.provider.list(prefix);
    this.remote.set(gameId, versions.sort((a, b) => b.name.localeCompare(a.name)));
  }
  async download(gameId, name) {
    if (!this.connected || !this.remote.get(gameId)?.some(v => v.name === name)) throw new Error('Muat ulang daftar versi cloud sebelum mengunduh.');
    await this.controller.control(async () => {
      const engine = this.controller.engine, roots = this.controller.state.games[gameId]?.roots;
      if (!engine || !roots?.length) throw new Error('Atur folder backup dan lokasi save terlebih dahulu.');
      const bytes = await this.provider.download(name);
      if (digest(bytes) !== name.slice(-68, -4)) throw new Error('Integritas paket cloud gagal.');
      await importVersion(engine, gameId, roots, bytes);
    }, 'cloud-download', gameId);
  }
  maintenance(action, kind, gameId) {
    if (this.maintenanceJob) return Promise.reject(new Error('Optimisasi OneDrive masih berjalan.'));
    this.maintenanceJob = (async () => {
      await this.job;
      if (!this.connected || this.stopped) throw new Error('Hubungkan OneDrive terlebih dahulu.');
      return this.controller.control(action, kind, gameId);
    })().finally(() => { this.maintenanceJob = undefined; });
    return this.maintenanceJob;
  }
  async optimizationPlan(gameId) {
    const engine = this.controller.engine;
    if (!engine || !this.connected || this.stopped || !this.state.driveId) throw new Error('Hubungkan OneDrive dan pilih folder backup lokal terlebih dahulu.');
    const driveId = this.state.driveId;
    if (await this.provider.identity() !== driveId) throw new Error('Akun OneDrive berubah. Optimisasi dibatalkan.');
    const ids = gameId ? [gameId] : Object.keys(this.controller.state.games).sort();
    const signature = [], candidates = [], seen = new Set();
    let protectedCount = 0;
    const inventories = [];
    for (const id of ids) {
      const roots = this.controller.state.games[id]?.roots;
      if (!roots?.length) throw new Error('Lokasi save game belum diatur.');
      const prefix = `${digest(id)}_${engine.deviceId}_`;
      const items = await this.provider.list(prefix);
      inventories.push({ id, roots, prefix, items });
    }
    const total = inventories.reduce((n, group) => n + group.items.length, 0);
    let inspected = 0;
    for (const { id, roots, prefix, items } of inventories) {
      const normal = new Map();
      for (const item of items) {
        this.controller.progress?.(gameId, 'optimization-inspecting', inspected++, total);
        if (this.stopped || !this.connected || this.state.driveId !== driveId) throw new Error('Koneksi berubah. Optimisasi dibatalkan.');
        // Treat provider output as untrusted even when a test/provider wrapper
        // returns files outside the requested device/game prefix.
        if (!cloudName(item.name) || !item.name.startsWith(prefix)) continue;
        if (seen.has(item.name)) throw new Error('Daftar cloud memuat versi ganda. Periksa ulang sebelum optimisasi.');
        seen.add(item.name);
        signature.push([item.name, item.size, item.eTag]);
        if (!Number.isSafeInteger(item.size) || item.size < 0 || typeof item.eTag !== 'string' || !item.eTag || item.eTag.length > 1000 || /[\r\n]/.test(item.eTag) || this.state.jobs.some(j => !j.uploadedAt && j.driveId === driveId && j.name === item.name)) { protectedCount++; continue; }
        const bytes = await this.provider.download(item.name);
        if (bytes.length !== item.size || digest(bytes) !== item.name.slice(-68, -4)) { protectedCount++; continue; }
        let manifest;
        try { manifest = (await validateBundle(engine, id, roots, bytes)).manifest; }
        catch { protectedCount++; continue; }
        if (!item.name.startsWith(`${prefix}${manifest.id}_`) || manifest.safety) { protectedCount++; continue; }
        const group = normal.get(manifest.id) ?? [];
        // Retain only a small verified summary, not thousands of file entries
        // or decoded save bytes for every version in a large cloud history.
        group.push({ name: item.name, size: item.size, eTag: item.eTag, manifest: { id: manifest.id, order: manifest.order, createdAt: manifest.createdAt, identity: digest(JSON.stringify(manifest)) } });
        normal.set(manifest.id, group);
      }
      const groups = [...normal.values()].sort((a, b) => b[0].manifest.order - a[0].manifest.order || b[0].manifest.createdAt.localeCompare(a[0].manifest.createdAt) || b[0].manifest.id.localeCompare(a[0].manifest.id));
      for (const group of groups.slice(engine.retention)) {
        // Conflicting packages with the same version identity are preserved.
        if (group.some(item => item.manifest.identity !== group[0].manifest.identity)) { protectedCount += group.length; continue; }
        candidates.push(...group.map(({ name, eTag, size }) => ({ name, eTag, size })));
      }
    }
    this.controller.progress?.(gameId, 'optimization-inspecting', inspected, total);
    signature.sort((a, b) => a[0].localeCompare(b[0]));
    candidates.sort((a, b) => a.name.localeCompare(b.name));
    const context = this.optimizationContext(gameId);
    return { token: digest(JSON.stringify({ driveId, context, signature, candidates })), context, signature, retention: engine.retention, driveId, candidates, remove: candidates.length, removableBytes: candidates.reduce((n, item) => n + item.size, 0), protectedCount };
  }
  optimizationContext(gameId) {
    const engine = this.controller.engine;
    return digest(JSON.stringify({ gameId, driveId: this.state.driveId, deviceId: engine?.deviceId, destination: engine?.destination, retention: engine?.retention, games: Object.entries(this.controller.state.games).filter(([id]) => !gameId || id === gameId).sort(([a], [b]) => a.localeCompare(b)).map(([id, config]) => [id, config.roots]) }));
  }
  planOptimization(gameId) {
    return this.maintenance(async () => {
      const plan = await this.optimizationPlan(gameId);
      this.optimizationPreview = { ...plan, expiresAt: Date.now() + 5 * 60000 };
      return plan;
    }, 'cloud-optimize-scan', gameId);
  }
  optimize(token, gameId) {
    return this.maintenance(async () => {
      const plan = this.optimizationPreview;
      this.optimizationPreview = undefined;
      const stale = () => new Error('Riwayat OneDrive berubah atau pemeriksaan kedaluwarsa. Tekan optimalkan lagi untuk melihat ringkasan terbaru.');
      if (!plan || plan.token !== token || plan.expiresAt < Date.now() || plan.context !== this.optimizationContext(gameId)) throw stale();
      if (plan.candidates.some(item => this.state.jobs.some(j => !j.uploadedAt && j.driveId === plan.driveId && j.name === item.name))) throw stale();
      if (await this.provider.identity() !== plan.driveId) throw stale();
      // Download and validate once during preview. Recheck the complete remote
      // inventory and ETags here, then use If-Match at each deletion boundary.
      const signature = [];
      for (const id of gameId ? [gameId] : Object.keys(this.controller.state.games).sort()) {
        const prefix = `${digest(id)}_${this.controller.engine.deviceId}_`;
        for (const item of await this.provider.list(prefix)) if (cloudName(item.name) && item.name.startsWith(prefix)) signature.push([item.name, item.size, item.eTag]);
      }
      signature.sort((a, b) => a[0].localeCompare(b[0]));
      if (JSON.stringify(signature) !== JSON.stringify(plan.signature)) throw stale();
      let removed = 0, savedBytes = 0;
      try {
        for (const item of plan.candidates) {
          this.controller.progress?.(gameId, 'optimization-cleaning', removed, plan.remove);
          if (this.stopped || !this.connected || this.state.driveId !== plan.driveId || await this.provider.identity() !== plan.driveId) throw new Error('Akun atau koneksi berubah. Pembersihan dihentikan.');
          await this.provider.remove(item.name, item.eTag);
          removed++; savedBytes += item.size;
          this.state.jobs = this.state.jobs.filter(j => !(j.uploadedAt && j.driveId === plan.driveId && j.name === item.name));
          await this.save();
        }
      } catch (error) {
        throw new Error(`${error.message} ${removed} versi sudah dipindahkan ke Recycle Bin; sisanya dipertahankan. Periksa ulang sebelum mencoba lagi.`);
      } finally { this.remote.clear(); }
      this.controller.progress?.(gameId, 'optimization-cleaning', removed, plan.remove);
      return { removed, savedBytes, detail: `Optimisasi cloud selesai: ${removed} versi lama (${(savedBytes / 1024 ** 2).toFixed(2)} MiB) dipindahkan ke Recycle Bin OneDrive. Kuota tersedia mengikuti pembaruan OneDrive.` };
    }, 'cloud-optimize', gameId);
  }
  async stop() { clearInterval(this.timer); this.stopped = true; await this.loginJob?.catch(() => {}); await this.job?.catch(() => {}); await this.maintenanceJob?.catch(() => {}); await this.saving; }
}
