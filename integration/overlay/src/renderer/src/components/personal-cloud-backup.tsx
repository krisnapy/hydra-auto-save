import { useCallback, useEffect, useRef, useState } from "react";
import type { BackupSnapshot } from "../../../main/services/personal-cloud-backup/core/controller.mjs";
import "./personal-cloud-backup.scss";

declare global {
  interface Window {
    personalBackup: { invoke: (request: Record<string, unknown>) => Promise<BackupSnapshot> };
  }
}

const labels: Record<string, string> = {
  waiting: "Menunggu perubahan", preparing: "Menyiapkan backup", complete: "Backup lokal selesai",
  failed: "Backup gagal", setup: "Perlu pengaturan", restored: "Pemulihan selesai",
};

const operationLabels: Record<string, string> = {
  automatic: "Backup otomatis", backup: "Backup", restore: "Pemulihan", settings: "Pengaturan", manual: "Pengaturan lokasi save", detect: "Deteksi lokasi save", manifest: "Pembaruan database",
};
const phaseLabels: Record<string, string> = {
  queued: "Menunggu giliran; operasi yang berjalan akan diselesaikan dahulu", preparing: "Menyiapkan operasi", detecting: "Mencari lokasi save", manifest: "Mengunduh database lokasi save",
  scanning: "Memeriksa isi save", stabilizing: "Menunggu penulisan save selesai", "checking-history": "Memeriksa riwayat backup", copying: "Menyalin dan memeriksa file",
  verifying: "Memeriksa kembali sumber save", publishing: "Menyelesaikan versi backup", retention: "Merapikan riwayat backup", "checking-restore": "Memeriksa game dan integritas backup",
  "restore-staging": "Menyiapkan file pemulihan", "restore-checking-source": "Memeriksa save sebelum penggantian", "restore-replacing": "Mengganti save", "restore-cleanup": "Menyelesaikan pemulihan", "rolling-back": "Mengembalikan kondisi save setelah kegagalan",
};
const phaseLabel = (phase: string) => phase.startsWith("safety-") ? `Backup pengaman: ${phaseLabels[phase.slice(7)] ?? phase.slice(7)}` : phaseLabels[phase] ?? phase;

