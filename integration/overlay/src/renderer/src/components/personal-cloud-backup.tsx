import { useCallback, useEffect, useRef, useState } from "react";
import type { BackupSnapshot, BackupProgress } from "../../../main/services/personal-cloud-backup/core/controller.mjs";
import "./personal-cloud-backup.scss";

declare global {
  interface Window {
    personalBackup: {
      invoke(request: { action: "progress"; gameId?: string }): Promise<BackupProgress>;
      invoke(request: Record<string, unknown>): Promise<BackupSnapshot>;
    };
  }
}

const labels: Record<string, string> = {
  waiting: "Menunggu perubahan", preparing: "Menyiapkan backup", complete: "Backup lokal selesai",
  failed: "Backup gagal", setup: "Perlu pengaturan", restored: "Pemulihan selesai",
};

const operationLabels: Record<string, string> = {
  recover: "Penanganan pemulihan", automatic: "Backup otomatis", backup: "Backup", restore: "Pemulihan", settings: "Pengaturan", manual: "Pengaturan lokasi save", detect: "Deteksi lokasi save", manifest: "Pembaruan database",
};
const phaseLabels: Record<string, string> = {
  queued: "Menunggu giliran; operasi yang berjalan akan diselesaikan dahulu", preparing: "Menyiapkan operasi", detecting: "Mencari lokasi save", manifest: "Mengunduh database lokasi save",
  scanning: "Membaca isi save untuk mencari perubahan", stabilizing: "Menunggu jeda aman penulisan save (1,2 detik)", "checking-stability": "Membaca ulang save untuk memastikan isinya stabil", "checking-history": "Memeriksa riwayat backup", copying: "Menyalin dan memeriksa file",
  verifying: "Memeriksa kembali sumber save", publishing: "Menyelesaikan versi backup", retention: "Merapikan riwayat backup", "checking-restore": "Memeriksa game dan integritas backup",
  "restore-staging": "Menyiapkan file pemulihan", "restore-checking-source": "Memeriksa save sebelum penggantian", "restore-replacing": "Mengganti save", "restore-cleanup": "Menyelesaikan pemulihan", "rolling-back": "Mengembalikan kondisi save setelah kegagalan",
};
const phaseLabel = (phase: string) => phase.startsWith("safety-") ? `Backup pengaman: ${phaseLabels[phase.slice(7)] ?? phase.slice(7)}` : phaseLabels[phase] ?? phase;


export function BackupProgressPanel({ gameId, busy, compact = false, onCompleted }: { gameId?: string; busy: boolean; compact?: boolean; onCompleted?: () => void }) {
  const lastCompletion = useRef<string>();
  const [progress, setProgress] = useState<BackupProgress>({ operations: [] });
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous = "";
    const poll = async () => {
      if (disposed || pending || document.hidden) return;
      clearTimeout(timer);
      pending = true;
      let active = busy;
      try {
        const result = await window.personalBackup.invoke({ action: "progress", gameId });
        active ||= result.operations.length > 0;
        const completion = JSON.stringify(result.lastOperation ?? null);
        if (!disposed) {
          if (lastCompletion.current !== undefined && completion !== lastCompletion.current && result.lastOperation) onCompleted?.();
          lastCompletion.current = completion;
        }
        const serialized = JSON.stringify(result);
        if (!disposed && previous !== serialized) { previous = serialized; setProgress(result); }
      } catch { /* Full snapshots report connection errors. */ }
      finally {
        pending = false;
        if (!disposed && !document.hidden) timer = setTimeout(() => void poll(), active ? 250 : 1000);
      }
    };
    const onVisible = () => { clearTimeout(timer); if (!document.hidden) void poll(); };
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [gameId, busy, onCompleted]);
  return <>
    {progress.operations.length > 0 ? <div className="personal-backup__progress">
      {progress.operations.map(operation => {
        const determinate = typeof operation.total === "number" && operation.total > 0;
        const percent = determinate ? Math.max(0, Math.min(100, (operation.completed ?? 0) / operation.total! * 100)) : undefined;
        return <div key={operation.id}>
          <p><strong>{operationLabels[operation.kind] ?? operation.kind}{operation.title && ` · ${operation.title}`}</strong></p>
          <p role="status">{phaseLabel(operation.phase)}</p>
          <div key={operation.phase} className={`personal-backup__bar${determinate ? "" : " personal-backup__bar--indeterminate"}`} role="progressbar" aria-label={phaseLabel(operation.phase)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={determinate ? { transform: `scaleX(${percent! / 100})` } : undefined} />
          </div>
          {!determinate && typeof operation.completed === "number" && <p>{operation.completed} file telah diperiksa pada tahap ini</p>}
          {determinate && <p>{operation.completed ?? 0} dari {operation.total} {operation.phase === "restore-replacing" ? "lokasi" : "file"} pada tahap ini</p>}
          {!compact && <small>Mulai {new Date(operation.startedAt).toLocaleTimeString()}</small>}
        </div>;
      })}
    </div> : busy || !compact ? <p role="status">{busy ? "Menyiapkan permintaan…" : "Tidak ada operasi yang berjalan."}</p> : null}
    {!compact && progress.lastOperation?.kind && <p role="status">
      {operationLabels[progress.lastOperation.kind] ?? progress.lastOperation.kind} terakhir: {progress.lastOperation.status === "failed" ? "gagal" : "selesai"} · {new Date(progress.lastOperation.at).toLocaleString()}
      {progress.lastOperation.detail && ` — ${progress.lastOperation.detail}`}
    </p>}
  </>;
}

