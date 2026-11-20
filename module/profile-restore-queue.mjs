import { randomUUID } from 'node:crypto';

const terminal = new Set(['complete', 'failed', 'cancelled']);

// Wait for the existing game-close event; no background game or disk polling.
export class ProfileRestoreQueue {
  constructor(controller, assertStopped, restore) {
    this.controller = controller;
    this.assertStopped = assertStopped;
    this.restore = restore;
    this.jobs = new Map();
  }
  snapshot(gameId) {
    this.controller.assertAccount();
    return [...this.jobs.values()].filter(job => !gameId || job.gameId === gameId)
      .map(({ id, gameId, title, status, detail, targetProfiles }) => ({ id, gameId, title, status, detail, targetProfiles }));
  }
  enqueue(recovery, token, confirmedTargets) {
    this.controller.assertAccount();
    const task = recovery.forkForRestore(token);
    const existing = this.jobs.get(task.gameId);
    if (this.stopped || existing && (!terminal.has(existing.status) || existing.inFlight)) throw new Error('Masih ada pemulihan untuk game ini.');
    const job = { ...task, id: randomUUID(), token, confirmedTargets, status: 'checking', abort: new AbortController() };
    this.jobs.set(job.gameId, job);
    this.start(job);
  }
  find(id, gameId) {
    this.controller.assertAccount();
    const job = [...this.jobs.values()].find(job => job.id === id && (!gameId || job.gameId === gameId));
    if (!job) throw new Error('Antrean pemulihan sudah berubah.');
    return job;
  }
  cancel(id, gameId) {
    const job = this.find(id, gameId);
    if (terminal.has(job.status) || job.status === 'finishing') throw new Error('Pemulihan ini sudah tidak dapat dibatalkan.');
    job.abort.abort();
    job.status = 'cancelled';
    job.detail = undefined;
    job.targetProfiles = undefined;
    if (!job.inFlight) job.recovery = undefined;
  }
  choose(id, profileToken, gameId) {
    const job = this.find(id, gameId);
    if (job.status !== 'choose') throw new Error('Pilihan profil tujuan sudah berubah.');
    job.recovery.chooseTargetProfile(job.token, profileToken);
    job.picked = true;
    this.start(job);
  }
  gameClosed(gameId) {
    const job = this.jobs.get(gameId);
    if (!job || terminal.has(job.status)) return;
    if (job.inFlight) {
      job.closedWhileChecking = true;
      return job.inFlight;
    }
    else if (job.status === 'waiting' || job.status === 'needs-location') return this.start(job);
  }
  start(job) {
    if (this.stopped || job.inFlight) return job.inFlight;
    job.status = 'checking';
    job.detail = undefined;
    job.inFlight = this.run(job).finally(() => {
      job.inFlight = undefined;
      const closed = job.closedWhileChecking;
      job.closedWhileChecking = false;
      if (closed && (job.status === 'waiting' || job.status === 'needs-location')) return this.start(job);
      if (terminal.has(job.status)) {
        job.recovery = undefined;
        job.targetProfiles = undefined;
      }
    });
    return job.inFlight;
  }
  async run(job) {
    const signal = job.abort.signal;
    try {
      await this.assertStopped(job.gameId);
      signal.throwIfAborted();
      if (job.picked || job.confirmedTargets) {
        job.confirmedTargets ??= JSON.stringify(await job.recovery.targets(job.token));
      } else {
        const config = this.controller.state.games[job.gameId];
        if (config?.mode !== 'manual') {
          try { await this.controller.detect(job.gameId); }
          catch (error) {
            signal.throwIfAborted();
            job.status = 'waiting';
            job.detail = error.message;
            return;
          }
        }
        signal.throwIfAborted();
        const { selection } = await job.recovery.select(job.sourceToken);
        signal.throwIfAborted();
        job.token = selection.token;
        job.targetProfiles = selection.targetProfiles;
        if (selection.targetProfiles.length > 1) { job.status = 'choose'; return; }
        if (selection.roots.some(root => !root.target)) {
          job.status = this.controller.state.games[job.gameId]?.roots.length ? 'needs-location' : 'waiting';
          return;
        }
        job.confirmedTargets = JSON.stringify(await job.recovery.targets(job.token));
      }
      signal.throwIfAborted();
      job.status = 'restoring';
      await this.restore(job, { signal, onCommit: () => { job.status = 'finishing'; } });
      job.status = 'complete';
    } catch (error) {
      if (signal.aborted) job.status = 'cancelled';
      else if ((error.code === 'GAME_RUNNING' && job.status === 'checking') || error.code === 'GAME_LAUNCHING') job.status = 'waiting';
      else { job.status = 'failed'; job.detail = error.message; }
    }
  }
  async stop() {
    this.stopped = true;
    for (const job of this.jobs.values()) if (job.status !== 'finishing') job.abort.abort();
    await Promise.all([...this.jobs.values()].map(job => job.inFlight));
    this.jobs.clear();
  }
}
