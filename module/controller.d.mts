export interface BackupGame { id: string; title: string; shop: string; objectId: string; running?: boolean; }
export interface SaveRoot { id: string; path: string; kind: 'file' | 'directory'; }
export interface BackupOperation {
  id: string; kind: string; gameId?: string; title?: string; phase: string;
  startedAt: string; updatedAt: string; completed?: number; total?: number;
}
export interface BackupProgress {
  operations: BackupOperation[];
  lastOperation?: { kind: string; gameId?: string; status: string; at: string; detail?: string };
}
export interface RecoveryInfo { journal: string; automatic: boolean; committed: boolean; }
export interface BackupSnapshot {
  setup: { completed: boolean; firstBackupAt?: string; games: Array<{ id: string; title: string; configured: boolean }> };
  storage: { availableBytes?: number; totalBytes?: number; warning: boolean; detail: string } | null;
  recovery: RecoveryInfo | null;
  interrupted: Array<{ id: string; title: string; recovery: RecoveryInfo | null }>;

  operations: BackupOperation[];
  lastOperation?: { kind: string; gameId?: string; status: string; at: string; detail?: string };
  enabled: boolean; destination: string; backupDirectory: string; ludusavi: string; retention: number; deviceId: string;
  status: { status: string; detail?: string };
  roots: SaveRoot[];
  saveFolders: Array<{ rootId: string; path: string }>;
  versions: Array<{ id: string; createdAt: string; reason: string; safety: boolean; files: number }>;
  activity: Array<{ at: string; gameId: string; status: string; detail: string }>;
}
export class BackupController {
  constructor(options: { stateDirectory: string; getGames: () => Promise<BackupGame[]>; assertStopped: (gameId: string) => Promise<void>; onError?: (error: unknown) => void; isBackground?: () => boolean; stableMs?: number; pollMs?: number; idlePollMs?: number; debounceMs?: number; fallbackMs?: number });
  init(): Promise<this>;
  configure(values: { enabled?: boolean; destination?: string; ludusavi?: string; retention?: number; setupCompleted?: boolean }): Promise<void>;
  manual(gameId: string, selections: Array<{ path: string }>): Promise<void>;
  detect(gameId: string): Promise<void>;
  updateManifest(): Promise<void>;
  backup(gameId: string, reason?: string): Promise<unknown>;
  restore(gameId: string, versionId: string, confirmed: boolean): Promise<unknown>;
  recover(gameId: string): Promise<void>;
  progressSnapshot(gameId?: string): BackupProgress;
  snapshot(gameId?: string, lightweight?: boolean): Promise<BackupSnapshot>;
  start(): void;
  stop(): Promise<void>;
}
