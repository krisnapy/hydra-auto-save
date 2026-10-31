import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { gamesSublevel, levelKeys } from "@main/level";
import { NativeAddon } from "../native-addon";
import { isGameRunning } from "../game-running-state";
import { logger } from "../logger";
import { launchedGamePids } from "../launched-game-pids";
import { BackupController } from "./core/controller.mjs";
import { withRestoreGate } from "./core/launch-guard.mjs";
import { runWithHydraSaveGuard } from "../epic/cloud-saves";
import { getOneDrive, stopOneDrive } from "./onedrive";
import type { Game } from "@types";

let instance: Promise<BackupController> | undefined;

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
  if (isGameRunning(game.objectId, game.shop) || launchedGamePids.has(gameId)) throw new Error("Tutup game sebelum memulihkan save.");
  const scan = await NativeAddon.getSystemProcessMap();
  if (!scan || !scan.processMap) throw new Error("Status proses game belum dapat dipastikan. Pemulihan diblokir.");
  const directories = [game.executablePath, ...(game.trackingExecutablePaths ?? [])].map(file => path.dirname(file).toLowerCase());
  for (const files of Object.values(scan.processMap)) {
    for (const file of files) {
      if (directories.some(directory => {
        const relative = path.relative(directory, file.toLowerCase());
        return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      })) throw new Error("Masih ada proses di folder game. Tutup game sebelum memulihkan.");
    }
  }
};

export const getPersonalBackup = () => {
  if (process.platform !== "win32") throw new Error("Personal Cloud Backup tahap awal hanya tersedia di Windows.");
  instance ??= new BackupController({
    stateDirectory: path.join(app.getPath("userData"), "personal-cloud-backup"),
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
  return instance;
};

export const startPersonalBackup = async () => {
  if (process.platform === "win32") (await getPersonalBackup()).start();
};

export const stopPersonalBackup = async () => {
  if (instance) { await (await instance).stop(); await stopOneDrive(); }
};

export const onPersonalBackupGameClosed = (game: Game) => {
  if (process.platform !== "win32" || (game.shop !== "steam" && game.shop !== "custom")) return;
  void (async () => {
    const controller = await getPersonalBackup();
    if ((await controller.snapshot()).enabled) await controller.backup(levelKeys.game(game.shop, game.objectId), "game-closed");
  })().catch(error => logger.warn("[Personal Backup] Backup setelah game ditutup:", error));
};

export const restorePersonalBackup = (gameId: string, versionId: string) =>
  withRestoreGate(gameId, () => runWithHydraSaveGuard(async () => (await getPersonalBackup()).restore(gameId, versionId, true)));

export const recoverPersonalBackup = (gameId: string) =>
  withRestoreGate(gameId, () => runWithHydraSaveGuard(async () => (await getPersonalBackup()).recover(gameId)));
