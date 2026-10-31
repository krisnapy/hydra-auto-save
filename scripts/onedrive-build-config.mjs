import * as fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validClientId } from '../module/onedrive.mjs';

// Read only the public OAuth identifier. Never copy .env or token files to the app.
export async function readOneDriveClientId({ env = process.env, envFile = fileURLToPath(new URL('../.env', import.meta.url)), required = env.HYDRA_REQUIRE_ONEDRIVE_CLIENT_ID === '1' } = {}) {
  let value = env.HYDRA_ONEDRIVE_CLIENT_ID;
  if (value === undefined) {
    try { value = parseEnv(await fs.readFile(envFile, 'utf8')).HYDRA_ONEDRIVE_CLIENT_ID; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Konfigurasi lokal OneDrive tidak dapat dibaca.'); }
  }
  value = (value || '').trim();
  if (value && !validClientId(value)) throw new Error('HYDRA_ONEDRIVE_CLIENT_ID harus berisi Application (client) ID yang valid.');
  if (required && !value) throw new Error('GitHub Secret HYDRA_ONEDRIVE_CLIENT_ID belum diatur. Build dihentikan sebelum integrasi.');
  return value;
}
