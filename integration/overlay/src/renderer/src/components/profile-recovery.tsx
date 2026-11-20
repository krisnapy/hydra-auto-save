import { useRef, useState, useEffect } from "react";
import type { ProfileRecoverySnapshot } from "../../../main/services/personal-cloud-backup/core/profile-recovery.mjs";
import type { ProfileRestoreStatus } from "../../../main/services/personal-cloud-backup/core/profile-restore-queue.mjs";

const restoreStatus: Record<ProfileRestoreStatus["status"], string> = {
  checking: "Memeriksa lokasi save",
  waiting: "Buka game, buat save jika belum ada, lalu tutup game.",
  "needs-location": "Lokasi save belum bisa dicocokkan. Batalkan antrean dan pilih ulang backup untuk menentukan tujuan secara manual.",
  choose: "Pilih profil tujuan.",
  restoring: "Menyiapkan pemulihan di latar belakang",
  finishing: "Mengganti save dan menyelesaikan pemulihan",
  complete: "Save dari profil lama berhasil dipulihkan. Backup sumber tetap tersimpan.",
  failed: "Pemulihan gagal.",
  cancelled: "Pemulihan dibatalkan.",
};
const active = ({ status }: ProfileRestoreStatus) => !["complete", "failed", "cancelled"].includes(status);

