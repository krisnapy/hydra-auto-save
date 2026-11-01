import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { BackupEngine, makeRoots, digest } from '../module/engine.mjs';
import { packVersion, importVersion } from '../module/cloud-bundle.mjs';
import { OneDrive, cloudName } from '../module/onedrive.mjs';
import { CloudSync } from '../module/cloud-sync.mjs';
const zip = promisify(gzip), unzip = promisify(gunzip);
const clientId = '11111111-2222-3333-4444-555555555555';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-cloud-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const save = path.join(directory, 'saves'); await fs.mkdir(save);
  await fs.writeFile(path.join(save, 'slot.sav'), 'original');
  const roots = await makeRoots([{ path: save }]);
  const engine = new BackupEngine({ destination: path.join(directory, 'backups'), deviceId: randomUUID(), stateDirectory: path.join(directory, 'state'), stableMs: 1, assertStopped: async () => {} });
  const manifest = await engine.backup('steam:1', roots);
  let tokens = null;
  const vault = { load: async () => tokens, save: async value => { tokens = value; } };
  const controller = { engine, state: { deviceId: engine.deviceId, games: { 'steam:1': { roots } } }, control: action => action() };
  const cloud = await new CloudSync({ directory: path.join(directory, 'outbox'), controller, vault }).init();
  t.after(() => cloud.stop());
  cloud.connected = true; cloud.state.driveId = 'drive-A';
  return { directory, engine, roots, manifest, cloud, vault, controller, save };
}

test('cloud package survives local retention, downloads to history, then restores with safety copy', async t => {
  const f = await fixture(t);
  const bytes = await packVersion(f.engine, 'steam:1', f.manifest.id);
  await fs.rm(path.join(f.engine.directory('steam:1'), f.manifest.id), { recursive: true });
  await fs.writeFile(path.join(f.save, 'slot.sav'), 'new-progress');
  await importVersion(f.engine, 'steam:1', f.roots, bytes);
  assert.equal(await fs.readFile(path.join(f.save, 'slot.sav'), 'utf8'), 'new-progress', 'import never changes live save');
  const restored = await f.engine.restore('steam:1', f.roots, f.manifest.id, true);
  assert.equal(await fs.readFile(path.join(f.save, 'slot.sav'), 'utf8'), 'original');
  assert.ok((await f.engine.versions('steam:1')).find(v => v.id === restored.safety)?.safety);
});

test('cloud import rejects traversal, corruption, wrong device/root and duplicate Windows paths before publication', async t => {
  const f = await fixture(t);
  const original = JSON.parse((await unzip(await packVersion(f.engine, 'steam:1', f.manifest.id))).toString());
  await fs.rm(path.join(f.engine.directory('steam:1'), f.manifest.id), { recursive: true });
  const changes = [
    v => { v.manifest.files[0].relative = '../outside'; },
    v => { v.blobs[v.manifest.files[0].hash] = Buffer.from('corrupt').toString('base64'); },
    v => { v.manifest.deviceId = randomUUID(); },
    v => { v.manifest.roots[0].id = 'foreign-root'; },
    v => { v.manifest.files.push({ ...v.manifest.files[0], relative: 'SLOT.SAV' }); },
  ];
  for (const change of changes) {
    const value = structuredClone(original); change(value);
    value.manifest.fingerprint = digest(JSON.stringify({ roots: value.manifest.roots, files: value.manifest.files }));
    await assert.rejects(importVersion(f.engine, 'steam:1', f.roots, await zip(JSON.stringify(value))));
    assert.equal((await f.engine.versions('steam:1')).length, 0);
    assert.equal(await fs.readFile(path.join(f.save, 'slot.sav'), 'utf8'), 'original');
  }
});

test('outbox retries offline, survives restart and never uploads old jobs to a different account', async t => {
  const f = await fixture(t);
  await f.cloud.enqueue(f.engine, 'steam:1', f.manifest.id);
  const job = f.cloud.state.jobs[0]; assert.ok(cloudName(job.name));
  await fs.rm(f.engine.directory('steam:1'), { recursive: true });
  f.cloud.provider.identity = async () => 'drive-A';
  f.cloud.provider.upload = async () => { throw new Error('offline'); };
  await f.cloud.tick();
  assert.equal(job.uploadedAt, undefined); assert.ok(job.nextAt > Date.now());
  await f.cloud.stop();
  await f.vault.save({ access: 'test-only' });
  const restarted = await new CloudSync({ directory: f.cloud.directory, controller: f.controller, vault: f.vault }).init();
  t.after(() => restarted.stop());
  let calls = 0;
  restarted.provider.identity = async () => 'drive-B';
  restarted.provider.upload = async (_, bytes) => { calls++; assert.ok(bytes.length > 0); return 'remote-id'; };
  restarted.state.jobs[0].nextAt = 0;
  await restarted.tick(); assert.equal(calls, 0); assert.match(restarted.error, /berbeda/);
  restarted.provider.identity = async () => 'drive-A'; restarted.state.jobs[0].nextAt = 0;
  await restarted.tick(); assert.equal(calls, 1); assert.ok(restarted.state.jobs[0].uploadedAt);
  await assert.rejects(fs.stat(restarted.packageFile(job)), { code: 'ENOENT' });
});

