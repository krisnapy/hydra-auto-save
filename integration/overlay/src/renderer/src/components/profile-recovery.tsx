import { useRef, useState, useEffect } from "react";
import type { ProfileRecoverySnapshot } from "../../../main/services/personal-cloud-backup/core/profile-recovery.mjs";

export function ProfileRecoveryPanel({ gameId, disabled, onRestored }: { gameId?: string; disabled: boolean; onRestored: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ProfileRecoverySnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const sequence = useRef(0);
  useEffect(() => { mounted.current = true; sequence.current++; setSnapshot(undefined); setError(""); setBusy(false); return () => { mounted.current = false; sequence.current++; }; }, [gameId]);
  const command = async (name: string, values: Record<string, unknown> = {}) => {
    const current = ++sequence.current;
    setBusy(true); setError("");
    try {
      const result = await window.personalBackup.invoke({ action: "profile-recovery", command: name, gameId, ...values });
      if (mounted.current && current === sequence.current) setSnapshot(result);
      if (name === "restore" && mounted.current && current === sequence.current) await onRestored();
    } catch (failure) {
      if (!mounted.current || current !== sequence.current) return;
      setError(String(failure));
      if (name === "restore" || name === "local" || name === "onedrive") setSnapshot(undefined);
      // Import may have succeeded before restore failed. Refresh history for a retry.
      if (name === "restore") await onRestored();
    } finally { if (mounted.current && current === sequence.current) setBusy(false); }
  };
  const blocked = disabled || busy;
  const profiles = snapshot?.profiles ?? [];
  const profile = profiles.find(item => item.token === snapshot?.profileToken);
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
    {open && <>
      <p>{gameId ? "Pilih versi backup untuk game ini, lalu tentukan lokasi save pada profil baru." : "Pilih profil lama untuk melihat game yang dicadangkan. Pemulihan tersedia untuk game dengan ID yang sama di pustaka ini."} Atur folder backup lokal di Settings terlebih dahulu.</p>
      <div className="personal-backup__actions">
        <button disabled={blocked} onClick={() => void command("local")}>Cari backup di folder lama</button>
        <button disabled={blocked} onClick={() => void command("onedrive")}>Cari backup akun ini di OneDrive</button>
      </div>
      <p className="personal-backup__muted">Untuk OneDrive, gunakan akun Hydra dan OneDrive yang sama. Untuk backup lokal, pilih folder induk HydraPersonalBackup.</p>
      {error && <p role="alert" className="personal-backup__error">{error}</p>}
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
      {snapshot?.selection && <div role="group" aria-label="Tujuan pemulihan profil baru">
        <h4>Lokasi save pada profil baru</h4>
        <p>{snapshot.selection.ownership === "matched" ? "Backup cocok dengan akun aktif." : "Backup lama belum mencatat pemilik. Konfirmasi pemulihan juga menautkan salinannya ke profil Hydra aktif."}</p>
        <p>Pilih tujuan terpisah untuk setiap lokasi save {snapshot.selection.targetTitle}. Gunakan folder khusus game ini.</p>
        {snapshot.selection.roots.map((root, index) => <div key={root.id}>
          <p>Lokasi {index + 1} · {root.kind === "file" ? "File" : "Folder"} · {root.files} file</p>
          <p>ID lokasi: {root.id}</p>
          {root.originalPath && <p>Lokasi lama (keterangan): {root.originalPath}</p>}
          <p>Isi: {root.samples.map(sample => sample === "." ? "File tunggal" : sample).join(", ") || "Lokasi kosong atau tidak ada pada versi ini"}</p>
          <p>{root.target || "Tujuan belum dipilih"}</p>
          <button disabled={blocked} onClick={() => void command("map", { token: snapshot.selection!.token, rootId: root.id })}>Pilih tujuan lokasi {index + 1}</button>
        </div>)}
        <button disabled={blocked || snapshot.selection.roots.some(root => !root.target)} onClick={() => void command("restore", { token: snapshot.selection!.token })}>Pulihkan versi ini</button>
        <p className="personal-backup__muted">Konfirmasi menampilkan semua tujuan. Save saat ini dicadangkan sebelum diganti.</p>
      </div>}
    </>}
  </div>;
}
