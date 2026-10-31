import type { BackupController } from './controller.mjs';
export interface CloudSnapshot {
  provider: 'onedrive'; clientId: string; connected: boolean;
  login: { userCode: string; expiresAt: number; url: string } | null;
  pending: number; uploaded: number; uploading: boolean; error: string; lastUploadedAt?: string;
  versions: Array<{ name: string; modifiedAt: string; size: number }>;
}
export class CloudSync {
  constructor(options: { directory: string; controller: BackupController; vault: { load(): Promise<unknown>; save(value: unknown): Promise<void> } });
  init(): Promise<this>;
  snapshot(gameId?: string): CloudSnapshot;
  begin(clientId: string): Promise<void>;
  disconnect(): Promise<void>;
  backupCompleted(engine: unknown, gameId: string, manifest: unknown): Promise<void>;
  sync(gameId?: string): Promise<void>;
  list(gameId: string): Promise<void>;
  download(gameId: string, name: string): Promise<void>;
  stop(): Promise<void>;
}
