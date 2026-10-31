export function withLaunchGate<T>(gameId: string, launch: () => Promise<T>): Promise<T>;
export function withRestoreGate<T>(gameId: string, restore: () => Promise<T>): Promise<T>;
