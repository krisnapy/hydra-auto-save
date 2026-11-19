import { useEffect, useRef, useState } from "react";
import type { CloudSnapshot } from "../../../main/services/personal-cloud-backup/core/cloud-sync.mjs";

export function PersonalOneDrive({ gameId, onDownloaded }: { gameId?: string; onDownloaded?: () => void }) {
  const [cloud, setCloud] = useState<CloudSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  const pending = useRef(false);
  const actionRunning = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    mounted.current = true; let disposed = false; let previous = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed && !document.hidden) timer = setTimeout(() => void poll(), 5000);
    };
    const poll = async () => {
      if (document.hidden || disposed) return;
      if (pending.current || actionRunning.current) { schedule(); return; }
      pending.current = true;
      const current = ++sequence.current;
      try {
        const result = await window.personalBackup.invoke({ action: "cloud", command: "snapshot", gameId });
        if (!disposed && current === sequence.current && result.provider === "onedrive" && JSON.stringify(result) !== previous) {
          previous = JSON.stringify(result); setCloud(result);
        }
      } catch (failure) { if (!disposed) setError(String(failure)); }
      finally { pending.current = false; schedule(); }
    };
    const onVisible = () => { clearTimeout(timer); if (!document.hidden) void poll(); };
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => { disposed = true; mounted.current = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [gameId]);
  const command = async (name: string, values: Record<string, unknown> = {}) => {
    actionRunning.current = true; sequence.current++;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await window.personalBackup.invoke({ action: "cloud", command: name, gameId, ...values });
      if (mounted.current) {
        setCloud(result);
        if (name === "download") { onDownloaded?.(); setMessage("Periksa riwayat lokal untuk memilih versi dan mengonfirmasi pemulihan. Save belum diganti."); }
        if (name === "optimize") setMessage(result.notice || "Pemeriksaan optimisasi cloud selesai.");
      }
    } catch (failure) { if (mounted.current) setError(String(failure)); }
    finally { actionRunning.current = false; if (mounted.current) setBusy(false); }
  };
  if (!cloud) return error ? <p role="alert" className="personal-backup__error">OneDrive: {error}</p> : null;
  const accountBlocked = Boolean(cloud.account && !cloud.account.matched);
  return <div className="personal-backup__onedrive" aria-label="OneDrive langsung">
    <div className="personal-backup__history-heading"><h4>OneDrive</h4><span>{cloud.connected ? "Terhubung" : cloud.login ? "Menunggu login" : "Belum terhubung"}</span></div>
    {cloud.account && <div role="status">
      <p>Profil Hydra: {cloud.account.hydra ? `${cloud.account.hydra.userId} · ${cloud.account.hydra.server}` : "Belum login"}</p>
      <p>Akun OneDrive: {cloud.account.oneDriveDriveId || "Belum terhubung"}</p>
      <p>{cloud.account.matched ? "Pasangan akun Hydra dan OneDrive cocok. Backup dari perangkat lama dicocokkan dengan pasangan ini." : cloud.account.hydra ? "Hubungkan OneDrive untuk menautkannya ke profil Hydra ini." : "Login Hydra terlebih dahulu untuk menautkan OneDrive dan mencocokkan pemilik backup."}</p>
    </div>}
    {!!cloud.held && <p role="status">{cloud.held} antrean lama ditahan karena pasangan akun belum cocok. Backup lokal tetap tersedia.</p>}
    {!cloud.connected && !cloud.login && <>
      <p>Hubungkan akun pribadi Microsoft untuk mengunggah backup langsung dari Hydra.</p>
      <button disabled={busy || !cloud.clientId || cloud.account?.hydra === null} onClick={() => void command("login", { clientId: cloud.clientId })}>Hubungkan OneDrive</button>
      {!cloud.clientId && <p role="status">Koneksi OneDrive belum tersedia pada build ini. Gunakan folder sinkronisasi lokal atau pasang versi dengan dukungan OneDrive.</p>}
    </>}
    {cloud.login && <>
      <p>Masukkan kode <strong className="personal-backup__login-code">{cloud.login.userCode}</strong> di {cloud.login.url}. Gunakan hanya kode yang Anda mulai dari Hydra ini.</p>
      <p>Berlaku sampai {new Date(cloud.login.expiresAt).toLocaleTimeString()}. Status login diperiksa otomatis.</p>
      <button disabled={busy} onClick={() => void command("open-login")}>Buka login Microsoft</button>
    </>}
    {cloud.connected && <>
      <p role="status">{cloud.uploading ? "Mengunggah ke OneDrive…" : cloud.pending ? `${cloud.pending} backup menunggu unggahan` : "Antrean unggahan kosong"}</p>
      {cloud.lastUploadedAt && <p>Unggahan terverifikasi terakhir: {new Date(cloud.lastUploadedAt).toLocaleString()}</p>}
      <div className="personal-backup__actions"><button disabled={busy || accountBlocked} onClick={() => void command("sync")}>Unggah backup terbaru / coba lagi</button>{gameId && <button disabled={busy || accountBlocked} onClick={() => void command("list")}>Lihat versi OneDrive</button>}</div>
      <button disabled={busy || cloud.uploading || accountBlocked} onClick={() => void command("optimize")}>Optimalkan backup cloud</button>
      <label className="personal-backup__toggle"><input type="checkbox" checked={cloud.autoRetention === true} disabled={busy || accountBlocked} onChange={event => void command("auto-retention", { enabled: event.target.checked })} /> Rapikan riwayat cloud otomatis</label>
      <p className="personal-backup__muted">Setelah unggahan terverifikasi, simpan {cloud.retention ?? 10} versi normal terbaru per game sesuai batas riwayat lokal. Backup pengaman tetap disimpan. Data bersama dibersihkan setelah seluruh versi yang memakainya sudah dihapus. Pemeriksaan memerlukan unduhan.</p>
      {cloud.versions.length > 0 && <ul className="personal-backup__versions">{cloud.versions.map(version => <li key={version.name}><div><strong>{new Date(version.modifiedAt).toLocaleString()}</strong><p>{(version.size / 1024 ** 2).toFixed(2)} MiB file versi · perangkat ini</p></div><button disabled={busy || accountBlocked} onClick={() => void command("download", { name: version.name })}>Unduh ke riwayat</button></li>)}</ul>}
      <p className="personal-backup__muted">Maksimal 128 MiB save per versi. Daftar biasa menampilkan perangkat ini; gunakan pemulihan profil lama untuk backup akun yang sama dari perangkat lain. Versi baru berbagi file yang identik untuk menghemat ruang dan unggahan. Unduhan masuk riwayat lokal untuk dipulihkan. File versi kecil di OneDrive perlu disimpan bersama data penyusunnya.</p>
      <p className="personal-backup__muted">Backup baru dikelompokkan ke folder nama game dan perangkat di OneDrive. Backup lama tetap dibaca dari lokasi semula.</p>
    </>}
    {(cloud.connected || cloud.login) && <button disabled={busy} onClick={() => void command("disconnect")}>{cloud.login ? "Batalkan login" : "Putuskan koneksi"}</button>}
    {busy && <p role="status">Memproses permintaan OneDrive…</p>}
    {(error || cloud.error) && <p role="alert" className="personal-backup__error">{error || cloud.error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
