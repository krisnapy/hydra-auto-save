import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BackupEngine, makeRoots, digest } from '../module/engine.mjs';
import { setTimeout as delay } from 'node:timers/promises';

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-backup-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const save = path.join(directory, 'save');
  await fs.mkdir(save);
  await fs.writeFile(path.join(save, 'progress.sav'), 'level-1');
  const roots = await makeRoots([{ path: save }]);
  const engine = new BackupEngine({ destination: path.join(directory, 'cloud'), deviceId: 'pc-one', stateDirectory: path.join(directory, 'state'), stableMs: 3, assertStopped: async () => {}, ...options });
  return { directory, save, roots, engine, file: path.join(save, 'progress.sav') };
}

test('backup lengkap, deduplikasi isi dan perubahan dengan ukuran sama', async t => {
  const { engine, roots, file } = await fixture(t);
  const first = await engine.backup('steam:1', roots);
  assert.equal((await engine.versions('steam:1')).length, 1);
  assert.equal(await engine.backup('steam:1', roots), null);
  await fs.writeFile(file, 'level-2');
  const second = await engine.backup('steam:1', roots);
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal((await engine.versions('steam:1')).length, 2);
});

test('save berubah selama masa stabil tidak menghasilkan versi', async t => {
  const { engine, roots, file } = await fixture(t, { stableMs: 80 });
  const pending = engine.backup('steam:1', roots);
  await delay(25);
  await fs.writeFile(file, 'still-writing');
  await assert.rejects(pending, /masih berubah/);
  assert.equal((await engine.versions('steam:1')).length, 0);
});

test('perubahan di tengah copy membatalkan versi dan mempertahankan versi lama', async t => {
  const { engine, roots, file } = await fixture(t);
  await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'level-2');
  const scan = engine.scan.bind(engine);
  let count = 0;
  engine.scan = async (...args) => {
    if (++count === 3) await fs.writeFile(file, 'level-3');
    return scan(...args);
  };
  await assert.rejects(engine.backup('steam:1', roots), /selama penyalinan/);
  assert.equal((await engine.versions('steam:1')).length, 1);
});

test('folder pending dan backup cloud yang belum lengkap disembunyikan', async t => {
  const { engine, roots } = await fixture(t);
  const version = await engine.backup('steam:1', roots);
  const folder = path.join(engine.directory('steam:1'), version.id);
  await fs.mkdir(path.join(engine.directory('steam:1'), '_pending-orphan'));
  await fs.rm(path.join(folder, 'data', version.files[0].hash));
  assert.deepEqual(await engine.versions('steam:1'), []);
  await assert.rejects(engine.restore('steam:1', roots, version.id, true), /belum lengkap/);
});

test('file korup dan manifest korup ditolak', async t => {
  const { engine, roots } = await fixture(t);
  const version = await engine.backup('steam:1', roots);
  const folder = path.join(engine.directory('steam:1'), version.id);
  await fs.writeFile(path.join(folder, 'data', version.files[0].hash), 'corrupt');
  assert.deepEqual(await engine.versions('steam:1'), []);
  await fs.writeFile(path.join(folder, 'manifest.json'), '{}');
  assert.deepEqual(await engine.versions('steam:1'), []);
});

test('retensi hanya memangkas versi perangkat sendiri setelah berhasil', async t => {
  const { engine, roots, file } = await fixture(t, { retention: 2 });
  const other = new BackupEngine({ ...engine, deviceId: 'pc-two' });
  await other.backup('steam:1', roots);
  for (const value of ['one', 'two', 'three']) {
    await fs.writeFile(file, value);
    await engine.backup('steam:1', roots);
  }
  assert.equal((await engine.versions('steam:1')).length, 2);
  assert.equal((await other.versions('steam:1')).length, 1);
});