export function PersonalCloudBackup({ gameId }: { gameId?: string }) {
  const [snapshot, setSnapshot] = useState<BackupSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  const requestNumber = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++requestNumber.current;
    try {
      const result = await window.personalBackup.invoke({ action: "snapshot", gameId });
      if (mounted.current && sequence === requestNumber.current) setSnapshot(result);
    } catch (failure) {
      if (mounted.current) setError(String(failure));
    }
  }, [gameId]);
  useEffect(() => {
    mounted.current = true;
    setSnapshot(undefined);
    setError("");
    let historyPending = true;
    let progressPending = false;
    void refresh().finally(() => { historyPending = false; });
    const timer = setInterval(() => {
      if (historyPending) return;
      historyPending = true;
      void refresh().finally(() => { historyPending = false; });
    }, 10000);
    const progress = async () => {
      if (progressPending) return;
      progressPending = true;
      const sequence = requestNumber.current;
      try {
        const result = await window.personalBackup.invoke({ action: "snapshot", gameId, lightweight: true });
        if (mounted.current && sequence === requestNumber.current) setSnapshot(previous => ({ ...result, versions: previous?.versions ?? [] }));
      } catch { /* The full refresh reports connection errors. */ }
      finally { progressPending = false; }
    };
    void progress();
    const progressTimer = setInterval(() => void progress(), 1000);
    return () => { mounted.current = false; requestNumber.current++; clearInterval(timer); clearInterval(progressTimer); };
  }, [refresh]);
  const action = async (name: string, values: Record<string, unknown> = {}) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await window.personalBackup.invoke({ action: name, gameId, ...values });
      if (mounted.current) {
        requestNumber.current++;
        setSnapshot(result);
        if (name === "manifest") setMessage("Database lokasi save diperbarui.");
        if (name === "detect") setMessage("Lokasi save ditemukan.");
        if (name === "backup") setMessage(result.lastOperation?.detail || "Backup lokal selesai. Riwayat diperbarui.");
        if (name === "restore") setMessage(result.lastOperation?.kind === "restore" && result.lastOperation.status === "complete" ? "Pemulihan selesai." : "Pemulihan dibatalkan.");
        if (["configure", "destination", "manual", "ludusavi"].includes(name)) setMessage("Pengaturan selesai diperbarui.");
      }
    } catch (failure) { if (mounted.current) setError(String(failure)); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className="personal-backup" aria-label="Personal Cloud Backup">
    <header><h3>Personal Cloud Backup</h3><span>Windows · Cloud pribadi</span></header>
    <p>Backup disimpan ke folder sinkronisasi milik Anda. Aplikasi cloud menangani unggahan.</p>
    {error && <p role="alert" className="personal-backup__error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {busy && <p role="status">Permintaan sedang diproses. Jika ada operasi lain, permintaan menunggu giliran.</p>}
    {snapshot && <>
      {snapshot.operations?.length > 0 ? <div className="personal-backup__progress" aria-live="polite">
        {snapshot.operations.map(operation => <div key={operation.id}>
          <p><strong>{operationLabels[operation.kind] ?? operation.kind}{operation.title && ` · ${operation.title}`}</strong></p>
          <p>{phaseLabel(operation.phase)}</p>
          {typeof operation.total === "number" && operation.total > 0
            ? <><progress max={operation.total} value={operation.completed ?? 0} aria-label={phaseLabel(operation.phase)} /><p>{operation.completed ?? 0} dari {operation.total} {operation.phase === "restore-replacing" ? "lokasi" : "file"} pada tahap ini</p></>
            : <progress aria-label={phaseLabel(operation.phase)} />}
          <small>Mulai {new Date(operation.startedAt).toLocaleTimeString()} · pembaruan tahap {new Date(operation.updatedAt).toLocaleTimeString()}</small>
        </div>)}
      </div> : <p role="status">Tidak ada operasi yang berjalan.</p>}
      {snapshot.lastOperation && (!gameId || snapshot.lastOperation.gameId === gameId) && <p role="status">
        {operationLabels[snapshot.lastOperation.kind] ?? snapshot.lastOperation.kind} terakhir: {snapshot.lastOperation.status === "failed" ? "gagal" : "selesai"} · {new Date(snapshot.lastOperation.at).toLocaleString()}
        {snapshot.lastOperation.detail && ` — ${snapshot.lastOperation.detail}`}
      </p>}
      {!gameId ? <>
        <label className="personal-backup__toggle"><input type="checkbox" checked={snapshot.enabled} disabled={busy} onChange={event => void action("configure", { enabled: event.target.checked, retention: snapshot.retention })} /> Auto Backup</label>
        <p>Aktif selama Hydra berjalan. Game Steam dan game PC kustom dengan executable yang diketahui didukung pada tahap awal.</p>
        <div className="personal-backup__row"><div><strong>Folder backup</strong><p>{snapshot.destination || "Belum dipilih"}</p></div><button disabled={busy} onClick={() => void action("destination")}>Pilih folder</button></div>
        <div className="personal-backup__row"><div><strong>Deteksi lokasi save</strong><p>{snapshot.ludusavi || "Pilih ludusavi.exe untuk deteksi otomatis, atau atur lokasi per game."}</p></div><button disabled={busy} onClick={() => void action("ludusavi")}>Pilih Ludusavi</button></div>
        <button disabled={busy || !snapshot.ludusavi} onClick={() => void action("manifest")}>Perbarui database lokasi save</button>
        <label>Riwayat per game pada perangkat ini <select disabled={busy} value={snapshot.retention} onChange={event => void action("configure", { enabled: snapshot.enabled, retention: Number(event.target.value) })}>{[5, 10, 20, 50, 100].map(value => <option key={value} value={value}>{value} versi</option>)}</select></label>
        <p>Backup pengaman sebelum pemulihan disimpan terpisah dari batas riwayat dan tidak dihapus otomatis.</p>
      </> : <>
        <p role="status"><strong>{!snapshot.enabled ? "Auto Backup nonaktif" : labels[snapshot.status.status] ?? snapshot.status.status}</strong>{snapshot.status.detail && ` — ${snapshot.status.detail}`}</p>
        <div className="personal-backup__actions">
          <button disabled={busy || !snapshot.destination || !snapshot.roots.length} onClick={() => void action("backup")}>Backup sekarang</button>
          <button disabled={busy || !snapshot.ludusavi} onClick={() => void action("detect")}>Deteksi lokasi save</button>
          <button disabled={busy} onClick={() => void action("manual", { kind: "directory" })}>Pilih folder save</button>
          <button disabled={busy} onClick={() => void action("manual", { kind: "file" })}>Pilih file save</button>
        </div>
        {!snapshot.destination && <p>Pilih folder backup di Settings → Personal Cloud Backup.</p>}
        <ul>{snapshot.roots.map(root => <li key={root.id}>{root.path}</li>)}</ul>
        <h4>Riwayat perangkat ini</h4>
        {snapshot.versions.length === 0 && <p>Belum ada backup lengkap yang dapat dipulihkan.</p>}
        <ul className="personal-backup__versions">{snapshot.versions.map(version => <li key={version.id}><div><strong>{new Date(version.createdAt).toLocaleString()}</strong><p>{version.files} file{version.safety ? " · Backup pengaman" : ""}</p></div><button disabled={busy} onClick={() => void action("restore", { versionId: version.id })}>Pulihkan</button></li>)}</ul>
      </>}
      <h4>Aktivitas terbaru</h4>
      {snapshot.activity.length === 0 && <p>Belum ada aktivitas backup.</p>}
      <ul>{snapshot.activity.slice(0, 10).map((item, index) => <li key={`${item.at}-${index}`}>{new Date(item.at).toLocaleString()} · {labels[item.status] ?? item.status}{!gameId && ` · ${item.gameId}`}{item.detail && ` — ${item.detail}`}</li>)}</ul>
      <p className="personal-backup__note">“Backup lokal selesai” belum membuktikan unggahan cloud selesai. Pemulihan selalu memerlukan konfirmasi dan game harus ditutup.</p>
    </>}
  </section>;
}
