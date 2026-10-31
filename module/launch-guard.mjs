const restoring = new Set();
const launching = new Map();

export async function withLaunchGate(gameId, launch) {
  if (restoring.has(gameId)) throw new Error('Pemulihan save sedang berjalan. Tunggu sebelum membuka game.');
  if (launching.get(gameId) === Infinity) throw new Error('Game sedang disiapkan untuk dibuka.');
  launching.set(gameId, Infinity);
  try { return await launch(); }
  finally {
    launching.set(gameId, Date.now() + 30000);
    const timer = setTimeout(() => {
      if ((launching.get(gameId) ?? Infinity) <= Date.now()) launching.delete(gameId);
    }, 30050);
    timer.unref?.();
  }
}

export async function withRestoreGate(gameId, restore) {
  if (restoring.has(gameId) || (launching.get(gameId) ?? 0) > Date.now()) throw new Error('Game sedang dibuka atau pemulihan lain berjalan. Tunggu lalu coba lagi.');
  restoring.add(gameId);
  try { return await restore(); }
  finally { restoring.delete(gameId); }
}
