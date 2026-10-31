import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackupEngine, atomicJson, makeRoots, safePath } from './engine.mjs';
import { Ludusavi } from './ludusavi.mjs';

export class BackupController {
  constructor({ stateDirectory, getGames, assertStopped, onError = () => {}, stableMs = 1200, pollMs = 5000 }) {
    Object.assign(this, { stateDirectory, getGames, assertStopped, onError, stableMs, pollMs });
    this.active = false;
    this.inFlight = null;
    this.engine = null;
    this.lastDiscovery = new Map();
    this.status = new Map();
    this.operations = new Map();
    this.gameResults = new Map();
    this.pendingControls = 0;
  }
  async init() {
    this.file = path.join(this.stateDirectory, 'settings.json');
    try { this.state = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Pengaturan backup rusak; file dipertahankan untuk pemeriksaan.');
      this.state = { enabled: false, destination: '', ludusavi: '', deviceId: randomUUID(), retention: 10, games: {}, activity: [] };
      await this.save();
    }
    if (!this.state || typeof this.state.games !== 'object' || !Array.isArray(this.state.activity)) throw new Error('Format pengaturan backup tidak valid.');
    this.rebuild();
    return this;
  }
  rebuild() {
    this.engine = this.state.destination ? new BackupEngine({ destination: this.state.destination, deviceId: this.state.deviceId, stateDirectory: this.stateDirectory, retention: this.state.retention, stableMs: this.stableMs, assertStopped: this.assertStopped, onStatus: (id, status, detail) => this.setStatus(id, status, detail), onProgress: (id, phase, completed, total) => this.progress(id, phase, completed, total) }) : null;
  }
  setStatus(id, status, detail) {
    this.status.set(id, { status, detail });
    if (['complete', 'failed'].includes(status) && [...this.operations.values()].some(item => item.gameId === id && item.kind === 'automatic')) {
      this.rememberOperation({ kind: 'automatic', gameId: id, status, detail, at: new Date().toISOString() });
    }
    const last = this.state.activity.find(item => item.gameId === id);
    if (status !== 'preparing' && status !== 'waiting' && (status === 'complete' || status === 'restored' || !last || last.status !== status || last.detail !== (detail ?? ''))) {
      this.state.activity.unshift({ at: new Date().toISOString(), gameId: id, status, detail: detail ?? '' });
      this.state.activity = this.state.activity.slice(0, 100);
    }
  }
  save() {
    // Serialize persistence so concurrent game jobs cannot publish older settings.
    this.saving = (this.saving ?? Promise.resolve()).catch(() => {}).then(() => atomicJson(this.file, this.state));
    return this.saving;
  }
  rememberOperation(result) {
    this.lastOperation = result;
    if (result.gameId) this.gameResults.set(result.gameId, result);
  }
  operation(kind, gameId, phase = 'queued') {
    const id = randomUUID();
    const now = new Date().toISOString();
    const operation = { id, kind, gameId, title: this.state.games[gameId]?.title ?? gameId, phase, startedAt: now, updatedAt: now };
    this.operations.set(id, operation);
    return operation;
  }
  progress(gameId, phase, completed, total) {
    const operation = [...this.operations.values()].find(item => item.gameId === gameId && item.phase !== 'queued');
    if (operation) Object.assign(operation, { phase, completed, total, updatedAt: new Date().toISOString() });
  }
  async control(action, kind = 'settings', gameId) {
    if (this.stopping) throw new Error('Hydra sedang ditutup.');
    const operation = this.operation(kind, gameId);
    this.pendingControls++;
    const previous = this.controlTail ?? Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      // Stop the automatic loop at the next game boundary, then drain existing work.
      await this.tickJob?.catch(() => {});
      await this.engine?.idle();
      this.pendingControls--;
      this.controlJob = job;
      operation.phase = 'preparing';
      operation.updatedAt = new Date().toISOString();
      try {
        const result = await action();
        this.rememberOperation({ kind, gameId, status: 'complete', at: new Date().toISOString(), detail: kind === 'backup' && !result ? 'Isi save tidak berubah; tidak membuat versi baru.' : undefined });
        return result;
      } catch (error) {
        this.rememberOperation({ kind, gameId, status: 'failed', at: new Date().toISOString(), detail: error.message });
        throw error;
      } finally {
        this.operations.delete(operation.id);
        this.controlJob = undefined;
      }
    });
    this.controlTail = job;
    return job;
  }
  configure(values) {
    // Let users stop future backups while an existing operation drains safely.
    if (values.enabled === false && values.destination === undefined && values.ludusavi === undefined && (values.retention === undefined || values.retention === this.state.retention)) {
      this.state.enabled = false;
      return this.save();
    }
    return this.control(() => this.configureInternal(values));
  }
  async configureInternal(values) {
    const next = { ...this.state };
    if (typeof values.enabled === 'boolean') next.enabled = values.enabled;
    if (values.destination !== undefined) next.destination = await safePath(values.destination);
    if (values.ludusavi !== undefined) next.ludusavi = values.ludusavi ? await safePath(values.ludusavi) : '';
    if (values.retention !== undefined) {
      if (!Number.isInteger(values.retention) || values.retention < 1 || values.retention > 100) throw new Error('Riwayat harus 1–100 versi.');
      next.retention = values.retention;
    }
    if (next.enabled && !next.destination) throw new Error('Pilih folder backup terlebih dahulu.');
    const candidate = next.destination ? new BackupEngine({ destination: next.destination, deviceId: next.deviceId, stateDirectory: this.stateDirectory, retention: next.retention }) : null;
    for (const game of Object.values(next.games)) if (game.roots.length) await candidate?.validate(game.roots);
    if (next.destination) {
      await fs.mkdir(next.destination, { recursive: true });
      const probe = path.join(next.destination, `.hydra-write-check-${randomUUID()}`);
      await fs.writeFile(probe, '', { flag: 'wx' });
      await fs.rm(probe);
    }
    this.state = next;
    this.rebuild();
    await this.save();
  }
  manual(gameId, selections) { return this.control(() => this.manualInternal(gameId, selections), 'manual', gameId); }
  async manualInternal(gameId, selections) {
    const games = await this.getGames();
    if (!games.some(game => game.id === gameId)) throw new Error('Game tidak tersedia di pustaka.');
    const roots = await makeRoots(selections);
    if (this.engine) await this.engine.validate(roots);
    this.state.games[gameId] = { roots, mode: 'manual' };
    this.status.set(gameId, { status: 'waiting' });
    await this.save();
  }
  async discover(game) {
    if (!this.state.ludusavi) throw new Error('Pilih ludusavi.exe atau atur lokasi save manual.');
    this.progress(game.id, 'detecting');
    const detector = new Ludusavi(this.state.ludusavi, path.join(this.stateDirectory, 'ludusavi'));
    try { await fs.access(path.join(this.stateDirectory, 'ludusavi', 'manifest.yaml')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.progress(game.id, 'manifest');
      await detector.updateManifest();
      this.progress(game.id, 'detecting');
    }
    const found = await detector.discover(game);
    const fresh = await makeRoots(found.selections);
    // Preserve known missing files so deletions remain visible to change detection.
    const previous = this.state.games[game.id]?.mode === 'automatic' ? this.state.games[game.id].roots : [];
    const roots = [...new Map([...previous, ...fresh].map(root => [root.id, root])).values()].sort((a, b) => a.id.localeCompare(b.id));
    if (this.engine) await this.engine.validate(roots);
    this.state.games[game.id] = { roots, mode: 'automatic', title: found.title };
    this.lastDiscovery.set(game.id, Date.now());
    this.status.set(game.id, { status: 'waiting' });
    await this.save();
  }
  detect(gameId) {
    return this.control(async () => {
      const game = (await this.getGames()).find(game => game.id === gameId);
      if (!game) throw new Error('Game tidak tersedia di pustaka.');
      try { await this.discover(game); }
      catch (error) {
        this.setStatus(gameId, 'setup', error.message);
        await this.save();
        throw error;
      }
    }, 'detect', gameId);
  }
  updateManifest() {
    return this.control(async () => {
      if (!this.state.ludusavi) throw new Error('Pilih ludusavi.exe terlebih dahulu.');
      this.progress(undefined, 'manifest');
      await new Ludusavi(this.state.ludusavi, path.join(this.stateDirectory, 'ludusavi')).updateManifest();
      this.lastDiscovery.clear();
    }, 'manifest');
  }
  backup(gameId, reason = 'manual') {
    return this.control(() => this.backupInternal(gameId, reason), 'backup', gameId);
  }
  async backupInternal(gameId, reason) {
    if (!this.engine) throw new Error('Pilih folder backup terlebih dahulu.');
    const config = this.state.games[gameId];
    if (!config?.roots.length) throw new Error('Perlu pengaturan lokasi save.');
    try { return await this.engine.backup(gameId, config.roots, { reason }); }
    catch (error) { this.setStatus(gameId, 'failed', error.message); throw error; }
    finally { await this.save(); }
  }
  restore(gameId, versionId, confirmed) {
    return this.control(() => this.restoreInternal(gameId, versionId, confirmed), 'restore', gameId);
  }
  async restoreInternal(gameId, versionId, confirmed) {
    if (!this.engine) throw new Error('Pilih folder backup terlebih dahulu.');
    if (!this.state.games[gameId]) throw new Error('Perlu pengaturan lokasi save.');
    try { return await this.engine.restore(gameId, this.state.games[gameId].roots, versionId, confirmed); }
    catch (error) { this.setStatus(gameId, 'failed', error.message); throw error; }
    finally { await this.save(); }
  }
  tick() {
    if (this.tickJob || this.pendingControls || this.controlJob || this.stopping || !this.state.enabled || !this.engine) return this.tickJob ?? Promise.resolve();
    this.tickJob = this.runTick().finally(() => { this.tickJob = undefined; });
    return this.tickJob;
  }
  async runTick() {
    this.active = true;
    try {
      for (const game of await this.getGames()) {
        if (!this.state.enabled || this.stopping || this.pendingControls) break;
        if (this.engine.busy(game.id)) continue;
        const operation = this.operation('automatic', game.id, 'preparing');
        operation.title = game.title;
        try {
          const config = this.state.games[game.id];
          if ((!config || config.mode === 'automatic') && Date.now() - (this.lastDiscovery.get(game.id) ?? 0) > 60000) {
            // Throttle unavailable detectors as well as successful scans.
            this.lastDiscovery.set(game.id, Date.now());
            await this.discover(game);
          }
          if (this.state.enabled && !this.stopping && this.state.games[game.id]?.roots.length) await this.backupInternal(game.id, 'save-change');
        } catch (error) {
          if (!this.status.get(game.id) || this.status.get(game.id).status !== 'failed') this.setStatus(game.id, 'setup', error.message);
          this.rememberOperation({ kind: 'automatic', gameId: game.id, status: 'failed', at: new Date().toISOString(), detail: error.message });
          this.onError(error);
        } finally { this.operations.delete(operation.id); }
      }
    } finally { this.active = false; await this.save(); }
  }
  start() {
    if (this.timer) return;
    this.stopping = false;
    const run = () => {
      if (this.inFlight) return;
      this.inFlight = this.tick().catch(this.onError).finally(() => { this.inFlight = null; });
    };
    this.timer = setInterval(run, this.pollMs);
    this.timer.unref?.();
    run();
  }
  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
    await this.controlTail?.catch(() => {});
    await this.engine?.idle();
    await this.saving;
  }
  async snapshot(gameId, lightweight = false) {
    const game = this.state.games[gameId];
    const versions = this.engine && gameId && !lightweight ? await this.engine.versions(gameId) : [];
    return { operations: [...this.operations.values()].map(item => ({ ...item })), lastOperation: gameId ? this.gameResults.get(gameId) : this.lastOperation, enabled: this.state.enabled, destination: this.state.destination, ludusavi: this.state.ludusavi, retention: this.state.retention, deviceId: this.state.deviceId, status: this.status.get(gameId) ?? { status: game?.roots.length ? 'waiting' : 'setup' }, roots: game?.roots ?? [], versions: versions.map(({ id, createdAt, reason, safety, files }) => ({ id, createdAt, reason, safety, files: files.length })), activity: this.state.activity.filter(item => !gameId || item.gameId === gameId) };
  }
}
