const restoring = new Set();
const launching = new Map();

export function onTrackedGameClosed(gameId) {
  if (Number.isFinite(launching.get(gameId))) launching.delete(gameId);
}

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
  if (restoring.has(gameId)) throw new Error('Pemulihan lain sedang berjalan. Tunggu lalu coba lagi.');
  if ((launching.get(gameId) ?? 0) > Date.now()) throw Object.assign(new Error('Game sedang dibuka. Tunggu lalu coba lagi.'), { code: 'GAME_LAUNCHING' });
  restoring.add(gameId);
  try { return await restore(); }
  finally { restoring.delete(gameId); }
}
