import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BackupController } from '../module/controller.mjs';
import { BackupEngine, digest } from '../module/engine.mjs';
import { writeBackupCatalog } from '../module/backup-catalog.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-catalog-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'backups');
  const engine = new BackupEngine({ destination, deviceId: 'pc-one', stateDirectory: path.join(root, 'state') });
  return { root, destination, engine };
}

test('catalog labels games with identical titles without renaming folders, and skips unchanged writes', async t => {
  const { destination, engine } = await fixture(t);
  const games = [
    { id: 'steam:1', title: 'Game 日本語', roots: [{ path: 'C:\\Saves\\first' }] },
    { id: 'custom:2', title: 'Game 日本語', roots: [{ path: 'C:\\Saves\\second' }] },
    { id: 'steam:missing', title: 'No backup yet' },
  ];
  for (const game of games.slice(0, 2)) await fs.mkdir(engine.directory(game.id), { recursive: true });
  await writeBackupCatalog(engine, games);
  const index = path.join(destination, 'DAFTAR GAME - pc-one.txt');
  const content = await fs.readFile(index, 'utf8');
  for (const game of games.slice(0, 2)) {
    assert.ok(content.includes(game.id));
    assert.ok(content.includes(digest(game.id)));
    const description = await fs.readFile(path.join(engine.directory(game.id), '_INFO GAME.txt'), 'utf8');
    assert.ok(description.includes(game.title));
    assert.ok(description.includes(game.roots[0].path));
  }
  assert.ok(!content.includes('No backup yet'));
  const fixed = new Date('2025-01-01T00:00:00Z');
  await fs.utimes(index, fixed, fixed);
  await writeBackupCatalog(engine, games);
  assert.equal((await fs.stat(index)).mtimeMs, fixed.getTime());
});

test('existing backups gain descriptions on restart; manifests, versions and restoration remain compatible', async t => {
  const { root, destination } = await fixture(t);
  const save = path.join(root, 'progress.sav');
  await fs.writeFile(save, 'saved progress');
  const errors = [];
  const options = { stateDirectory: path.join(root, 'profile'), stableMs: 1, assertStopped: async () => {}, getGames: async () => [{ id: 'steam:1', title: 'Elden Ring' }], onError: error => errors.push(error) };
  const controller = await new BackupController(options).init();
  await controller.configure({ destination });
  await controller.manual('steam:1', [{ path: save }]);
  const version = await controller.backup('steam:1');
  const folder = controller.engine.directory('steam:1');
  const manifestFile = path.join(folder, version.id, 'manifest.json');
  const manifest = await fs.readFile(manifestFile, 'utf8');
  await fs.rm(path.join(folder, '_INFO GAME.txt'));
  // Simulate settings created before titles were retained for manual saves.
  delete controller.state.games['steam:1'].title;
  await controller.save(); await controller.stop();
  const restarted = await new BackupController(options).init();
  assert.match(await fs.readFile(path.join(folder, '_INFO GAME.txt'), 'utf8'), /Elden Ring/);
  assert.equal(restarted.state.games['steam:1'].title, 'Elden Ring');
  assert.equal(await fs.readFile(manifestFile, 'utf8'), manifest);
  assert.equal(await restarted.backup('steam:1'), null);
  assert.equal((await restarted.engine.versions('steam:1')).length, 1);
  await fs.writeFile(save, 'later progress');
  await restarted.restore('steam:1', version.id, true);
  assert.equal(await fs.readFile(save, 'utf8'), 'saved progress');
  await restarted.stop();
  assert.deepEqual(errors, []);
});

test('descriptions reject symlinks and cannot turn a game title into a path', async t => {
  const { root, engine } = await fixture(t);
  const folder = engine.directory('steam:1');
  await fs.mkdir(folder, { recursive: true });
  await writeBackupCatalog(engine, [{ id: 'steam:1', title: '../outside\nInjected', roots: [] }]);
  const info = path.join(folder, '_INFO GAME.txt');
  assert.match(await fs.readFile(info, 'utf8'), /Nama game: \.\.\/outside Injected\r\n/);
  const outside = path.join(root, 'outside.txt');
  await fs.writeFile(outside, 'keep');
  await fs.rm(info);
  // Windows CI may lack symbolic-link privileges; junctions are available there.
  if (process.platform === 'win32') {
    const target = path.join(root, 'outside-folder');
    await fs.mkdir(target);
    await fs.symlink(target, info, 'junction');
  } else await fs.symlink(outside, info);
  await assert.rejects(writeBackupCatalog(engine, [{ id: 'steam:1', title: 'Changed' }]), /Tautan/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
});