test('pemulihan membuat backup pengaman dan mengganti keseluruhan folder terpilih', async t => {
  const { engine, roots, file, save } = await fixture(t, { retention: 1 });
  const first = await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'newer-progress');
  await fs.writeFile(path.join(save, 'extra.sav'), 'extra');
  const result = await engine.restore('steam:1', roots, first.id, true);
  assert.equal(await fs.readFile(file, 'utf8'), 'level-1');
  await assert.rejects(fs.access(path.join(save, 'extra.sav')));
  const safety = (await engine.versions('steam:1')).find(version => version.id === result.safety);
  assert.equal(safety.safety, true);
  assert.equal(safety.files.length, 2);
  await engine.restore('steam:1', roots, safety.id, true);
  assert.equal(await fs.readFile(file, 'utf8'), 'newer-progress');
  assert.equal(await fs.readFile(path.join(save, 'extra.sav'), 'utf8'), 'extra');
});

test('tanpa konfirmasi dan game berjalan memblokir pemulihan', async t => {
  const { engine, roots, file } = await fixture(t);
  const first = await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'keep-this');
  await assert.rejects(engine.restore('steam:1', roots, first.id, false), /konfirmasi/);
  engine.assertStopped = async () => { throw new Error('Game berjalan'); };
  await assert.rejects(engine.restore('steam:1', roots, first.id, true), /Game berjalan/);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep-this');
});

test('gagal backup pengaman tidak menyentuh save saat ini', async t => {
  const { engine, roots, file } = await fixture(t);
  const first = await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'keep-this');
  engine.capture = async () => { throw new Error('Ruang habis'); };
  await assert.rejects(engine.restore('steam:1', roots, first.id, true), /Ruang habis/);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep-this');
});

test('rollback lintas lokasi saat proses game muncul di tengah pemulihan', async t => {
  const { engine, file, save } = await fixture(t);
  const file2 = path.join(save, 'second.sav');
  await fs.writeFile(file2, 'second-old');
  const roots = await makeRoots([{ path: file }, { path: file2 }]);
  const first = await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'first-new');
  await fs.writeFile(file2, 'second-new');
  let checks = 0;
  engine.assertStopped = async () => { if (++checks === 4) throw new Error('Game dibuka dari luar'); };
  await assert.rejects(engine.restore('steam:1', roots, first.id, true), /dibuka dari luar/);
  assert.equal(await fs.readFile(file, 'utf8'), 'first-new');
  assert.equal(await fs.readFile(file2, 'utf8'), 'second-new');
});

test('backup gagal bila cloud tidak dapat ditulis, versi lama tetap ada', async t => {
  const { engine, roots, file } = await fixture(t, { retention: 1 });
  await engine.backup('steam:1', roots);
  const old = engine.directory('steam:1');
  await fs.writeFile(file, 'new');
  const blocked = path.join(engine.destination, 'not-a-directory');
  await fs.writeFile(blocked, 'blocked');
  engine.directory = () => path.join(blocked, 'cannot-write');
  await assert.rejects(engine.backup('steam:1', roots));
  engine.directory = () => old;
  assert.equal((await engine.versions('steam:1')).length, 1);
});

