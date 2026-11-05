// Synthetic fixture only; never opens real game saves or the user's cloud.
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { BackupEngine, makeRoots } from '../module/engine.mjs';

const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-storage-bench-'));
try {
  const save = path.join(root, 'save'); await fs.mkdir(save);
  const content = Buffer.from(JSON.stringify({ quests: Array.from({ length: 30000 }, (_, id) => ({ id, completed: id % 3 === 0, progress: 42, inventory: ['sword', 'shield', 'potion'] })) }));
  await fs.writeFile(path.join(save, 'progress.json'), content);
  await fs.writeFile(path.join(save, 'encrypted.sav'), randomBytes(512 * 1024));
  const roots = await makeRoots([{ path: save }]);
  const engine = new BackupEngine({ destination: path.join(root, 'backup'), deviceId: 'benchmark', stateDirectory: path.join(root, 'profile'), stableMs: 1 });
  let baseline = 0; const timings = [];
  for (let i = 0; i < 3; i++) {
    await fs.writeFile(path.join(save, 'slot.sav'), `level-${i}`);
    const started = performance.now();
    const version = await engine.backup('fixture:1', roots);
    timings.push(Math.round(performance.now() - started));
    baseline += [...new Map(version.files.map(f => [f.hash, f])).values()].reduce((n, f) => n + f.bytes, 0);
  }
  let dataBytes = 0, totalBytes = 0;
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else { const size = (await fs.stat(file)).size; totalBytes += size; if (path.basename(folder) === 'data') dataBytes += size; }
    }
  }
  await walk(engine.directory('fixture:1'));
  console.log(JSON.stringify({ fixture: 'Synthetic JSON save + 512 KiB random bytes, 3 versions', originalDataBytes: baseline, storedDataBytes: dataBytes, storedIncludingMetadataBytes: totalBytes, reductionPercent: Number((100 * (1 - dataBytes / baseline)).toFixed(2)), captureMilliseconds: timings, note: 'Timing includes scans and verification with a 1ms stability window; no comparison to the old runtime. Savings vary by game. Old versions are not rewritten.' }, null, 2));
} finally { await fs.rm(root, { recursive: true, force: true }); }
