import { dialog } from "electron";
import { registerEvent } from "./register-event";
import { assertTrustedEpicSender } from "./epic/assert-trusted-sender";
import { WindowManager } from "../services/window-manager";
import { getPersonalBackup, restorePersonalBackup } from "../services/personal-cloud-backup";

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
  switch (input.action) {
    case "snapshot": return controller.snapshot(gameId, input.lightweight === true);
    case "configure": {
      if (typeof input.enabled !== "boolean" || !Number.isInteger(input.retention)) throw new Error("Pengaturan tidak valid.");
      await controller.configure({ enabled: input.enabled, retention: input.retention as number });
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
