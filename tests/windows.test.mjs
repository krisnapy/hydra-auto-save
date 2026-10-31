import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareWindows } from '../scripts/prepare-windows.mjs';

const fixture = fileURLToPath(new URL('./fixtures/hydra-4.3.0', import.meta.url));
async function source(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-windows-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(fixture, root, { recursive: true });
  return root;
}

test('Windows build keeps the local renderer and disables official update installation', async t => {
  const root = await source(t);
  await prepareWindows(root);
  const manager = await fs.readFile(path.join(root, 'src/main/services/update-manager.ts'), 'utf8');
  const restart = await fs.readFile(path.join(root, 'src/main/events/autoupdater/restart-and-install-update.ts'), 'utf8');
  assert.match(manager, /async checkForUpdates\(\) \{\s+return false;/);
  assert.match(restart, /restartAndInstallUpdate = \(\) => \{\s+return;/);
  await fs.access(path.join(root, 'personal-backup-builder.cjs'));
  await fs.access(path.join(root, 'Personal-Backup-README.md'));
  await fs.access(path.join(root, 'src/main/services/personal-cloud-backup/core/engine.mjs'));
});

test('unknown updater source stops Windows preparation before integration writes', async t => {
  const root = await source(t);
  await fs.writeFile(path.join(root, 'src/main/services/update-manager.ts'), '// incompatible');
  await assert.rejects(prepareWindows(root), /tidak cocok/);
  await assert.rejects(fs.access(path.join(root, '.personal-backup-originals')));
});
