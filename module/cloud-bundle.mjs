import * as fs from 'node:fs/promises';
import path from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { accountMatch } from './backup-account.mjs';
import { digest, safePath, readBackupBlob, portableManifest } from './engine.mjs';

// Keep bounded memory use and leave room for base64 legacy exports/metadata.
// 192 MiB also stays below Graph simple-upload's 250 MB per-file limit.
export const SAVE_LIMIT = 128 * 1024 ** 2;
export const BUNDLE_LIMIT = 192 * 1024 ** 2;
const zip = promisify(gzip), unzip = promisify(gunzip);
const invalid = () => new Error('Paket cloud rusak, tidak lengkap, atau tidak sesuai perangkat/lokasi save.');

export function readSharedIndex(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > BUNDLE_LIMIT) throw invalid();
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw invalid(); }
  if (value?.schema !== 2 || !value.manifest || !Array.isArray(value.objects) || value.objects.length > 10000) throw invalid();
  const hashes = new Set(); let size = 0, stored = 0;
  for (const object of value.objects) {
    if (!object || !/^[a-f0-9]{64}$/.test(object.hash) || !/^[a-f0-9]{64}$/.test(object.storedHash) || !['raw', 'gzip'].includes(object.encoding) || !Number.isSafeInteger(object.bytes) || object.bytes < 0 || !Number.isSafeInteger(object.storedBytes) || object.storedBytes < 0 || hashes.has(object.hash)) throw invalid();
    hashes.add(object.hash); size += object.bytes; stored += object.storedBytes;
  }
  if (size > SAVE_LIMIT || stored > BUNDLE_LIMIT || !Array.isArray(value.manifest.files) || value.manifest.files.length > 10000) throw invalid();
  const entries = new Map(value.manifest.files.map(entry => [entry?.hash, entry?.bytes]));
  if (entries.size !== hashes.size || value.objects.some(object => entries.get(object.hash) !== object.bytes)) throw invalid();
  return value;
}

export function splitSharedBundle(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 9 || bytes.length > BUNDLE_LIMIT || bytes.subarray(0, 5).toString() !== 'HPB2\n') throw invalid();
  const end = 9 + bytes.readUInt32BE(5);
  if (end > bytes.length) throw invalid();
  const index = bytes.subarray(9, end);
  const value = readSharedIndex(index);
  const objects = new Map(); let offset = end;
  for (const object of value.objects) {
    const data = bytes.subarray(offset, offset + object.storedBytes);
    if (data.length !== object.storedBytes || digest(data) !== object.storedHash) throw invalid();
    objects.set(object.storedHash, data); offset += object.storedBytes;
  }
  if (offset !== bytes.length) throw invalid();
  return { index, objects, value };
}

export const sharedObjectName = (manifest, object) => `${digest(manifest.gameId)}_${manifest.deviceId}_blob_${object.storedHash}.hpd`;

export async function materializeShared(index, fetchObject) {
  const { manifest, objects } = readSharedIndex(index);
  const blobs = {};
  for (const object of objects) {
    const stored = await fetchObject(object, sharedObjectName(manifest, object));
    if (!Buffer.isBuffer(stored) || stored.length !== object.storedBytes || digest(stored) !== object.storedHash) throw invalid();
    let bytes;
    try { bytes = object.encoding === 'gzip' ? await unzip(stored, { maxOutputLength: Math.max(1, object.bytes) }) : stored; }
    catch { throw invalid(); }
    if (bytes.length !== object.bytes || digest(bytes) !== object.hash) throw invalid();
    blobs[object.hash] = bytes.toString('base64');
  }
  return { schema: 1, manifest, blobs };
}

export async function packVersion(engine, gameId, versionId, { shared = false, account } = {}) {
  const local = (await engine.versions(gameId, { fresh: true, versionId }))[0];
  if (!local) throw invalid();
  // Explicit legacy exports remain schema 1. New upload jobs use a binary
  // outbox whose index can reference shared objects on the remote drive.
  const manifest = { ...portableManifest(local), ...(account !== undefined ? { account } : {}) };
  const saveBytes = manifest.files.reduce((n, f) => n + f.bytes, 0);
  if (manifest.files.length > 10000 || saveBytes > SAVE_LIMIT) throw new Error(`Save berukuran ${(saveBytes / 1024 ** 2).toFixed(2)} MiB dengan ${manifest.files.length.toLocaleString('id-ID')} file. Batas unggahan: ${SAVE_LIMIT / 1024 ** 2} MiB dan 10.000 file per versi. Periksa apakah lokasi save mencakup folder yang terlalu luas. Backup lokal tetap tersedia.`);
  const blobs = {};
  const objects = [];
  for (const entry of manifest.files) {
    if (blobs[entry.hash] !== undefined) continue;
    const bytes = await readBackupBlob(path.join(engine.directory(gameId), versionId), local, entry);
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.hash) throw invalid();
    blobs[entry.hash] = shared ? true : bytes.toString('base64');
    if (shared) {
      const compressed = await zip(bytes, { level: 1 });
      const useGzip = compressed.length + 64 < bytes.length;
      const stored = useGzip ? compressed : bytes;
      objects.push({ hash: entry.hash, bytes: entry.bytes, encoding: useGzip ? 'gzip' : 'raw', storedBytes: stored.length, storedHash: digest(stored), data: stored });
    }
  }
  if (shared) {
    const index = Buffer.from(JSON.stringify({ schema: 2, manifest, objects: objects.map(({ data, ...entry }) => entry) }));
    const header = Buffer.alloc(9);
    header.write('HPB2\n'); header.writeUInt32BE(index.length, 5);
    const bytes = Buffer.concat([header, index, ...objects.map(object => object.data)]);
    if (bytes.length > BUNDLE_LIMIT) throw invalid();
    return bytes;
  }
  const encoded = Buffer.from(JSON.stringify({ schema: 1, manifest, blobs }));
  if (encoded.length > BUNDLE_LIMIT) throw new Error('Metadata paket cloud terlalu besar. Backup lokal tetap tersedia.');
  const bytes = await zip(encoded);
  if (bytes.length > BUNDLE_LIMIT) throw invalid();
  return bytes;
}

