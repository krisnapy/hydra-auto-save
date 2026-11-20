import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { HydraApi } from "../hydra-api";
import { accountKey, hydraIdentity } from "./core/backup-account.mjs";
import { gamesSublevel, levelKeys } from "@main/level";
import { NativeAddon } from "../native-addon";
import { isGameRunning } from "../game-running-state";
import { logger } from "../logger";
import { launchedGamePids } from "../launched-game-pids";
import { ProfileRecovery } from "./core/profile-recovery.mjs";
import { ProfileRestoreQueue } from "./core/profile-restore-queue.mjs";
import { BackupController } from "./core/controller.mjs";
import { onTrackedGameClosed, withRestoreGate } from "./core/launch-guard.mjs";
import { runWithHydraSaveGuard } from "../epic/cloud-saves";
import { getOneDrive, stopOneDrive } from "./onedrive";
import type { Game } from "@types";

let instance: Promise<BackupController> | undefined;
let activeKey: string | undefined;
let transition: Promise<BackupController> | undefined;
let authRevision = 0;
const currentHydra = () => {
  const context = HydraApi.getAuthContext();
  return context?.userId ? hydraIdentity({ userId: context.userId, server: import.meta.env.MAIN_VITE_API_URL }) : null;
};
let subscribed = false;
const subscribeToHydra = () => {
  if (subscribed) return;
  subscribed = true;
  HydraApi.onAuthContextChanged(() => {
    authRevision++;
    if (instance) void getPersonalBackup().then(controller => controller.start()).catch(error => logger.warn("[Personal Backup] Account switch", error));
  });
};

const library = async () => {
  const games: Game[] = await gamesSublevel.values().all();
  // This first integration covers Windows PC games with a known executable.
  // Managed Epic and emulated games keep their existing save workflow.
  return games.filter(game => !game.isDeleted && game.executablePath && (game.shop === "steam" || game.shop === "custom"));
};

const assertStopped = async (gameId: string) => {
  const game = (await library()).find(item => levelKeys.game(item.shop, item.objectId) === gameId);
  if (!game?.executablePath) throw new Error("Lokasi executable game belum diketahui.");
  if (path.extname(game.executablePath).toLowerCase() !== ".exe") throw new Error("Pemulihan memerlukan executable .exe langsung agar status proses dapat diperiksa.");
  if (isGameRunning(game.objectId, game.shop) || launchedGamePids.has(gameId)) throw Object.assign(new Error("Tutup game sebelum memulihkan save."), { code: "GAME_RUNNING" });
  const scan = await NativeAddon.getSystemProcessMap();
  if (!scan || !scan.processMap) throw new Error("Status proses game belum dapat dipastikan. Pemulihan diblokir.");
  const directories = [game.executablePath, ...(game.trackingExecutablePaths ?? [])].map(file => path.dirname(file).toLowerCase());
  for (const files of Object.values(scan.processMap)) {
    for (const file of files) {
      if (directories.some(directory => {
        const relative = path.relative(directory, file.toLowerCase());
        return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      })) throw Object.assign(new Error("Masih ada proses di folder game. Tutup game sebelum memulihkan."), { code: "GAME_RUNNING" });
    }
  }
};

const createPersonalBackup = (hydra: ReturnType<typeof currentHydra>, revision: number) => {
  if (process.platform !== "win32") throw new Error("Personal Cloud Backup tahap awal hanya tersedia di Windows.");
  return new BackupController({
    getAccount: currentHydra,
    assertSession: () => { if (revision !== authRevision) throw new Error("Sesi Hydra berubah. Muat ulang backup."); },
    stateDirectory: hydra ? path.join(app.getPath("userData"), "personal-cloud-backup", "profiles", accountKey(hydra)) : path.join(app.getPath("userData"), "personal-cloud-backup"),
    getGames: async () => (await library()).map(game => ({ id: levelKeys.game(game.shop, game.objectId), title: game.title, shop: game.shop, objectId: game.objectId, running: isGameRunning(game.objectId, game.shop) || launchedGamePids.has(levelKeys.game(game.shop, game.objectId)) })),
    isBackground: () => !BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && window.isVisible() && !window.isMinimized()),
    assertStopped,
    onError: error => logger.warn("[Personal Backup]", error),
  }).init().then(async controller => {
    if (!(await controller.snapshot()).ludusavi) {
      const candidates = [
        path.join(app.getPath("userData"), "ludusavi", "ludusavi.exe"),
        app.isPackaged ? path.join(process.resourcesPath, "ludusavi", "ludusavi.exe") : path.join(__dirname, "../../ludusavi/ludusavi.exe"),
      ];
      const bundled = candidates.find(candidate => fs.existsSync(candidate));
      if (bundled) await controller.configure({ ludusavi: bundled });
    }
    // Cloud startup errors must not disable local backup.
    try { await getOneDrive(controller); }
    catch (error) { logger.warn("[OneDrive]", error); }
    return controller;
  });
};

