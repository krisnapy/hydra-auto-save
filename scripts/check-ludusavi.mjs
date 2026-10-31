import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Ludusavi } from '../module/ludusavi.mjs';

const binary = path.resolve(process.argv[2]);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hydra-ludusavi-'));
try {
  const save = path.join(root, 'test-save.sav').replaceAll('\\', '/');
  const config = path.join(root, 'config');
  await fs.mkdir(config);
  await fs.writeFile(save, 'example progress');
  await fs.writeFile(path.join(config, 'manifest.yaml'), JSON.stringify({
    'Hydra Save Test': { steam: { id: 292030 }, files: { [save]: {} } }
  }));
  const args = ['--config', config, '--no-manifest-update', 'find', '--api', '--backup', '--steam-id', '292030'];
  // Reproduce the original failure against the real bundled CLI, not a mock.
  await assert.rejects(promisify(execFile)(binary, args, { timeout: 3000, windowsHide: true }), error => error.killed === true);
  console.log('Reproduced: an open stdin causes Steam ID lookup to time out.');
  const detector = new Ludusavi(binary, config);
  for (const game of [{ shop: 'steam', objectId: '292030' }, { title: 'Hydra Save Test' }]) {
    const found = await detector.discover(game);
    assert.equal(found.title, 'Hydra Save Test');
    assert.equal(found.selections.length, 1);
    assert.equal(path.resolve(found.selections[0].path).toLowerCase(), path.resolve(save).toLowerCase());
  }
  await assert.rejects(detector.discover({ shop: 'steam', objectId: '1245629' }), /Steam ID belum dikenali/);
  assert.equal(await fs.readFile(save, 'utf8'), 'example progress');
  console.log('Passed: real Ludusavi Steam ID lookup, exact title lookup, preview file discovery, and unknown-ID handling.');
  if (process.argv.includes('--live-manifest')) {
    const live = new Ludusavi(binary, path.join(root, 'live'));
    await live.updateManifest();
    for (const id of ['1245629', '292030', '3751260']) {
      try {
        const result = await live.invoke(['find', '--api', '--backup', '--steam-id', id]);
        console.log(`Live manifest Steam ${id}: ${JSON.stringify(Object.keys(result.games))}`);
      } catch (error) {
        if (!error.message.includes('Steam ID belum dikenali')) throw error;
        console.log(`Live manifest Steam ${id}: not recognized`);
      }
    }
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
