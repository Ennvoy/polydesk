import React, { useEffect, useState } from 'react';
import { ipc } from '../../ipc/client';
import { dialog } from '../Dialogs/host';
import type { PairLifetime, RemoteStatus, RemoteResult, RemotePairChallenge } from '../../../shared/remoteLaunch';

export function RemoteSettings(): React.JSX.Element {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<RemotePairChallenge | null>(null);
  const [lifetimes, setLifetimes] = useState<Record<string, PairLifetime>>({});
  const refresh = async (): Promise<void> => { setStatus(await ipc.remote.status()); };
  useEffect(() => {
    let active = true;
    const poll = (): void => { void ipc.remote.status().then(s => { if (active) setStatus(s); }).catch(() => { if (active) setMsg('讀取遠端狀態失敗，請重新開啟設定。'); }); };
    poll(); const timer = window.setInterval(poll, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const run = async (operation: () => Promise<RemoteResult>): Promise<void> => {
    setBusy(true); setMsg('');
    try { const r = await operation(); if ('error' in r) setMsg(r.error); await refresh(); }
    catch { setMsg('操作未完成，請重新開啟設定後確認狀態。'); }
    finally { setBusy(false); }
  };
  const consent = async (wsId: string, name: string, allowed: boolean): Promise<void> => {
    if (allowed && !await dialog.confirm({ title: '允許手機啟動 Claude bypass？', body: `工作區：${name}。bypass 會略過 Claude 的權限確認，可能讀寫電腦上其他資源；配對的手機可在無人在電腦旁時啟動。請只授權完全信任的工作區。`, confirmText: '信任並允許遠端啟動', danger: true })) return;
    await run(() => ipc.remote.allowWorkspace({ wsId, allowed }));
  };
  const create = async (): Promise<void> => {
    setBusy(true); setMsg('');
    try { const r = await ipc.remote.challenge(); if ('error' in r) setMsg(r.error); else setChallenge(r); }
    catch { setMsg('無法產生配對碼，請重試。'); } finally { setBusy(false); }
  };
  const activeChallenge = challenge && challenge.expiresAt > Date.now() && status?.enabled ? challenge : null;
  const textStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--meta)', lineHeight: 1.6, margin: '8px 0' };
  return <section aria-label="手機遠端啟動" style={{ margin: '20px 0', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
    <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-sm)', fontWeight: 600 }}>手機遠端啟動</h3>
    <p style={textStyle}>手機一鍵在這台電腦新增 Claude bypass 分頁。電腦與 Poly 必須開啟；每次重開 Poly 都需重新啟用。同事可在自己的 Poly 個別設定。</p>
    <p style={textStyle}>先在電腦與手機安裝 Tailscale，登入同一私人網路並啟用私人 HTTPS。手機使用其他 VPN 時可能需切換；公司使用請確認 Tailscale 適用方案。</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="pd-btn" onClick={() => void ipc.app.openExternalUrl({ url: 'https://tailscale.com/download' })}>Tailscale 安裝</button>
      <button className="pd-btn" onClick={() => void ipc.app.openExternalUrl({ url: 'https://tailscale.com/docs/features/tailscale-serve' })}>私人 HTTPS 設定說明</button>
    </div>
    <p role="status" style={textStyle}>{status?.enabled ? status.error ? '暫停受理 · 正在檢查私人連線' : '已啟用 · 僅 Tailscale 私人 HTTPS' : '已停用 · 無遠端監聽'}{status?.error ? ` · ${status.error}` : ''}</p>
    <p style={textStyle}>每 10 秒檢查私人連線。暫時讀取失敗會先暫停受理，檢查成功後恢復；連續 3 次失敗才停用。Funnel、位址或代理設定改變等安全問題會立即停用。暫停期間的操作不會在恢復後自動重送。</p>
    <button className="pd-btn" disabled={busy || !status} onClick={() => void run(() => status?.enabled ? ipc.remote.disable() : ipc.remote.enable())}>{status?.enabled ? '停用手機遠端啟動' : '啟用手機遠端啟動'}</button>
    {status?.enabled && <>
      <p style={{ ...textStyle, overflowWrap: 'anywhere' }}>手機入口：{status.url}</p>
      <button className="pd-btn" disabled={busy} onClick={() => void create()}>產生手機配對碼</button>
      {activeChallenge && <div style={{ padding: 12, border: '1px solid var(--border)', marginTop: 8 }}>
        <img src={activeChallenge.qr} width={216} height={216} alt="手機配對 QR code" style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
        <p style={textStyle}>用手機掃碼，或開啟上方手機入口輸入下列一次性代碼。兩分鐘有效；仍需在電腦批准。</p>
        <code style={{ display: 'block', overflowWrap: 'anywhere', userSelect: 'all' }}>{activeChallenge.code}</code>
      </div>}
      {challenge && !activeChallenge && <p style={textStyle}>配對碼已過期，請重新產生。</p>}
    </>}
    <h4 style={{ fontSize: 'var(--text-xs)', margin: '16px 0 8px' }}>等待批准的手機</h4>
    {!status?.pending.length && <p style={textStyle}>尚無申請。請先產生配對碼並在手機送出。</p>}
    {status?.pending.map(p => <div key={p.id} style={{ border: '1px solid var(--border)', padding: 12, marginBottom: 8 }}>
      <strong>{p.label}</strong><p style={textStyle}>核對手機識別碼：<b style={{ color: 'var(--fg)', fontFamily: 'monospace', letterSpacing: 2 }}>{p.verification}</b></p>
      <p style={textStyle}>只有手機與這裡顯示相同識別碼才批准。</p>
      <label style={textStyle}>配對期限 <select className="pd-input" aria-label={`配對期限 ${p.label}`} value={lifetimes[p.id] ?? 7} onChange={e => setLifetimes(v => ({ ...v, [p.id]: e.target.value === 'permanent' ? 'permanent' : Number(e.target.value) as 7 | 30 }))}>
        <option value={7}>7 天</option><option value={30}>30 天</option><option value="permanent">永久（直到撤銷）</option>
      </select></label>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button className="pd-btn pd-btn-primary" disabled={busy} onClick={() => void run(() => ipc.remote.approve({ id: p.id, lifetime: lifetimes[p.id] ?? 7 }))}>識別碼相同，批准</button><button className="pd-btn" disabled={busy} onClick={() => void run(() => ipc.remote.reject({ id: p.id }))}>拒絕</button></div>
    </div>)}
    <h4 style={{ fontSize: 'var(--text-xs)', margin: '16px 0 8px' }}>允許遠端啟動的工作區</h4>
    <p style={textStyle}>僅勾選的工作區會出現在手機。新增工作區不會自動授權；路徑變更需重新授權。</p>
    {status?.workspaces.map(w => <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0', fontSize: 'var(--text-sm)' }}><input type="checkbox" disabled={busy} checked={w.allowed} onChange={e => void consent(w.id, w.name, e.target.checked)} />{w.name}</label>)}
    <h4 style={{ fontSize: 'var(--text-xs)', margin: '16px 0 8px' }}>已配對的手機瀏覽器</h4>
    {!status?.devices.length && <p style={textStyle}>尚無有效配對。</p>}
    {status?.devices.map(d => <div key={d.id} style={{ margin: '8px 0', display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ flex: 1, fontSize: 'var(--text-xs)', overflowWrap: 'anywhere' }}>{d.label}<br />{d.expiresAt ? `到期：${new Date(d.expiresAt).toLocaleString()}` : '永久 · 直到手動撤銷'}</span><button className="pd-btn" disabled={busy} aria-label={`撤銷 ${d.label}`} onClick={() => void run(() => ipc.remote.revoke({ id: d.id }))}>撤銷</button></div>)}
    <p style={textStyle}>期限從電腦批准時計算。變更期限請撤銷再配對；更換瀏覽器或清除瀏覽資料需重新配對。永久授權仍可能因瀏覽器清除憑證而需再配對。撤銷會阻止後續遠端操作，已啟動的 Claude 仍在電腦執行。</p>
    <details><summary style={{ fontSize: 'var(--text-xs)' }}>近期操作紀錄</summary>{status?.audit.slice(0, 20).map((a, i) => <p key={`${a.at}-${i}`} style={textStyle}>{new Date(a.at).toLocaleString()} · {a.action} · {a.result}</p>)}</details>
    {msg && <p role="alert" style={{ ...textStyle, color: 'var(--danger)' }}>{msg}</p>}
  </section>;
}
