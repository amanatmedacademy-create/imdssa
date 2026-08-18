import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, CloudOff, FileArchive, HardDriveDownload, History, RefreshCw, RotateCcw, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import './releaseManagerPage.css';

type AuthResponse = { user: { scope: 'platform' | 'tenant'; role: string; fullName: string; email: string } };
type CurrentRelease = { label: string; path: string; release: string | null; deployedAt: string | null };
type Release = {
  id: string;
  source: 'github' | 'upload' | 'recovery' | 'unknown';
  createdAt: string;
  sizeBytes: number;
  sha256?: string | null;
  uploadedBy?: string | null;
  originalName?: string | null;
  active: boolean;
  deployable: boolean;
};
type Job = {
  id: string;
  releaseId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  currentRelease?: string | null;
  log?: string[];
};
type ReleaseState = {
  githubIndependent: boolean;
  uploadLimitBytes: number;
  current: { controlCenter: CurrentRelease; marketing: CurrentRelease };
  releases: Release[];
  latestJob: Job | null;
};

async function jsonApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function bytes(value: number | undefined) {
  const amount = Number(value || 0);
  if (!amount) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  return `${(amount / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
function date(value: string | null | undefined) { return value ? new Date(value).toLocaleString('ru-RU') : '—'; }
function sourceLabel(source: Release['source']) {
  if (source === 'recovery') return 'Резервная копия';
  if (source === 'upload') return 'Загружен вручную';
  if (source === 'github') return 'GitHub deploy';
  return 'Локальный релиз';
}
function jobLabel(status: Job['status']) {
  if (status === 'queued') return 'В очереди';
  if (status === 'running') return 'Развёртывание…';
  if (status === 'succeeded') return 'Успешно';
  return 'Ошибка';
}
function suggestedReleaseId(file: File) {
  const base = file.name.replace(/\.tar\.gz$/i, '').replace(/\.tgz$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  const candidate = (base || `release-${stamp}`).slice(0, 68);
  return candidate.length >= 3 ? candidate : `release-${stamp}`;
}

export function ReleaseManagerPage() {
  const [auth, setAuth] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [user, setUser] = useState<AuthResponse['user'] | null>(null);
  const [state, setState] = useState<ReleaseState | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [releaseId, setReleaseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const canManage = Boolean(user?.scope === 'platform' && ['platform_owner', 'platform_admin'].includes(user.role));

  const load = useCallback(async () => {
    const data = await jsonApi<ReleaseState>('/release-api/releases');
    setState(data);
    setError('');
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void jsonApi<AuthResponse>('/api/auth/me').then(async (result) => {
      if (cancelled) return;
      setUser(result.user);
      if (result.user.scope !== 'platform') { setAuth('denied'); return; }
      setAuth('allowed');
      try { await load(); } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Менеджер релизов недоступен'); }
    }).catch(() => { if (!cancelled) setAuth('denied'); });
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (auth !== 'allowed') return;
    const timer = window.setInterval(() => {
      if (state?.latestJob && ['queued', 'running'].includes(state.latestJob.status)) void load().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [auth, load, state?.latestJob]);

  const orderedReleases = useMemo(() => state?.releases || [], [state?.releases]);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
    if (selected) setReleaseId(suggestedReleaseId(selected));
  };

  const snapshot = async () => {
    if (!canManage || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await jsonApi<{ snapshotId: string }>('/release-api/releases/snapshot', { method: 'POST', body: '{}' });
      setMessage(`Резервная копия ${result.snapshotId} создана.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать резервную копию'); }
    finally { setBusy(false); }
  };

  const upload = async () => {
    if (!canManage || !file || busy) return;
    const id = releaseId.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(id)) { setError('Имя релиза: 3–80 символов, латиница, цифры, точка, дефис или подчёркивание.'); return; }
    if (state && file.size > state.uploadLimitBytes) { setError(`Файл больше допустимого размера ${bytes(state.uploadLimitBytes)}.`); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/release-api/releases/upload?releaseId=${encodeURIComponent(id)}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/gzip', 'x-release-filename': file.name },
        body: file,
      });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      setMessage(`Релиз ${id} загружен и проверен. Он ещё не активирован.`);
      setFile(null); setReleaseId('');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить релиз'); }
    finally { setBusy(false); }
  };

  const deploy = async (release: Release) => {
    if (!canManage || busy || release.active || !release.deployable) return;
    const verb = release.source === 'recovery' ? 'Откатить систему' : 'Развернуть релиз';
    if (!window.confirm(`${verb} «${release.id}»? Перед переключением сервер автоматически создаст резервную копию текущей версии.`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await jsonApi<{ job: Job }>(`/release-api/releases/${encodeURIComponent(release.id)}/deploy`, { method: 'POST', body: '{}' });
      setMessage(`Задача ${result.job.id} запущена. Страница будет обновлять статус автоматически.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось запустить развёртывание'); }
    finally { setBusy(false); }
  };

  const remove = async (release: Release) => {
    if (!canManage || busy || release.active) return;
    if (!window.confirm(`Удалить локальный релиз «${release.id}»? Это не изменит текущую работающую версию.`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await jsonApi(`/release-api/releases/${encodeURIComponent(release.id)}`, { method: 'DELETE' });
      setMessage(`Релиз ${release.id} удалён.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить релиз'); }
    finally { setBusy(false); }
  };

  if (auth === 'checking') return <main className="release-state">Проверка доступа…</main>;
  if (auth === 'denied') return <main className="release-state"><strong>Управление релизами доступно только платформенному администратору.</strong><a href="/">Вернуться в Control Center</a></main>;

  const job = state?.latestJob || null;
  return <div className="release-shell">
    <aside className="release-sidebar">
      <a href="/infrastructure"><ArrowLeft size={15}/>Инфраструктура</a>
      <div className="release-brand"><b>IMDS</b><span>Local Release Manager</span></div>
      <div className="release-mode"><CloudOff size={18}/><div><strong>Автономный режим</strong><span>GitHub не требуется для отката и локального deploy</span></div></div>
      <div className="release-user"><ShieldCheck size={16}/><div><strong>{user?.fullName || user?.email}</strong><span>{user?.email}</span></div></div>
    </aside>

    <main className="release-main">
      <header className="release-header"><div><span>SERVER RELEASES</span><h1>Релизы и восстановление</h1><p>Локальные резервные копии и развёртывание на VPS без зависимости от GitHub.</p></div><button type="button" disabled={busy} onClick={() => void load()}><RefreshCw size={15}/>Обновить</button></header>
      {error && <div className="release-error">{error}</div>}
      {message && <div className="release-success"><CheckCircle2 size={16}/>{message}</div>}

      <section className="release-current-grid">
        <article><span>CONTROL CENTER</span><strong>{state?.current.controlCenter.release || 'Не определён'}</strong><small>{date(state?.current.controlCenter.deployedAt)}</small></article>
        <article><span>MARKETING</span><strong>{state?.current.marketing.release || 'Не определён'}</strong><small>{date(state?.current.marketing.deployedAt)}</small></article>
        <article className="safe"><span>ЛОКАЛЬНОЕ ВОССТАНОВЛЕНИЕ</span><strong>{state?.githubIndependent ? 'Готово' : 'Недоступно'}</strong><small>{orderedReleases.filter((item) => item.source === 'recovery').length} резервных копий</small></article>
      </section>

      <section className="release-actions-grid">
        <article className="release-card">
          <div className="release-card-head"><HardDriveDownload size={20}/><div><span>РЕЗЕРВНАЯ КОПИЯ</span><h2>Сохранить текущую версию</h2><p>Сохраняет frontend, API, зависимости, миграции и серверную конфигурацию для автономного отката.</p></div></div>
          <button className="primary" type="button" disabled={!canManage || busy} onClick={() => void snapshot()}><HardDriveDownload size={15}/>{busy ? 'Операция…' : 'Создать резервную копию'}</button>
        </article>

        <article className="release-card">
          <div className="release-card-head"><UploadCloud size={20}/><div><span>ЛОКАЛЬНЫЙ DEPLOY</span><h2>Загрузить готовый релиз</h2><p>Архив проверяется до сохранения. Развёртывание запускается отдельно после загрузки.</p></div></div>
          <label className="release-file"><FileArchive size={17}/><span>{file ? file.name : 'Выберите .tar.gz архив'}</span><input type="file" accept=".gz,.tgz,application/gzip" onChange={onFile} disabled={!canManage || busy}/></label>
          <input className="release-id-input" value={releaseId} onChange={(event) => setReleaseId(event.target.value)} placeholder="release-2026-08-19" disabled={!canManage || busy}/>
          <div className="release-upload-foot"><small>{file ? `${bytes(file.size)} · максимум ${bytes(state?.uploadLimitBytes)}` : `Максимальный размер ${bytes(state?.uploadLimitBytes)}`}</small><button type="button" className="primary" disabled={!canManage || busy || !file || !releaseId.trim()} onClick={() => void upload()}><UploadCloud size={15}/>{busy ? 'Загрузка…' : 'Загрузить и проверить'}</button></div>
        </article>
      </section>

      {job && <section className={`release-job ${job.status}`}>
        <div className="release-job-head"><div><History size={18}/><span><strong>{jobLabel(job.status)}</strong><small>{job.id} · {job.releaseId}</small></span></div><span>{date(job.finishedAt || job.startedAt || job.createdAt)}</span></div>
        {job.log?.length ? <pre>{job.log.join('\n')}</pre> : <p>Ожидание журнала операции…</p>}
      </section>}

      <section className="release-card release-list-card">
        <div className="release-list-head"><div><span>ЛОКАЛЬНОЕ ХРАНИЛИЩЕ</span><h2>Доступные версии</h2><p>Резервные копии остаются на VPS и доступны даже при недоступном GitHub.</p></div><strong>{orderedReleases.length}</strong></div>
        {!orderedReleases.length ? <div className="release-empty">Локальных релизов пока нет. Создайте первую резервную копию.</div> : <div className="release-list">{orderedReleases.map((release) => <article key={release.id} className={release.active ? 'active' : ''}>
          <div className="release-list-icon">{release.source === 'recovery' ? <RotateCcw size={18}/> : <FileArchive size={18}/>}</div>
          <div className="release-list-copy"><div><strong>{release.id}</strong>{release.active && <span className="active-badge">Активен</span>}{!release.deployable && <span className="bad-badge">Неполный</span>}</div><span>{sourceLabel(release.source)} · {bytes(release.sizeBytes)}</span><small>{date(release.createdAt)}{release.uploadedBy ? ` · ${release.uploadedBy}` : ''}</small></div>
          <div className="release-list-actions">{!release.active && <button type="button" disabled={!canManage || busy || !release.deployable} onClick={() => void deploy(release)}>{release.source === 'recovery' ? <RotateCcw size={14}/> : <UploadCloud size={14}/>} {release.source === 'recovery' ? 'Откатить' : 'Развернуть'}</button>}<button className="danger" type="button" title="Удалить" disabled={!canManage || busy || release.active} onClick={() => void remove(release)}><Trash2 size={14}/></button></div>
        </article>)}</div>}
      </section>
    </main>
  </div>;
}
