import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { applyHydra } from '../scripts/apply-hydra.mjs';

const fixture = fileURLToPath(new URL('./fixtures/hydra-4.3.0', import.meta.url));
async function source(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(fixture, root, { recursive: true });
  return root;
}

test('integrasi diterapkan pada file asli tag 4.3.0 dan sumber asli dicadangkan', async t => {
  const root = await source(t);
  const result = await applyHydra(root);
  assert.equal(result.files, 23);
  assert.equal(await fs.readFile(path.join(root, '.personal-backup-originals/src/main/index.ts'), 'utf8'), await fs.readFile(path.join(fixture, 'src/main/index.ts'), 'utf8'));
  assert.match(await fs.readFile(path.join(root, 'src/main/services/process-watcher.ts'), 'utf8'), /if \(!options.isShutdown\) onPersonalBackupGameClosed\(game\)/);
  for (const file of ['engine.mjs', 'controller.mjs', 'ludusavi.mjs', 'controller.d.mts']) await fs.access(path.join(root, 'src/main/services/personal-cloud-backup/core', file));
  await assert.rejects(applyHydra(root), /File berbeda/);
});

test('sumber Hydra yang berubah ditolak sebelum menulis file apa pun', async t => {
  const root = await source(t);
  const file = path.join(root, 'src/main/index.ts');
  await fs.appendFile(file, '\n// user edit\n');
  await assert.rejects(applyHydra(root), /Tidak ada perubahan/);
  assert.match(await fs.readFile(file, 'utf8'), /user edit/);
  await assert.rejects(fs.access(path.join(root, '.personal-backup-originals')));
});

test('checkout Windows CRLF diterima dan sumber asli dipertahankan dalam cadangan', async t => {
  const root = await source(t);
  const metadata = JSON.parse(await fs.readFile(new URL('../integration/upstream.json', import.meta.url), 'utf8'));
  for (const file of Object.keys(metadata.files)) {
    const target = path.join(root, file);
    await fs.writeFile(target, (await fs.readFile(target, 'utf8')).replace(/\r?\n/g, '\r\n'));
  }
  const original = await fs.readFile(path.join(root, 'src/main/index.ts'), 'utf8');
  await applyHydra(root);
  assert.equal(await fs.readFile(path.join(root, '.personal-backup-originals/src/main/index.ts'), 'utf8'), original);
  assert.match(await fs.readFile(path.join(root, 'src/main/index.ts'), 'utf8'), /await startPersonalBackup/);
});

test('file tambahan milik pengguna tidak ditimpa oleh pemasang', async t => {
  const root = await source(t);
  const file = path.join(root, 'src/main/services/personal-cloud-backup/core/engine.mjs');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'user-owned-file');
  await assert.rejects(applyHydra(root), /sudah ada/);
  assert.equal(await fs.readFile(file, 'utf8'), 'user-owned-file');
  await assert.rejects(fs.access(path.join(root, '.personal-backup-originals')));
});