test('device login handles pending and slow_down without exposing device code or tokens; disconnect drains work', async t => {
  const f = await fixture(t); await f.cloud.disconnect();
  f.cloud.provider.beginLogin = async () => ({ code: 'PRIVATE-DEVICE-CODE', userCode: 'USER-CODE', url: 'https://www.microsoft.com/link', expiresAt: Date.now() + 900000, interval: 5000 });
  await f.cloud.begin(clientId);
  assert.equal(f.cloud.snapshot().login.url, 'https://www.microsoft.com/link');
  assert.equal(JSON.stringify(f.cloud.snapshot()).includes('PRIVATE-DEVICE-CODE'), false);
  let attempts = 0;
  f.cloud.provider.completeLogin = async () => {
    attempts++;
    if (attempts <= 2) throw Object.assign(new Error('pending'), { code: attempts === 1 ? 'authorization_pending' : 'slow_down' });
    await f.vault.save({ access: 'PRIVATE-ACCESS', refresh: 'PRIVATE-REFRESH' });
  };
  f.cloud.provider.identity = async () => 'drive-A';
  for (let i = 0; i < 3; i++) { f.cloud.nextLoginAt = 0; await f.cloud.tick(); }
  assert.equal(f.cloud.snapshot().connected, true);
  assert.equal(JSON.stringify(f.cloud.snapshot()).includes('PRIVATE-'), false);
  await f.cloud.disconnect(); assert.equal(await f.vault.load(), null);
  assert.equal(f.cloud.snapshot().connected, false);
});

test('device login preserves the Microsoft verification URL and rejects unexpected login destinations', async () => {
  let verificationUri = 'https://www.microsoft.com/link';
  const provider = new OneDrive({ clientId, loadTokens: async () => null, saveTokens: async () => {}, fetcher: async (url, options) => {
    assert.equal(url, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode');
    assert.equal(options.body.get('client_id'), clientId);
    return Response.json({ device_code: 'PRIVATE-DEVICE-CODE', user_code: 'USER-CODE', verification_uri: verificationUri, expires_in: 900, interval: 5 });
  } });
  const login = await provider.beginLogin();
  assert.equal(login.url, verificationUri);
  assert.equal(login.userCode, 'USER-CODE');
  assert.equal(login.code, 'PRIVATE-DEVICE-CODE');
  assert.equal(login.interval, 5000);
  for (const invalid of ['https://www.microsoft.com.evil.example/link', 'http://www.microsoft.com/link', 'https://www.microsoft.com/link?redirect=evil', undefined]) {
    verificationUri = invalid;
    await assert.rejects(provider.beginLogin(), /Alamat login Microsoft tidak dikenali/);
  }
});

test('OneDrive refresh rotates tokens once, restricts scope and sanitizes provider errors', async () => {
  let tokens = { refresh: 'old', access: 'expired', expiresAt: 0 }, calls = 0;
  const provider = new OneDrive({ clientId, loadTokens: async () => tokens, saveTokens: async value => { tokens = value; }, fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token');
    assert.match(options.body.get('scope'), /Files.ReadWrite.AppFolder/); assert.equal(options.body.has('client_secret'), false);
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 });
  } });
  assert.deepEqual(await Promise.all([provider.access(), provider.access()]), ['new', 'new']);
  assert.equal(calls, 1); assert.equal(tokens.refresh, 'rotated');
  provider.fetcher = async () => Response.json({ error: 'invalid_client', error_description: 'PRIVATE DETAIL' }, { status: 400 });
  await assert.rejects(provider.beginLogin(), error => !error.message.includes('PRIVATE DETAIL'));
});

test('signed downloads do not receive bearer tokens and reject untrusted origins / truncated packages', async () => {
  const name = `${digest('steam:1')}_${randomUUID()}_123-${randomUUID()}_${digest('package')}.hpb`;
  let signed = false;
  const provider = new OneDrive({ clientId, loadTokens: async () => ({ access: 'PRIVATE', expiresAt: Date.now() + 999999 }), saveTokens: async () => {}, fetcher: async (url, options) => {
    if (url.startsWith('https://graph.microsoft.com/')) {
      assert.equal(options.headers.Authorization, 'Bearer PRIVATE');
      return Response.json({ name, size: 7, '@microsoft.graph.downloadUrl': 'https://test.files.1drv.com/download' });
    }
    signed = true; assert.equal(options.headers, undefined); return new Response('package');
  } });
  assert.equal((await provider.download(name)).toString(), 'package'); assert.equal(signed, true);
  provider.fetcher = async () => Response.json({ name, size: 7, '@microsoft.graph.downloadUrl': 'http://localhost/private' });
  await assert.rejects(provider.download(name), /tidak dikenali/);
});
