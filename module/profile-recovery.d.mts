import type { BackupController } from './controller.mjs';
import type { CloudSync } from './cloud-sync.mjs';
export interface ProfileRecoverySnapshot {
  notice?: string;
  sources: Array<{ token: string; ownership?: 'matched' | 'legacy'; title: string; deviceId: string; createdAt: string; gameId?: string; source: string }>;
  selection: null | { token: string; ownership?: 'matched' | 'legacy'; gameId: string; title: string; targetTitle: string; sourceGameId: string; deviceId: string; createdAt: string; roots: Array<{ id: string; kind: 'file' | 'directory'; files: number; samples: string[]; originalPath?: string; target: string }> };
}
export class ProfileRecovery {
  constructor(controller: BackupController);
  snapshot(): ProfileRecoverySnapshot;
  listLocal(destination: string): Promise<ProfileRecoverySnapshot>;
  listCloud(cloud: CloudSync): Promise<ProfileRecoverySnapshot>;
  select(token: string, gameId: string): Promise<ProfileRecoverySnapshot>;
  map(token: string, rootId: string, target: string): Promise<ProfileRecoverySnapshot>;
  targets(token: string): Promise<Array<{ id: string; path: string; kind: 'file' | 'directory' }>>;
  import(token: string, confirmedTargets: string, claimLegacy?: boolean): Promise<{ gameId: string; versionId: string }>;
}
