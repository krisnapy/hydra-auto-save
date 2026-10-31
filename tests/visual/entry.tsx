import React from "react";
import { createRoot } from "react-dom/client";
import { PersonalCloudBackup } from "../../integration/overlay/src/renderer/src/components/personal-cloud-backup";
import type { BackupSnapshot } from "../../module/controller.mjs";
import "./harness.css";

const gameId = "custom:visual-fixture";
const at = "2026-11-01T00:00:00+08:00";
const folder = "C:\\Users\\Player\\Saved Games\\Game Contoh\\Profil dengan nama panjang\\SaveData";
const version = (id: string, safety = false) => ({ id, createdAt: at, reason: "manual", safety, files: 10 });
const base: BackupSnapshot = {
  enabled: true, destination: "C:\\Users\\Player\\OneDrive\\Hydra Backups", backupDirectory: "C:\\Users\\Player\\OneDrive\\Hydra Backups\\HydraPersonalBackup\\pc-contoh\\game-contoh",
  ludusavi: "C:\\Hydra Personal Backup\\ludusavi.exe", retention: 10, deviceId: "pc-contoh",
  setup: { completed: true, games: [{ id: gameId, title: "Game Contoh", configured: true }] },
  storage: null, recovery: null, interrupted: [], operations: [],
  status: { status: "waiting" },
  roots: [{ id: "save-one", kind: "file", path: `${folder}\\slot-1.sav` }, { id: "save-two", kind: "file", path: `${folder}\\slot-2.sav` }],
  saveFolders: [{ rootId: "save-one", path: folder }], versions: [], activity: [],
};
const operation = (kind = "backup", phase = "copying", completed = 4, total = 10) => ({ id: "fixture-operation", kind, phase, completed, total, gameId, title: "Game Contoh", startedAt: at, updatedAt: at });
const scenario = new URLSearchParams(location.search).get("scenario") || "unconfigured";
let current = structuredClone(base);
switch (scenario) {
  case "unconfigured": current.roots = []; current.saveFolders = []; current.status = { status: "setup" }; break;
  case "backing-up": current.status = { status: "preparing" }; current.operations = [operation()]; break;
  case "complete": current.status = { status: "complete" }; current.versions = [version("latest")]; current.lastOperation = { kind: "backup", gameId, status: "complete", at }; break;
  case "history": current.versions = [version("latest"), version("previous"), version("safety", true)]; break;
  case "restoring": current.versions = [version("latest"), version("safety", true)]; current.operations = [operation("restore", "restore-staging", 2, 4)]; break;
  case "error": current.status = { status: "failed", detail: "Ruang penyimpanan tidak cukup. Backup lama tetap dipertahankan." }; current.lastOperation = { kind: "backup", gameId, status: "failed", at, detail: current.status.detail }; break;
  default: throw new Error(`Skenario tidak dikenal: ${scenario}`);
}
current.activity = [{ at, gameId, status: current.status.status, detail: current.status.detail ?? "Data contoh untuk pengujian tampilan." }];
let cloudState = { provider: "onedrive", clientId: "11111111-2222-3333-4444-555555555555", connected: false, login: null as null | { userCode: string; expiresAt: number; url: string }, pending: 0, uploaded: 0, uploading: false, error: "", versions: [] as Array<{ name: string; modifiedAt: string; size: number }> };
const calls: Record<string, unknown>[] = [];
const snapshot = () => structuredClone(current);
const invoke = async (request: Record<string, unknown>) => {
  calls.push(request);
  if (request.gameId !== gameId) throw new Error("UI meminta game di luar fixture.");
  if (request.action === "cloud") {
    if (request.command === "login") cloudState.login = { userCode: "ABCD-EFGH", expiresAt: Date.now() + 900000, url: "https://microsoft.com/devicelogin" };
    if (request.command === "disconnect") { cloudState.connected = false; cloudState.login = null; }
    if (request.command === "list") cloudState.versions = [{ name: "fixture-package.hpb", modifiedAt: at, size: 1024 }];
    if (request.command === "download") current.versions = [version("downloaded")];
    return structuredClone(cloudState);
  }
  if (request.action === "progress") return structuredClone({ operations: current.operations, lastOperation: current.lastOperation });
  if (request.action === "snapshot" || request.action === "open-save" || request.action === "open-backup") return snapshot();
  if (request.action === "backup" || request.action === "restore") {
    if (scenario === "error") throw new Error(current.status.detail);
    if (request.action === "restore" && !window.confirm("Simulasi konfirmasi pemulihan. Tidak ada file yang diganti.")) return snapshot();
    const restoring = request.action === "restore";
    current.operations = [operation(restoring ? "restore" : "backup", restoring ? "restore-staging" : "copying")];
    await new Promise(resolve => setTimeout(resolve, 1200));
    current.operations = [];
    current.status = { status: restoring ? "restored" : "complete" };
    current.versions = [version("latest"), version("previous"), version("safety", true)];
    current.lastOperation = { kind: restoring ? "restore" : "backup", gameId, status: "complete", at };
    return snapshot();
  }
  throw new Error(`Aksi fixture tidak didukung: ${request.action}`);
};
window.personalBackup = { invoke: invoke as typeof window.personalBackup.invoke };
Object.assign(window, { visualFixture: { calls, connectCloud: () => { cloudState.connected = true; cloudState.login = null; cloudState.pending = 1; }, completeAutomatic: () => { current.operations = []; current.status = { status: "complete" }; current.versions = [version("automatic")]; current.lastOperation = { kind: "automatic", gameId, status: "complete", at }; }, setProgress: (completed: number) => { current.operations[0].completed = completed; } } });
createRoot(document.getElementById("root")!).render(<main className="visual-harness">
  <p className="visual-harness__notice">UJI TAMPILAN · DATA CONTOH · {scenario}</p>
  <h1>Game Contoh</h1>
  <p>Panel halaman game memakai komponen dan stylesheet aplikasi. Bingkai ini khusus pengujian.</p>
  <PersonalCloudBackup gameId={gameId} />
</main>);