export async function unpackBundle(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > BUNDLE_LIMIT) throw invalid();
  let value;
  if (bytes.subarray(0, 5).toString() === 'HPB2\n') {
    const bundle = splitSharedBundle(bytes);
    value = await materializeShared(bundle.index, async object => bundle.objects.get(object.storedHash));
  } else {
    try { value = JSON.parse((await unzip(bytes, { maxOutputLength: BUNDLE_LIMIT })).toString('utf8')); }
    catch { throw invalid(); }
  }
  return value;
}

export async function validateBundle(engine, gameId, roots, bytes) {
  return validateValue(engine, gameId, roots, await unpackBundle(bytes));
}

export async function validateManifest(engine, gameId, roots, m, { local = false } = {}) {
  if (!m || m.schema !== 1 || m.compressed !== undefined || m.gameId !== gameId || m.deviceId !== engine.deviceId || !/^[a-zA-Z0-9_-]{1,100}$/.test(m.id) || m.id.startsWith('_') || !Array.isArray(m.files) || !Array.isArray(m.roots) || (!local && m.files.length > 10000) || typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt)) || typeof m.safety !== 'boolean' || !Number.isSafeInteger(m.order) || m.order < 0) throw invalid();
  await engine.validate(roots);
  if (m.roots.length !== roots.length || new Set(m.roots.map(r => r?.id)).size !== roots.length || m.roots.some(r => !r || !roots.some(target => target.id === r.id && target.kind === r.kind) || typeof r.present !== 'boolean')) throw invalid();
  const targets = new Set(); let size = 0;
  for (const entry of m.files) {
    if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.hash) || !m.roots.some(r => r.id === entry.rootId && r.present)) throw invalid();
    size += entry.bytes;
    const target = engine.source(roots, entry).toLowerCase();
    if (targets.has(target) || !Number.isSafeInteger(size) || (!local && size > SAVE_LIMIT)) throw invalid();
    targets.add(target);
  }
  for (const root of m.roots) if (root.present && root.kind === 'file' && m.files.filter(f => f.rootId === root.id).length !== 1) throw invalid();
  if (digest(JSON.stringify({ roots: m.roots, files: m.files })) !== m.fingerprint) throw invalid();
  return m;
}

export async function validateValue(engine, gameId, roots, value) {
  if (value?.schema !== 1 || typeof value.blobs !== 'object' || value.blobs === null) throw invalid();
  const m = await validateManifest(engine, gameId, roots, value.manifest);
  for (const entry of m.files) {
    const encoded = value.blobs[entry.hash];
    if (typeof encoded !== 'string' || encoded.length > BUNDLE_LIMIT) throw invalid();
    const blob = Buffer.from(encoded, 'base64');
    if (blob.length !== entry.bytes || digest(blob) !== entry.hash) throw invalid();
  }
  return value;
}

export async function importVersion(engine, gameId, roots, bytes, { signal } = {}) {
  signal?.throwIfAborted();
  const value = Buffer.isBuffer(bytes) ? await validateBundle(engine, gameId, roots, bytes) : await validateValue(engine, gameId, roots, bytes);
  if (engine.account !== undefined && accountMatch(value.manifest.account, engine.account.hydra) !== 'matched') throw new Error('Pemilik backup tidak cocok dengan profil Hydra aktif.');
  const m = { ...value.manifest, ...(engine.account !== undefined ? { account: engine.account } : {}) };
  const size = [...new Map(m.files.map(f => [f.hash, f])).values()].reduce((n, f) => n + f.bytes, 0);
  const directory = engine.directory(gameId);
  await safePath(directory);
  await engine.requireSpace(engine.destination, size);
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, m.id);
  // Never replace an existing local version, even if the remote name matches.
  try {
    await fs.lstat(target);
    const local = (await engine.versions(gameId, { fresh: true, versionId: m.id }))[0];
    const portable = local ? portableManifest(local) : {};
    if (JSON.stringify(portable) !== JSON.stringify(m)) throw invalid();
    return m.id;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stage = path.join(directory, `_cloud-${randomUUID()}`);
  try {
    await fs.mkdir(path.join(stage, 'data'), { recursive: true });
    const compressed = [];
    for (const hash of new Set(m.files.map(f => f.hash))) {
      signal?.throwIfAborted();
      const raw = Buffer.from(value.blobs[hash], 'base64');
      let stored = raw;
      if (raw.length >= 4096) {
        const zipped = await zip(raw, { level: 1 });
        if (zipped.length + 64 < raw.length) { stored = zipped; compressed.push(hash); }
      }
      await fs.writeFile(path.join(stage, 'data', hash), stored, { flag: 'wx' });
    }
    const local = { ...m, storage: 'adaptive-gzip-v1', ...(compressed.length ? { schema: 2, compressed } : {}) };
    const metadata = JSON.stringify(local, null, 2);
    await fs.writeFile(path.join(stage, 'manifest.json'), metadata);
    await fs.writeFile(path.join(stage, 'COMPLETE'), digest(metadata));
    engine.assertAccount();
    signal?.throwIfAborted();
    await fs.rename(stage, target);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
  return m.id;
}
