import { safeStorage } from "electron";
import * as fs from "node:fs/promises";
import path from "node:path";
import { CloudSync } from "./core/cloud-sync.mjs";
import { safePath } from "./core/engine.mjs";
import type { BackupController } from "./core/controller.mjs";

const clouds = new WeakMap<BackupController, Promise<CloudSync>>();
let commandTail: Promise<unknown> = Promise.resolve();

export const getOneDrive = (controller: BackupController) => {
  let cloud = clouds.get(controller);
  if (cloud) return cloud;
  cloud = (async () => {
    const directory = path.join(controller.stateDirectory, "onedrive");
    const tokenFile = path.join(directory, "credentials.bin");
    const checkStorage = () => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Perlindungan kredensial Windows belum tersedia. Login OneDrive dinonaktifkan.");
    };
    const vault = {
      async load(): Promise<unknown> {
        await safePath(tokenFile);
        let bytes: Buffer;
        try { bytes = await fs.readFile(tokenFile); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
        checkStorage();
        try { return JSON.parse(safeStorage.decryptString(bytes)); }
        catch { throw new Error("Sesi OneDrive tidak dapat dibuka di profil Windows ini. Kredensial dipertahankan untuk pemeriksaan."); }
      },
      async save(value: unknown) {
        await safePath(tokenFile);
        if (value === null) { await fs.rm(tokenFile, { force: true }); return; }
        checkStorage();
        const temporary = `${tokenFile}.pending`;
        await safePath(temporary);
        await fs.writeFile(temporary, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
        await fs.rename(temporary, tokenFile);
      },
    };
    const instance = await new CloudSync({ directory, controller, vault }).init();
    controller.onBackupCompleted = (engine, gameId, manifest) => instance.backupCompleted(engine, gameId, manifest);
    return instance;
  })();
  clouds.set(controller, cloud);
  return cloud;
};

export const oneDriveCommand = <T>(action: () => Promise<T>): Promise<T> => {
  const next = commandTail.catch(() => {}).then(action);
  commandTail = next;
  return next;
};
export const stopOneDrive = async (controller: BackupController) => {
  await commandTail.catch(() => {});
  const cloud = clouds.get(controller);
  if (cloud) { await (await cloud).stop(); clouds.delete(controller); }
};
