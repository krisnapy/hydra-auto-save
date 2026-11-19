import { useRef, useState, useEffect } from "react";
import type { ProfileRecoverySnapshot } from "../../../main/services/personal-cloud-backup/core/profile-recovery.mjs";

export function ProfileRecoveryPanel({ gameId, disabled, onRestored }: { gameId: string; disabled: boolean; onRestored: () => Promise<void> }) {
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
      if (mounted.current && current === sequence.current) setError(String(failure));
      // Import may have succeeded before restore failed. Keep imported history
      // visible so the user can retry through the normal guarded restore flow.
      if (name === "restore") { await onRestored(); if (mounted.current && current === sequence.current) setSnapshot(undefined); }
    } finally { if (mounted.current && current === sequence.current) setBusy(false); }
  };
  const blocked = disabled || busy;
  return <div className="personal-backup__history" aria-label="Pemulihan profil lama">
    <button aria-expanded={open} onClick={() => setOpen(value => !value)}>Pulihkan dari perangkat/profil lama</button>
    {open && <>
      <p>Login Hydra dan hubungkan OneDrive yang sama untuk mencocokkan pemilik backup setelah install ulang. Pilih backup lama dan tentukan lokasi save untuk game ini pada profil baru. Atur folder backup lokal di Settings terlebih dahulu.</p>
      <div className="personal-backup__actions">
        <button disabled={blocked} onClick={() => void command("local")}>Cari backup di folder lama</button>
        <button disabled={blocked} onClick={() => void command("onedrive")}>Cari backup akun ini di OneDrive</button>
      </div>
      <p className="personal-backup__muted">OneDrive perlu terhubung. Pilih folder induk HydraPersonalBackup untuk sumber lokal. Backup sumber tidak dihapus.</p>
      {error && <p role="alert" className="personal-backup__error">{error}</p>}
      {busy && <p role="status">Memeriksa backup dan pemulihan profil…</p>}
      {snapshot?.notice && <p role="status">{snapshot.notice}</p>}
      {snapshot && !snapshot.sources.length && !busy && <p>Belum ada backup ditemukan. Pilih sumber yang berisi backup lengkap.</p>}
      {!!snapshot?.sources.length && <ul className="personal-backup__versions">{snapshot.sources.map(source => <li key={source.token}>
        <div><strong>{source.title}</strong><p>{source.ownership === "matched" ? "Akun cocok" : "Pemilik belum tercatat · perlu penautan manual"}</p><p>{new Date(source.createdAt).toLocaleString()} · {source.source === "local" ? "Lokal" : "OneDrive"}</p><p>Perangkat: {source.deviceId}</p>{source.gameId && <p>ID game: {source.gameId}</p>}</div>
        <button disabled={blocked} onClick={() => void command("select", { token: source.token })}>Pilih backup lama</button>
      </li>)}</ul>}
      {snapshot?.selection && <div role="group" aria-label="Tujuan pemulihan profil baru">
        <h4>Lokasi save pada profil baru</h4>
        <p>{snapshot.selection.ownership === "matched" ? "Backup cocok dengan akun aktif." : "Backup lama belum mencatat pemilik. Konfirmasi pemulihan juga menautkan salinannya ke profil Hydra aktif."}</p>
        <p>Pastikan backup {snapshot.selection.title} ({snapshot.selection.sourceGameId}) sesuai dengan {snapshot.selection.targetTitle}. Pilih tujuan terpisah untuk setiap lokasi; gunakan folder khusus save.</p>
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