const shortFolder = (value: string) => value.split(/[\\/]+/).filter(Boolean).slice(-2).join(" › ");
const backupDate = (value: string) => {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? `Hari ini, ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

function GameBackupView({ snapshot, busy, opening, error, message, gameId, action, openLocation, refresh }: {
  snapshot: BackupSnapshot; busy: boolean; opening: boolean; error: string; message: string; gameId: string; refresh: () => Promise<void>;
  action: (name: string, values?: Record<string, unknown>) => Promise<void>;
  openLocation: (name: "open-save" | "open-backup" | "open-recovery", rootId?: string) => Promise<void>;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const latest = snapshot.versions.find(version => !version.safety);
  const ready = Boolean(snapshot.destination && snapshot.roots.length);
  const blocked = busy || Boolean(snapshot.recovery);
  const failed = snapshot.status.status === "failed";
  const badge = snapshot.recovery ? "Pemulihan terputus" : failed ? "Backup gagal" : !ready ? "Belum diatur" : !snapshot.enabled ? "Auto Backup nonaktif" : "Auto Backup aktif";
  return <section className="personal-backup personal-backup--game" aria-label="Personal Cloud Backup">
    <div className="personal-backup__context">
      <p className="personal-backup__eyebrow">SAVE GAME</p>
      <h3>Backup pribadi</h3>
      <p className="personal-backup__muted">Kelola salinan progres game ini.</p>
      <div className="personal-backup__folder-group">
        <h4>Lokasi save</h4>
        {!snapshot.roots.length && <p className="personal-backup__muted">Lokasi save belum dikenali. Pilih lokasi atau jalankan deteksi.</p>}
        {snapshot.saveFolders.map(folder => <div key={folder.rootId} className="personal-backup__folder">
          <span title={folder.path}>{shortFolder(folder.path)}</span>
          <button disabled={opening} onClick={() => void openLocation("open-save", folder.rootId)}>Buka folder save</button>
        </div>)}
      </div>
      <details className="personal-backup__details"><summary>Detail lokasi dan aktivitas</summary>
        <h4>Folder save lengkap</h4>
        {snapshot.saveFolders.map(folder => <p key={folder.rootId}>{folder.path}</p>)}
        <h4>Folder backup game ini</h4><p>{snapshot.backupDirectory || "Folder backup belum dipilih"}</p>
        <button disabled={opening || !snapshot.backupDirectory} onClick={() => void openLocation("open-backup")}>Buka lokasi backup</button>
        <h4>Aktivitas terbaru</h4>
        {!snapshot.activity.length && <p>Belum ada aktivitas backup.</p>}
        <ul>{snapshot.activity.slice(0, 10).map((item, index) => <li key={`${item.at}-${index}`}>{new Date(item.at).toLocaleString()} · {labels[item.status] ?? item.status}{item.detail && ` — ${item.detail}`}</li>)}</ul>
      </details>
    </div>
    <div className="personal-backup__card">
      <header><h3><span className="personal-backup__cloud" aria-hidden="true">☁</span> Personal Cloud</h3><span className={`personal-backup__badge${failed || snapshot.recovery ? " personal-backup__badge--warning" : ""}`}>{badge}</span></header>
      {error && <p role="alert" className="personal-backup__error">{error}</p>}
      {snapshot.storage?.warning && <p role="alert" className="personal-backup__warning">{snapshot.storage.detail}{typeof snapshot.storage.availableBytes === "number" && ` Tersisa ${(snapshot.storage.availableBytes / 1024 ** 3).toFixed(2)} GB.`}</p>}
      {snapshot.recovery && <div role="alert" className="personal-backup__warning">
        <strong>Pemulihan terputus</strong><p>Backup dan pemulihan baru diblokir. Tutup game sebelum melanjutkan.</p>
        <p>{snapshot.recovery.automatic ? snapshot.recovery.committed ? "Hasil pemulihan sebelumnya akan diperiksa." : "Penanganan akan mencoba mengembalikan kondisi sebelumnya dan mempertahankan file pengaman." : "Catatan lama atau rusak memerlukan pemeriksaan manual. Jangan hapus catatan atau file hydra-previous/hydra-interrupted."}</p>
        <div className="personal-backup__actions"><button disabled={opening} onClick={() => void openLocation("open-recovery")}>Buka catatan pemulihan</button>{snapshot.recovery.automatic && <button disabled={busy} onClick={() => void action("recover")}>Tangani pemulihan</button>}</div>
      </div>}
      <div className="personal-backup__summary">
        <p className="personal-backup__muted">{latest ? "Backup lokal terakhir" : "Belum ada backup lengkap"}</p>
        <p className="personal-backup__latest">{latest ? backupDate(latest.createdAt) : "Lindungi progres Anda"}</p>
        <p className="personal-backup__muted">{snapshot.versions.length ? `${snapshot.versions.length} versi di perangkat ini` : ready ? "Buat salinan save pertama Anda." : "Atur lokasi save dan folder backup untuk mulai."}</p>
      </div>
      <BackupProgressPanel key={gameId} gameId={gameId} busy={busy} compact onCompleted={refresh} />
      {snapshot.status.status !== "waiting" && !(failed && error) && <p role={failed ? "alert" : "status"} className={failed ? "personal-backup__error" : "personal-backup__muted"}>{labels[snapshot.status.status] ?? snapshot.status.status}{snapshot.status.detail && ` — ${snapshot.status.detail}`}</p>}
      {message && <p role="status" className="personal-backup__feedback">{message}</p>}
      <div className="personal-backup__actions personal-backup__primary-actions">
        <button className="personal-backup__primary" disabled={blocked || !ready} onClick={() => void action("backup")}>Backup sekarang</button>
        <button disabled={blocked || !snapshot.versions.length} aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>Pulihkan</button>
        <button className="personal-backup__more" aria-label="Pilihan backup" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(value => !value)}>⋯</button>
      </div>
      {!ready && <div className="personal-backup__setup">
        {!snapshot.destination && <p>Pilih folder backup di Settings → Personal Cloud Backup.</p>}
        {!snapshot.roots.length && <div className="personal-backup__actions"><button disabled={busy || !snapshot.ludusavi} onClick={() => void action("detect")}>Deteksi lokasi save</button><button disabled={busy} onClick={() => void action("manual", { kind: "directory" })}>Pilih folder save</button></div>}
      </div>}
      {optionsOpen && <div className="personal-backup__options" role="group" aria-label="Pengaturan save">
        <button disabled={busy || !snapshot.ludusavi} onClick={() => void action("detect")}>Deteksi ulang lokasi save</button>
        <button disabled={busy} onClick={() => void action("manual", { kind: "directory" })}>Pilih folder save</button>
        <button disabled={busy} onClick={() => void action("manual", { kind: "file" })}>Pilih file save</button>
        <button disabled={opening || !snapshot.backupDirectory} onClick={() => void openLocation("open-backup")}>Buka folder backup</button>
      </div>}
      {historyOpen && <div className="personal-backup__history">
        <div className="personal-backup__history-heading"><h4>Pilih versi pemulihan</h4><button onClick={() => setHistoryOpen(false)} aria-label="Tutup riwayat">Tutup</button></div>
        <p className="personal-backup__muted">Tutup game terlebih dahulu. Save saat ini akan dicadangkan sebelum diganti. Konfirmasi muncul setelah memilih versi.</p>
        <ul className="personal-backup__versions">{snapshot.versions.map(version => <li key={version.id}><div><strong>{backupDate(version.createdAt)}</strong><p>{version.files} file{version.safety ? " · Backup pengaman" : version.id === latest?.id ? " · Terbaru" : ""}</p></div><button disabled={blocked} onClick={() => void action("restore", { versionId: version.id })} aria-label={`Pulihkan versi ${new Date(version.createdAt).toLocaleString()}${version.safety ? " backup pengaman" : ""}`}>Pilih versi</button></li>)}</ul>
      </div>}
      <p className="personal-backup__cloud-note">Folder sinkronisasi pribadi · Status unggahan cloud belum diverifikasi.</p>
    </div>
  </section>;
}

export function PersonalCloudBackup({ gameId }: { gameId?: string }) {
  const [snapshot, setSnapshot] = useState<BackupSnapshot>();
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(false);
  const [selectedGame, setSelectedGame] = useState("");
  const [opening, setOpening] = useState(false);
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
    void refresh().finally(() => { historyPending = false; });
    const timer = setInterval(() => {
      if (historyPending || document.hidden) return;
      historyPending = true;
      void refresh().finally(() => { historyPending = false; });
    }, 10000);
    const onVisible = () => {
      if (document.hidden) return;
      if (!historyPending) {
        historyPending = true;
        void refresh().finally(() => { historyPending = false; });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { mounted.current = false; requestNumber.current++; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
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
  const openLocation = async (name: "open-save" | "open-backup" | "open-recovery", rootId?: string, selectedId = gameId) => {
    setOpening(true); setError("");
    try { await window.personalBackup.invoke({ action: name, gameId: selectedId, rootId }); }
    catch (failure) { if (mounted.current) setError(String(failure)); }
    finally { if (mounted.current) setOpening(false); }
  };
  if (gameId) return snapshot
    ? <GameBackupView key={gameId} {...{ snapshot, busy, opening, error, message, gameId, action, openLocation, refresh }} />
    : <section className="personal-backup" aria-label="Personal Cloud Backup"><h3>Personal Cloud</h3><p role={error ? "alert" : "status"}>{error || "Memuat status backup…"}</p></section>;
  const guideGame = snapshot?.setup.games.find(game => game.id === selectedGame) ?? snapshot?.setup.games[0];
  const showGuide = guideOpen || (!snapshot?.setup.completed && !guideDismissed);
  return <section className="personal-backup" aria-label="Personal Cloud Backup">
    <header><h3>Personal Cloud Backup</h3><span>Windows · Cloud pribadi</span></header>
    <p>Backup disimpan ke folder sinkronisasi milik Anda. Aplikasi cloud menangani unggahan.</p>
    {error && <p role="alert" className="personal-backup__error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {busy && <p role="status">Permintaan sedang diproses. Jika ada operasi lain, permintaan menunggu giliran.</p>}
    {snapshot && <>
      {snapshot.storage?.warning && <p role="alert" className="personal-backup__warning">{snapshot.storage.detail}{typeof snapshot.storage.availableBytes === "number" && ` Tersisa ${(snapshot.storage.availableBytes / 1024 ** 3).toFixed(2)} GB.`}</p>}
      {(gameId ? snapshot.recovery ? [{ id: gameId, title: "Game ini", recovery: snapshot.recovery }] : [] : snapshot.interrupted).map(item => <div key={item.id} role="alert" className="personal-backup__warning">
        <strong>Pemulihan terputus · {item.title}</strong>
        <p>Backup dan pemulihan baru untuk game ini diblokir. Tutup game sebelum melanjutkan.</p>
        <p>{item.recovery?.automatic ? item.recovery.committed ? "Aplikasi akan memeriksa hasil pemulihan sebelumnya." : "Penanganan akan mencoba mengembalikan kondisi sebelumnya, sambil mempertahankan file yang dipindahkan." : "Catatan lama atau rusak memerlukan pemeriksaan manual. Jangan hapus catatan atau file hydra-previous/hydra-interrupted. Periksa salinan save dan backup pengaman sebelum mengubahnya."}</p>
        <div className="personal-backup__actions"><button disabled={opening} onClick={() => void openLocation("open-recovery", undefined, item.id)}>Buka catatan pemulihan</button>{item.recovery?.automatic && <button disabled={busy} onClick={() => void action("recover", { gameId: item.id })}>Tangani pemulihan</button>}</div>
      </div>)}
      <BackupProgressPanel key={gameId ?? "all"} gameId={gameId} busy={busy} />
      {!gameId ? <>
        {showGuide ? <div className="personal-backup__guide">
          <h4>Mulai backup pribadi</h4>
          <p>1. {snapshot.destination ? "✓ Folder tujuan dipilih" : "Pilih folder tujuan backup"}</p>
          <button disabled={busy} onClick={() => void action("destination")}>Pilih folder backup</button>
          <p>2. Pilih game dan tentukan lokasi save</p>
          {snapshot.setup.games.length ? <>
            <select aria-label="Game untuk pengaturan awal" value={guideGame?.id ?? ""} disabled={busy} onChange={event => setSelectedGame(event.target.value)}>{snapshot.setup.games.map(game => <option key={game.id} value={game.id}>{game.title}{game.configured ? " · lokasi siap" : ""}</option>)}</select>
            <div className="personal-backup__actions"><button disabled={busy || !snapshot.ludusavi} onClick={() => void action("detect", { gameId: guideGame?.id })}>Deteksi save game</button><button disabled={busy} onClick={() => void action("manual", { gameId: guideGame?.id, kind: "directory" })}>Pilih folder save</button><button disabled={busy} onClick={() => void action("manual", { gameId: guideGame?.id, kind: "file" })}>Pilih file save</button></div>
          </> : <p>Tambahkan game PC ke pustaka Hydra dan tentukan executable game terlebih dahulu.</p>}
          <p>3. {snapshot.setup.firstBackupAt ? "✓ Backup percobaan berhasil" : "Buat backup percobaan"}</p>
          <button disabled={busy || !snapshot.destination || !guideGame?.configured} onClick={() => void action("backup", { gameId: guideGame?.id })}>Buat backup percobaan</button>
          <p>4. Aktifkan Auto Backup untuk memantau perubahan selama aplikasi berjalan.</p>
          <div className="personal-backup__actions"><button disabled={busy || !snapshot.setup.firstBackupAt || !snapshot.destination} onClick={() => void action("configure", { enabled: true, retention: snapshot.retention, setupCompleted: true }).then(() => setGuideOpen(false))}>Aktifkan dan selesaikan</button><button disabled={busy} onClick={() => { setGuideOpen(false); setGuideDismissed(true); }}>Nanti</button></div>
        </div> : <button disabled={busy} onClick={() => setGuideOpen(true)}>Buka panduan pengaturan awal</button>}
        <label className="personal-backup__toggle"><input type="checkbox" checked={snapshot.enabled} disabled={busy} onChange={event => void action("configure", { enabled: event.target.checked, retention: snapshot.retention })} /> Auto Backup</label>
        <p>Aktif selama Hydra berjalan. Game Steam dan game PC kustom dengan executable yang diketahui didukung pada tahap awal.</p>
        <div className="personal-backup__row"><div><strong>Folder backup</strong><p>{snapshot.destination || "Belum dipilih"}</p></div><div className="personal-backup__actions"><button disabled={opening || !snapshot.destination} onClick={() => void openLocation("open-backup")}>Buka lokasi backup</button><button disabled={busy} onClick={() => void action("destination")}>Pilih folder</button></div></div>
        <div className="personal-backup__row"><div><strong>Deteksi lokasi save</strong><p>{snapshot.ludusavi || "Pilih ludusavi.exe untuk deteksi otomatis, atau atur lokasi per game."}</p></div><button disabled={busy} onClick={() => void action("ludusavi")}>Pilih Ludusavi</button></div>
        <button disabled={busy || !snapshot.ludusavi} onClick={() => void action("manifest")}>Perbarui database lokasi save</button>
        <label>Riwayat per game pada perangkat ini <select disabled={busy} value={snapshot.retention} onChange={event => void action("configure", { enabled: snapshot.enabled, retention: Number(event.target.value) })}>{[5, 10, 20, 50, 100].map(value => <option key={value} value={value}>{value} versi</option>)}</select></label>
        <p>Backup pengaman sebelum pemulihan disimpan terpisah dari batas riwayat dan tidak dihapus otomatis.</p>
      </> : null}
      <h4>Aktivitas terbaru</h4>
      {snapshot.activity.length === 0 && <p>Belum ada aktivitas backup.</p>}
      <ul>{snapshot.activity.slice(0, 10).map((item, index) => <li key={`${item.at}-${index}`}>{new Date(item.at).toLocaleString()} · {labels[item.status] ?? item.status}{!gameId && ` · ${item.gameId}`}{item.detail && ` — ${item.detail}`}</li>)}</ul>
      <p className="personal-backup__note">“Backup lokal selesai” belum membuktikan unggahan cloud selesai. Pemulihan selalu memerlukan konfirmasi dan game harus ditutup.</p>
    </>}
  </section>;
}