export const getPersonalBackup = (): Promise<BackupController> => {
  subscribeToHydra();
  const key = `${accountKey(currentHydra())}:${authRevision}`;
  if (instance && activeKey === key) return instance;
  if (transition) return transition.then(() => getPersonalBackup());
  const previous = instance;
  transition = (async () => {
    if (previous) {
      const controller = await previous.catch(() => undefined);
      if (controller) { await profileRestoreQueues.get(controller)?.stop(); await stopOneDrive(controller); await controller.stop(); }
    }
    const hydra = currentHydra(), revision = authRevision;
    activeKey = `${accountKey(hydra)}:${revision}`;
    instance = createPersonalBackup(hydra, revision);
    return instance;
  })().finally(() => { transition = undefined; });
  return transition.then(controller => activeKey === `${accountKey(currentHydra())}:${authRevision}` ? controller : getPersonalBackup());
};

export const startPersonalBackup = async () => {
  if (process.platform === "win32") (await getPersonalBackup()).start();
};

export const stopPersonalBackup = async () => {
  if (!instance) return;
  const controller = await instance;
  await profileRestoreQueues.get(controller)?.stop();
  await controller.stop();
  await stopOneDrive(controller);
};

export const onPersonalBackupGameClosed = (game: Game) => {
  if (process.platform !== "win32" || (game.shop !== "steam" && game.shop !== "custom")) return;
  const gameId = levelKeys.game(game.shop, game.objectId);
  onTrackedGameClosed(gameId);
  void (async () => {
    const controller = await getPersonalBackup();
    await profileRestoreQueues.get(controller)?.gameClosed(gameId);
    if ((await controller.snapshot()).enabled) await controller.backup(gameId, "game-closed");
  })().catch(error => logger.warn("[Personal Backup] Backup setelah game ditutup:", error));
};

export const restorePersonalBackup = (gameId: string, versionId: string) =>
  withRestoreGate(gameId, () => runWithHydraSaveGuard(async () => (await getPersonalBackup()).restore(gameId, versionId, true)));

const profileRestoreQueues = new WeakMap<BackupController, ProfileRestoreQueue>();
export const getProfileRestoreQueue = (controller: BackupController) => {
  let queue = profileRestoreQueues.get(controller);
  if (!queue) {
    queue = new ProfileRestoreQueue(controller, assertStopped, (job, controls) => withRestoreGate(job.gameId,
      () => runWithHydraSaveGuard(() => job.recovery.import(job.token, job.confirmedTargets, job.claimLegacy, { ...controls, restore: true }))));
    profileRestoreQueues.set(controller, queue);
  }
  return queue;
};

export const recoverPersonalBackup = (gameId: string) =>
  withRestoreGate(gameId, () => runWithHydraSaveGuard(async () => (await getPersonalBackup()).recover(gameId)));

const profileRecoveries = new WeakMap<BackupController, { settings: ProfileRecovery; game?: { id: string; recovery: ProfileRecovery } }>();
export const getProfileRecovery = async (gameId?: string) => {
  const controller = await getPersonalBackup();
  let sessions = profileRecoveries.get(controller);
  if (!sessions) {
    sessions = { settings: new ProfileRecovery(controller) };
    profileRecoveries.set(controller, sessions);
  }
  if (!gameId) return sessions.settings;
  if (sessions.game?.id !== gameId) sessions.game = { id: gameId, recovery: new ProfileRecovery(controller, gameId) };
  return sessions.game.recovery;
};
