import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ludusavi } from '../module/ludusavi.mjs';
import path from 'node:path';

test('deteksi Steam memakai ID, preview tanpa cloud dan tanpa shell', async () => {
  const calls = [];
  const runner = async (executable, args, options) => {
    calls.push({ executable, args, options });
    return { stdout: JSON.stringify(args.includes('find') ? { games: { Example: {} } } : { games: { Example: { decision: 'Processed', files: { '/save.sav': { ignored: false, failed: false, change: 'New' } } } } }) };
  };
  const detector = new Ludusavi(path.resolve('ludusavi.exe'), path.resolve('.state'), runner);
  const result = await detector.discover({ shop: 'steam', objectId: '123', title: 'Example' });
  assert.equal(result.selections[0].path, '/save.sav');
  assert.ok(calls[0].args.includes('--steam-id'));
  assert.ok(calls[1].args.includes('--preview'));
  assert.ok(calls[1].args.includes('--no-cloud-sync'));
  assert.equal(calls[0].options.shell, undefined);
});

test('judul ambigu tidak dipilih otomatis', async () => {
  const detector = new Ludusavi(path.resolve('ludusavi.exe'), '/config', async () => ({ stdout: '{"games":{"One":{},"Two":{}}}' }));
  await assert.rejects(detector.discover({ shop: 'custom', title: 'Game --flag' }), /secara pasti/);
});

test('file gagal dan hasil Registry saja tidak diterima sebagai deteksi save', async () => {
  let files = { '/bad': { failed: true } };
  const detector = new Ludusavi(path.resolve('ludusavi.exe'), '/config', async (_, args) => ({ stdout: JSON.stringify(args.includes('find') ? { games: { Game: {} } } : { games: { Game: { files } } }) }));
  await assert.rejects(detector.discover({ title: 'Game' }), /tidak dapat dibaca/);
  files = {};
  await assert.rejects(detector.discover({ title: 'Game' }), /Registry tidak didukung/);
});

test('judul diawali tanda minus tetap berupa argumen nama', async () => {
  const detector = new Ludusavi(path.resolve('ludusavi.exe'), '/config', async (_, args) => {
    assert.deepEqual(args.slice(-2), ['--', '--evil-title']);
    return { stdout: '{"games":{}}' };
  });
  await assert.rejects(detector.discover({ title: '--evil-title' }), /secara pasti/);
});
