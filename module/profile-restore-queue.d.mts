import type { BackupController } from './controller.mjs';
import type { ProfileRecovery, RestoreControls } from './profile-recovery.mjs';

export interface ProfileRestoreStatus {
  id: string;
  gameId: string;
  title: string;
  status: 'checking' | 'waiting' | 'needs-location' | 'choose' | 'restoring' | 'finishing' | 'complete' | 'failed' | 'cancelled';
  detail?: string;
  targetProfiles?: Array<{ token: string; name: string; folder: string }>;
}
export class ProfileRestoreQueue {
  constructor(controller: BackupController, assertStopped: (gameId: string) => Promise<void>, restore: (job: { recovery: ProfileRecovery; gameId: string; token: string; confirmedTargets: string; claimLegacy: boolean }, controls: RestoreControls) => Promise<unknown>);
  snapshot(gameId?: string): ProfileRestoreStatus[];
  enqueue(recovery: ProfileRecovery, token: string, confirmedTargets?: string): void;
  cancel(id: string, gameId?: string): void;
  choose(id: string, profileToken: string, gameId?: string): void;
  gameClosed(gameId: string): Promise<void> | undefined;
  stop(): Promise<void>;
}