test('lokasi backup bertumpuk dengan save dan symlink ditolak', async t => {
  const { engine, roots, save, directory } = await fixture(t);
  engine.destination = path.join(save, 'backups');
  await assert.rejects(engine.backup('steam:1', roots), /terpisah/);
  await fs.symlink(save, path.join(directory, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(makeRoots([{ path: path.join(directory, 'link') }]), /Tautan/);
});

test('metadata path traversal tidak menulis di luar save', async t => {
  const { engine, roots, directory } = await fixture(t);
  const version = await engine.backup('steam:1', roots);
  version.files[0].relative = '../escape.sav';
  const bytes = JSON.stringify(version);
  const folder = path.join(engine.directory('steam:1'), version.id);
  await fs.writeFile(path.join(folder, 'manifest.json'), bytes);
  await fs.writeFile(path.join(folder, 'COMPLETE'), digest(bytes));
  await assert.rejects(engine.restore('steam:1', roots, version.id, true), /tidak aman/);
  await assert.rejects(fs.access(path.join(directory, 'escape.sav')));
});

test('operasi per game tidak berjalan bersamaan', async t => {
  const { engine, roots } = await fixture(t, { stableMs: 30 });
  const first = engine.backup('steam:1', roots);
  await assert.rejects(engine.backup('steam:1', roots), /masih berjalan/);
  await first;
});

test('pemulihan diblokir setelah terdeteksi journal pemulihan terputus', async t => {
  const { engine, roots } = await fixture(t);
  const version = await engine.backup('steam:1', roots);
  await fs.mkdir(engine.stateDirectory, { recursive: true });
  await fs.writeFile(path.join(engine.stateDirectory, `${digest('steam:1')}-restore.json`), '{}');
  await assert.rejects(engine.restore('steam:1', roots, version.id, true), /sebelumnya terputus/);
});

test('slot save baru dapat dihapus saat kembali ke versi sebelum slot dibuat', async t => {
  const { engine, save, file } = await fixture(t);
  const original = await makeRoots([{ path: file }]);
  const version = await engine.backup('steam:1', original);
  const slot2 = path.join(save, 'slot2.sav');
  await fs.writeFile(slot2, 'second-slot');
  const expanded = await makeRoots([{ path: file }, { path: slot2 }]);
  await engine.restore('steam:1', expanded, version.id, true);
  await assert.rejects(fs.access(slot2));
  assert.equal(await fs.readFile(file, 'utf8'), 'level-1');
});

test('slot yang hilang dicatat dan dapat dipulihkan', async t => {
  const { engine, save, file } = await fixture(t);
  const slot2 = path.join(save, 'slot2.sav');
  await fs.writeFile(slot2, 'old-second-slot');
  const roots = await makeRoots([{ path: file }, { path: slot2 }]);
  await engine.backup('steam:1', roots);
  await fs.rm(slot2);
  const deleted = await engine.backup('steam:1', roots);
  await fs.writeFile(slot2, 'created-again');
  await engine.restore('steam:1', roots, deleted.id, true);
  await assert.rejects(fs.access(slot2));
});

test('path Windows dengan trailing space atau nama perangkat ditolak', async t => {
  const { engine, roots } = await fixture(t);
  for (const relative of ['.. /outside.sav', 'CON/progress.sav', 'valid/name.']) {
    assert.throws(() => engine.source(roots, { rootId: roots[0].id, relative, hash: 'a'.repeat(64) }), /tidak aman/);
  }
});

test('tahap dan jumlah file dilaporkan untuk backup, backup pengaman, dan pemulihan', async t => {
  const events = [];
  const { engine, roots, file } = await fixture(t, { onProgress: (gameId, phase, completed, total) => events.push({ gameId, phase, completed, total }) });
  const version = await engine.backup('steam:1', roots);
  assert.ok(events.some(event => event.phase === 'scanning'));
  assert.ok(events.some(event => event.phase === 'copying' && event.completed === 1 && event.total === 1));
  assert.ok(events.some(event => event.phase === 'verifying'));
  await fs.writeFile(file, 'changed');
  events.length = 0;
  await engine.restore('steam:1', roots, version.id, true);
  assert.ok(events.some(event => event.phase === 'checking-restore'));
  assert.ok(events.some(event => event.phase === 'safety-copying' && event.completed === 1));
  assert.ok(events.some(event => event.phase === 'restore-staging' && event.completed === 1 && event.total === 1));
  assert.ok(events.some(event => event.phase === 'restore-replacing' && event.completed === 1 && event.total === 1));
  assert.equal(events.at(-1).phase, 'restore-cleanup');
  assert.equal(await fs.readFile(file, 'utf8'), 'level-1');
});
