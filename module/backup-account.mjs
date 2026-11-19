import { digest } from './engine.mjs';

const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(value);
export function hydraIdentity(value) {
  if (value == null) return null;
  if (!text(value.userId) || !text(value.server)) throw new Error('Identitas akun Hydra tidak valid.');
  const server = value.server.replace(/\/+$/, '');
  const url = new URL(server);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Server akun Hydra tidak valid.');
  return { server, userId: value.userId };
}
export const sameHydra = (a, b) => JSON.stringify(hydraIdentity(a)) === JSON.stringify(hydraIdentity(b));
export const accountKey = hydra => hydra ? digest(JSON.stringify(hydraIdentity(hydra))) : 'guest';
export function backupAccount(hydra, oneDriveDriveId = null) {
  if (oneDriveDriveId !== null && !text(oneDriveDriveId)) throw new Error('Identitas akun OneDrive tidak valid.');
  return { schema: 1, hydra: hydraIdentity(hydra), oneDriveDriveId };
}
export function accountMatch(account, hydra, driveId) {
  if (account === undefined) return 'legacy';
  if (!account || account.schema !== 1 || account.hydra === undefined || account.oneDriveDriveId === undefined) throw new Error('Metadata pemilik backup tidak valid.');
  const normalized = backupAccount(account.hydra, account.oneDriveDriveId);
  if (normalized.hydra === null && hydra !== null) return driveId === undefined || normalized.oneDriveDriveId === null || normalized.oneDriveDriveId === driveId ? 'legacy' : 'different';
  if (!sameHydra(normalized.hydra, hydra)) return 'different';
  if (driveId !== undefined && normalized.oneDriveDriveId !== driveId) return normalized.oneDriveDriveId === null ? 'legacy' : 'different';
  return 'matched';
}
