import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readOneDriveClientId } from '../scripts/onedrive-build-config.mjs';

test('OneDrive build reads only its app ID, gives CI precedence and fails closed when required configuration is absent', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hydra-env-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, '.env');
  const id = '11111111-2222-3333-4444-555555555555';
  await fs.writeFile(envFile, `HYDRA_ONEDRIVE_CLIENT_ID="${id}"\nUNRELATED_SECRET=must-not-be-copied\n`);
  assert.equal(await readOneDriveClientId({ env: {}, envFile }), id);
  assert.equal(await readOneDriveClientId({ env: { HYDRA_ONEDRIVE_CLIENT_ID: '' }, envFile }), '', 'an explicitly empty CI value must not fall back to local files');
  await assert.rejects(readOneDriveClientId({ env: { HYDRA_ONEDRIVE_CLIENT_ID: '', HYDRA_REQUIRE_ONEDRIVE_CLIENT_ID: '1' }, envFile }), /belum diatur/);
  await assert.rejects(readOneDriveClientId({ env: { HYDRA_ONEDRIVE_CLIENT_ID: 'invalid-private-value' }, envFile }), error => !error.message.includes('invalid-private-value'));
  await fs.rm(envFile);
  assert.equal(await readOneDriveClientId({ env: {}, envFile }), '');
});
