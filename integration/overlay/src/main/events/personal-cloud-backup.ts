import { dirname } from "node:path";
import { stat } from "node:fs/promises";
import { dialog, shell } from "electron";
import { registerEvent } from "./register-event";
import { assertTrustedEpicSender } from "./epic/assert-trusted-sender";
import { WindowManager } from "../services/window-manager";
import { getPersonalBackup, restorePersonalBackup, recoverPersonalBackup } from "../services/personal-cloud-backup";

import { getOneDrive, oneDriveCommand } from "../services/personal-cloud-backup/onedrive";

const string = (value: unknown) => {
  if (typeof value !== "string" || !value || value.length > 1000) throw new Error("Permintaan backup tidak valid.");
  return value;
};

registerEvent("personalBackup", async (event, request: unknown) => {
  assertTrustedEpicSender(event);
  if (!request || typeof request !== "object") throw new Error("Permintaan tidak valid.");
  const input = request as Record<string, unknown>;
  const controller = await getPersonalBackup();
  const parent = WindowManager.mainWindow;
  if (!parent) throw new Error("Jendela utama tidak tersedia.");
  const gameId = typeof input.gameId === "string" ? string(input.gameId) : undefined;
  if (input.action === "cloud") {
    const cloud = await getOneDrive(controller);
    if (input.command === "snapshot") return cloud.snapshot(gameId);
    return oneDriveCommand(async () => {
      switch (input.command) {
        case "login": await cloud.begin(string(input.clientId)); break;
        case "open-login": await shell.openExternal("https://microsoft.com/devicelogin"); break;
        case "disconnect": await cloud.disconnect(); break;
        case "sync": await cloud.sync(gameId); break;
        case "list": await cloud.list(string(gameId)); break;
        case "download": {
          const confirmation = await dialog.showMessageBox(parent, { type: "question", title: "Unduh versi OneDrive?", message: "Unduh ke riwayat backup lokal?", detail: "Save game belum diganti. Setelah selesai, pilih versi tersebut pada riwayat lokal dan konfirmasikan pemulihan.", buttons: ["Batal", "Unduh"], defaultId: 0, cancelId: 0, noLink: true });
          if (confirmation.response === 1) await cloud.download(string(gameId), string(input.name));
          break;
        }
        default: throw new Error("Perintah OneDrive tidak valid.");
      }
      return cloud.snapshot(gameId);
    });
  }
  switch (input.action) {
    case "open-save":
    case "open-backup": {
      // Resolve only saved configuration; never accept a renderer-supplied path.
      const snapshot = await controller.snapshot(gameId, true);
      const root = input.action === "open-save" ? snapshot.roots.find(item => item.id === string(input.rootId)) : undefined;
      if (input.action === "open-save" && !root) throw new Error("Lokasi save belum diatur atau sudah berubah. Deteksi ulang lokasi save.");
      const target = root ? (root.kind === "file" ? dirname(root.path) : root.path) : snapshot.backupDirectory;
      if (!target) throw new Error("Folder backup belum dipilih.");
      const info = await stat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") throw new Error(root ? "Lokasi save sudah tidak ditemukan. Deteksi ulang atau pilih lokasi save." : "Folder backup belum tersedia. Buat backup terlebih dahulu atau periksa folder sinkronisasi.");
        throw error;
      });
      if (info.isDirectory()) {
        const failure = await shell.openPath(target);
        if (failure) throw new Error(`Tidak dapat membuka folder: ${failure}`);
      } else throw new Error("Lokasi bukan file save atau folder yang dapat dibuka.");
      return snapshot;
    }
    case "open-recovery": {
      const recovery = (await controller.snapshot(string(gameId), true)).recovery;
      if (!recovery) throw new Error("Tidak ada catatan pemulihan terputus.");
      shell.showItemInFolder(recovery.journal);
      return controller.snapshot(gameId, true);
    }
    case "recover": {
      const recovery = (await controller.snapshot(string(gameId), true)).recovery;
      if (!recovery?.automatic) throw new Error("Catatan pemulihan memerlukan pemeriksaan manual. Buka folder catatan dan jangan hapus file pengaman.");
      const confirmation = await dialog.showMessageBox(parent, { type: "warning", title: "Tangani pemulihan terputus?", message: recovery.committed ? "Periksa dan selesaikan pemulihan sebelumnya?" : "Kembalikan kondisi sebelum pemulihan yang terputus?", detail: "Tutup game terlebih dahulu. File yang perlu dipindahkan tetap disimpan sebagai file pengaman di samping lokasi save. Jika kondisi tidak dapat dipastikan, operasi dihentikan untuk pemeriksaan manual.", buttons: ["Batal", "Lanjutkan"], defaultId: 0, cancelId: 0, noLink: true });
      if (confirmation.response === 1) await recoverPersonalBackup(string(gameId));
      break;
    }
    case "progress": return controller.progressSnapshot(gameId);
    case "snapshot": return controller.snapshot(gameId, input.lightweight === true);
    case "configure": {
      if (typeof input.enabled !== "boolean" || !Number.isInteger(input.retention)) throw new Error("Pengaturan tidak valid.");
      await controller.configure({ enabled: input.enabled, retention: input.retention as number, setupCompleted: input.setupCompleted as boolean | undefined });
      break;
    }
    case "destination": {
      const result = await dialog.showOpenDialog(parent, { title: "Pilih folder sinkronisasi cloud", properties: ["openDirectory", "createDirectory"] });
      if (!result.canceled && result.filePaths[0]) await controller.configure({ destination: result.filePaths[0] });
      break;
    }
    case "ludusavi": {
      const result = await dialog.showOpenDialog(parent, { title: "Pilih ludusavi.exe", filters: [{ name: "Ludusavi", extensions: ["exe"] }], properties: ["openFile"] });
      if (!result.canceled && result.filePaths[0]) await controller.configure({ ludusavi: result.filePaths[0] });
      break;
    }
    case "manifest": await controller.updateManifest(); break;
    case "detect": await controller.detect(string(gameId)); break;
    case "manual": {
      const properties: Array<"openDirectory" | "openFile" | "multiSelections"> = input.kind === "file" ? ["openFile", "multiSelections"] : ["openDirectory"];
      const result = await dialog.showOpenDialog(parent, { title: "Pilih lokasi save game", properties });
      if (!result.canceled && result.filePaths.length) await controller.manual(string(gameId), result.filePaths.map(file => ({ path: file })));
      break;
    }
    case "backup": await controller.backup(string(gameId)); break;
    case "restore": {
      const versionId = string(input.versionId);
      const snapshot = await controller.snapshot(string(gameId));
      const version = snapshot.versions.find(item => item.id === versionId);
      if (!version) throw new Error("Versi belum lengkap atau tidak tersedia.");
      const confirmation = await dialog.showMessageBox(parent, { type: "warning", title: "Pulihkan save game?", message: `Pulihkan backup ${new Date(version.createdAt).toLocaleString()}?`, detail: "Tutup game terlebih dahulu. Kondisi save saat ini akan dicadangkan sebelum diganti. File tambahan di lokasi save terpilih akan ikut diganti sesuai versi ini.", buttons: ["Batal", "Pulihkan"], defaultId: 0, cancelId: 0, noLink: true });
      if (confirmation.response === 1) await restorePersonalBackup(string(gameId), versionId);
      break;
    }
    default: throw new Error("Operasi tidak dikenal.");
  }
  return controller.snapshot(gameId);
});
