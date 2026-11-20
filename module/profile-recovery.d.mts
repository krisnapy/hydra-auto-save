import type { BackupController } from './controller.mjs';
import type { CloudSync } from './cloud-sync.mjs';
export interface ProfileRecoverySnapshot {
  notice?: string;
  profiles: Array<{ token: string; deviceId: string; name: string; source: 'local' | 'onedrive'; createdAt: string; gameCount: number }>;
  profileToken?: string;
  sources: Array<{ token: string; ownership?: 'matched' | 'legacy'; title: string; deviceId: string; createdAt: string; gameId: string; source: 'local' | 'onedrive'; restorable: boolean }>;
  selection: null | { token: string; ownership?: 'matched' | 'legacy'; gameId: string; title: string; targetTitle: string; sourceGameId: string; deviceId: string; createdAt: string; roots: Array<{ id: string; kind: 'file' | 'directory'; files: number; samples: string[]; originalPath?: string; target: string }> };
}
export class ProfileRecovery {
  constructor(controller: BackupController, gameId?: string);
  snapshot(): ProfileRecoverySnapshot;
  listLocal(destination: string): Promise<ProfileRecoverySnapshot>;
  listCloud(cloud: CloudSync): Promise<ProfileRecoverySnapshot>;
  details(token?: string): ProfileRecoverySnapshot;
  select(token: string): Promise<ProfileRecoverySnapshot>;
  map(token: string, rootId: string, target: string): Promise<ProfileRecoverySnapshot>;
  targets(token: string): Promise<Array<{ id: string; path: string; kind: 'file' | 'directory' }>>;
  import(token: string, confirmedTargets: string, claimLegacy?: boolean, options?: { restore?: boolean }): Promise<{ gameId: string; versionId: string }>;
}