export function ProfileRecoveryPanel({ gameId, disabled, onRestored }: { gameId?: string; disabled: boolean; onRestored: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ProfileRecoverySnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<ProfileRestoreStatus[]>([]);
  const [pollRevision, setPollRevision] = useState(0);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const completions = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; sequence.current++; setSnapshot(undefined); setJobs([]); setError(""); setBusy(false); return () => { mounted.current = false; sequence.current++; }; }, [gameId]);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (disposed || pending || document.hidden) return;
      clearTimeout(timer);
      pending = true;
      try {
        const current: ProfileRestoreStatus[] = await window.personalBackup.invoke({ action: "profile-recovery", command: "pending", gameId });
        if (disposed || !Array.isArray(current)) return;
        setJobs(current);
        const completed = current.filter(job => job.status === "complete" && !completions.current.has(job.id));
        for (const job of completed) completions.current.add(job.id);
        if (completed.length) {
          setSnapshot(previous => previous && completed.some(job => job.gameId === previous.selection?.gameId) ? { ...previous, selection: null } : previous);
          void onRestored();
        }
        if (current.some(active)) timer = setTimeout(() => void poll(), 1500);
      } catch { /* The backup panel reports connection failures. */ }
      finally { pending = false; }
    };
    const onVisible = () => { clearTimeout(timer); if (!document.hidden) void poll(); };
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [gameId, onRestored, pollRevision]);
  const command = async (name: string, values: Record<string, unknown> = {}) => {
    const current = ++sequence.current;
    setBusy(true); setError("");
    try {
      const result = await window.personalBackup.invoke({ action: "profile-recovery", command: name, gameId, ...values });
      if (!mounted.current || current !== sequence.current) return;
      if (Array.isArray(result)) {
        setJobs(result);
        if (name === "cancel-pending") {
          const cancelled = result.find(job => job.id === values.jobId);
          setSnapshot(previous => previous && cancelled?.gameId === previous.selection?.gameId ? { ...previous, selection: null } : previous);
        }
      } else {
        setSnapshot(result);
        if (result.notice && (name === "restore" || name === "select")) await onRestored();
      }
      setPollRevision(revision => revision + 1);
    } catch (failure) {
      if (!mounted.current || current !== sequence.current) return;
      setError(String(failure));
      if (name === "restore" || name === "local" || name === "onedrive") setSnapshot(undefined);
      // Import may have succeeded before restore failed. Refresh history for a retry.
      if (name === "restore" || name === "select") await onRestored();
    } finally { if (mounted.current && current === sequence.current) setBusy(false); }
  };
  const blocked = disabled || busy;
  const profiles = snapshot?.profiles ?? [];
  const profile = profiles.find(item => item.token === snapshot?.profileToken);
  const selection = snapshot?.selection;
  const queued = selection && jobs.some(job => job.gameId === selection.gameId && active(job));
  const targetProfiles = selection?.targetProfiles ?? [];
  const missingTargets = selection?.roots.some(root => !root.target) ?? false;
  const collapseLocations = !missingTargets && (selection?.roots.length ?? 0) > 12;

  const locations = selection && !queued && !targetProfiles.length && selection.roots.map((root, index) => <div key={root.id}>
    <p>Lokasi {index + 1} · {root.kind === "file" ? "File" : "Folder"} · {root.files} file</p>
    {root.originalPath && <p>Lokasi pada backup lama (referensi): {root.originalPath}</p>}
    <p>Isi: {root.samples.map(sample => sample === "." ? "File tunggal" : sample).join(", ") || "Lokasi kosong atau tidak ada pada versi ini"}</p>
    <p>{root.target || "Tujuan belum dipilih"}</p>
    <button disabled={blocked} onClick={() => void command("map", { token: selection.token, rootId: root.id })}>{root.target ? "Ubah" : "Pilih"} tujuan lokasi {index + 1}</button>
  </div>);

  const sources = snapshot?.sources ?? [];
  const games = new Map<string, typeof sources>();
  for (const source of sources) {
    const versions = games.get(source.gameId);
    if (versions) versions.push(source);
    else games.set(source.gameId, [source]);
  }
  const renderVersions = (versions: typeof sources) => <ul className="personal-backup__versions">{versions.map(source => <li key={source.token}>
    <div>
      {gameId && <strong>{source.title}</strong>}
      <p>{source.ownership === "matched" ? "Akun cocok" : "Pemilik belum tercatat · perlu penautan manual"}</p>
      <p>{new Date(source.createdAt).toLocaleString()} · {source.source === "local" ? "Lokal" : "OneDrive"}</p>
      {gameId && <p>Perangkat: {source.deviceId}</p>}
    </div>
    {source.restorable && <button disabled={blocked} onClick={() => void command("select", { token: source.token })}>Pilih backup lama</button>}
  </li>)}</ul>;
  return <div className="personal-backup__history" aria-label="Pemulihan profil lama">
    <button aria-expanded={open} onClick={() => setOpen(value => !value)}>Pulihkan dari perangkat/profil lama</button>
    {jobs.map(job => <div key={job.id} className="personal-backup__progress">
      <p><strong>Pemulihan · {job.title}</strong></p>
      <p role={job.status === "failed" ? "alert" : "status"}>{restoreStatus[job.status]} {job.detail}</p>
      {job.status === "waiting" && <p>Antrean aktif selama Hydra berjalan.</p>}
      {job.status === "checking" && <div className="personal-backup__bar personal-backup__bar--indeterminate" role="progressbar" aria-label="Memeriksa lokasi save"><span /></div>}
      {job.status === "choose" && <ul className="personal-backup__versions">{job.targetProfiles?.map(profile => <li key={profile.token}>
        <div><strong>Profil {profile.name}</strong>{job.targetProfiles?.some(other => other !== profile && other.name === profile.name) && <p>{profile.folder}</p>}</div>
        <button disabled={busy} aria-label={`Pulihkan di sini, profil ${profile.name}`} onClick={() => void command("choose-pending", { jobId: job.id, targetProfile: profile.token })}>Pulihkan di sini</button>
      </li>)}</ul>}
      {active(job) && job.status !== "finishing" && <button disabled={busy} onClick={() => void command("cancel-pending", { jobId: job.id })}>Batalkan pemulihan</button>}
    </div>)}
    {error && <p role="alert" className="personal-backup__error">{error}</p>}
    {open && <>
      <p>{gameId ? "Pilih versi backup untuk game ini, lalu tentukan lokasi save pada profil baru." : "Pilih profil lama untuk melihat game yang dicadangkan. Pemulihan tersedia untuk game dengan ID yang sama di pustaka ini."} Atur folder backup lokal di Settings terlebih dahulu.</p>
      <div className="personal-backup__actions">
        <button disabled={blocked} onClick={() => void command("local")}>Cari backup di folder lama</button>
        <button disabled={blocked} onClick={() => void command("onedrive")}>Cari backup akun ini di OneDrive</button>
      </div>
      <p className="personal-backup__muted">Untuk OneDrive, gunakan akun Hydra dan OneDrive yang sama. Untuk backup lokal, pilih folder induk HydraPersonalBackup.</p>
      {busy && <p role="status">Memeriksa backup dan pemulihan profil…</p>}
      {snapshot?.notice && <p role="status">{snapshot.notice}</p>}
      {gameId ? <>
        {snapshot && !sources.length && !busy && <p>Belum ada backup untuk game ini.</p>}
        {!!sources.length && renderVersions(sources)}
      </> : snapshot && (profile ? <div role="region" aria-label="Detail profil lama">
        <button disabled={blocked} onClick={() => void command("profiles")}>Kembali ke daftar profil</button>
        <h4>{profile.name || `Profil ${profile.deviceId.slice(0, 8)}`}</h4>
        {[...games].map(([id, versions]) => <div key={id}>
          <h5>{versions[0].title}</h5>
          {versions[0].restorable ? renderVersions(versions) : <p>Game dengan ID ini belum tersedia di pustaka saat ini.</p>}
        </div>)}
      </div> : profiles.length ? <ul className="personal-backup__versions">{profiles.map(item => <li key={item.token}>
        <div><strong>{item.name || `Profil ${item.deviceId.slice(0, 8)}`}</strong><p>{item.source === "local" ? "Lokal" : "OneDrive"} · {item.gameCount} game · {new Date(item.createdAt).toLocaleString()}</p></div>
        <button disabled={blocked} onClick={() => void command("details", { token: item.token })}>Lihat detail profil</button>
      </li>)}</ul> : !busy && <p>Belum ada profil lama ditemukan.</p>)}
      {selection && !queued && <div role="group" aria-label="Tujuan pemulihan profil baru">
        <h4>Lokasi save pada profil baru</h4>
        <p>{selection.ownership === "matched" ? "Backup cocok dengan akun aktif." : "Backup lama belum mencatat pemilik. Konfirmasi pemulihan juga menautkan salinannya ke profil Hydra aktif."}</p>
        {targetProfiles.length ? <ul className="personal-backup__versions">{targetProfiles.map(profile => <li key={profile.token}>
          <div><strong>Profil {profile.name}</strong>{targetProfiles.some(other => other !== profile && other.name === profile.name) && <p>{profile.folder}</p>}</div>
          <button disabled={blocked} aria-label={`Pulihkan di sini, profil ${profile.name}`} onClick={() => void command("restore", { token: selection.token, targetProfile: profile.token })}>Pulihkan di sini</button>
        </li>)}</ul> : <>
        {missingTargets ? <p>Pilih tujuan untuk lokasi yang belum cocok. Jika game baru dipasang, buka {selection.targetTitle}, buat save, lalu tutup game.</p> : <p>Periksa tujuan di bawah, lalu konfirmasi pemulihan.</p>}
        {missingTargets && <button disabled={blocked} onClick={() => void command("defer", { token: selection.token })}>Pulihkan setelah game ditutup</button>}
        {collapseLocations ? <details key={selection.token}>
          <summary>Lihat {selection.roots.length} lokasi save</summary>
          {locations}
        </details> : locations}
        <button disabled={blocked || missingTargets} onClick={() => void command("restore", { token: selection.token })}>Pulihkan versi ini</button>
        </>}
        <p className="personal-backup__muted">Save saat ini dicadangkan sebelum diganti.</p>
      </div>}
    </>}
  </div>;
}
