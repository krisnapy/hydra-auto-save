import { useEffect, useRef, useState } from "react";
import type { CloudSnapshot } from "../../../main/services/personal-cloud-backup/core/cloud-sync.mjs";

export function PersonalOneDrive({ gameId, onDownloaded }: { gameId?: string; onDownloaded?: () => void }) {
  const [cloud, setCloud] = useState<CloudSnapshot>();
  const [clientId, setClientId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  const pending = useRef(false);
  const actionRunning = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    mounted.current = true; let disposed = false; let previous = "";
    const poll = async () => {
      if (document.hidden || pending.current || actionRunning.current || disposed) return;
      pending.current = true;
      const current = ++sequence.current;
      try {
        const result = await window.personalBackup.invoke({ action: "cloud", command: "snapshot", gameId });
        if (!disposed && current === sequence.current && result.provider === "onedrive" && JSON.stringify(result) !== previous) {
          previous = JSON.stringify(result); setCloud(result);
        }
      } catch (failure) { if (!disposed) setError(String(failure)); }
      finally { pending.current = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    document.addEventListener("visibilitychange", poll);
    return () => { disposed = true; mounted.current = false; clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [gameId]);
  const command = async (name: string, values: Record<string, unknown> = {}) => {
    actionRunning.current = true; sequence.current++;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await window.personalBackup.invoke({ action: "cloud", command: name, gameId, ...values });
      if (mounted.current) {
        setCloud(result);
        if (name === "download") { onDownloaded?.(); setMessage("Periksa riwayat lokal untuk memilih versi dan mengonfirmasi pemulihan. Save belum diganti."); }
      }
    } catch (failure) { if (mounted.current) setError(String(failure)); }
    finally { actionRunning.current = false; if (mounted.current) setBusy(false); }
  };
  if (!cloud) return error ? <p role="alert" className="personal-backup__error">OneDrive: {error}</p> : null;
  return <div className="personal-backup__onedrive" aria-label="OneDrive langsung">
    <div className="personal-backup__history-heading"><h4>OneDrive</h4><span>{cloud.connected ? "Terhubung" : cloud.login ? "Menunggu login" : "Belum terhubung"}</span></div>
    {!cloud.connected && !cloud.login && <>
      <button disabled={busy || !(clientId ?? cloud.clientId)} onClick={() => void command("login", { clientId: clientId ?? cloud.clientId })}>Hubungkan OneDrive</button>
      <details><summary>Pengaturan koneksi OneDrive</summary>
      <p>Hubungkan akun pribadi Microsoft untuk mengunggah backup langsung dari Hydra.</p>
      <label>Application (client) ID <input aria-label="Microsoft client ID" value={clientId ?? cloud.clientId} disabled={busy} placeholder="ID pendaftaran aplikasi Microsoft" onChange={event => setClientId(event.target.value)} /></label>
      <p className="personal-backup__muted">Client ID bawaan sudah disediakan. Ubah hanya untuk memakai pendaftaran aplikasi Microsoft Anda sendiri.</p>
    </details></>}
    {cloud.login && <>
      <p>Masukkan kode <strong className="personal-backup__login-code">{cloud.login.userCode}</strong> di microsoft.com/devicelogin. Gunakan hanya kode yang Anda mulai dari Hydra ini.</p>
      <p>Berlaku sampai {new Date(cloud.login.expiresAt).toLocaleTimeString()}. Status login diperiksa otomatis.</p>
      <button disabled={busy} onClick={() => void command("open-login")}>Buka login Microsoft</button>
    </>}
    {cloud.connected && <>
      <p role="status">{cloud.uploading ? "Mengunggah ke OneDrive…" : cloud.pending ? `${cloud.pending} backup menunggu unggahan` : "Antrean unggahan kosong"}</p>
      {cloud.lastUploadedAt && <p>Unggahan terverifikasi terakhir: {new Date(cloud.lastUploadedAt).toLocaleString()}</p>}
      <div className="personal-backup__actions"><button disabled={busy} onClick={() => void command("sync")}>Unggah backup terbaru / coba lagi</button>{gameId && <button disabled={busy} onClick={() => void command("list")}>Lihat versi OneDrive</button>}</div>
      {cloud.versions.length > 0 && <ul className="personal-backup__versions">{cloud.versions.map(version => <li key={version.name}><div><strong>{new Date(version.modifiedAt).toLocaleString()}</strong><p>{(version.size / 1024 ** 2).toFixed(2)} MiB · perangkat ini</p></div><button disabled={busy} onClick={() => void command("download", { name: version.name })}>Unduh ke riwayat</button></li>)}</ul>}
      <p className="personal-backup__muted">Versi 0.3: maksimal 32 MiB save per versi, perangkat ini saja. Unduhan masuk riwayat lokal; pemulihan tetap perlu dipilih dan dikonfirmasi. Riwayat cloud belum dihapus otomatis.</p>
    </>}
    {(cloud.connected || cloud.login) && <button disabled={busy} onClick={() => void command("disconnect")}>{cloud.login ? "Batalkan login" : "Putuskan koneksi"}</button>}
    {busy && <p role="status">Memproses permintaan OneDrive…</p>}
    {(error || cloud.error) && <p role="alert" className="personal-backup__error">{error || cloud.error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
