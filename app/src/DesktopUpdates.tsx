import { useEffect, useState } from 'react';
import { desktop, type UpdateState } from './desktop';

export function DesktopUpdates() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const receive = (next: UpdateState) => {
      if (!alive) return;
      setState(next);
      if (next.status === 'available' || next.status === 'ready') setOpen(true);
    };
    const unsubscribe = desktop.onUpdateState(receive);
    const closePanel = desktop.onUpdatePanel(() => setOpen(true));
    void desktop.getUpdateState().then(receive).catch(() => {});
    return () => { alive = false; unsubscribe(); closePanel(); };
  }, []);
  if (!desktop || !state) return null;
  const busy = ['checking', 'downloading', 'installing'].includes(state.status);
  const text = state.status === 'checking' ? 'Проверяем обновления…' : state.status === 'current' ? 'Установлена последняя версия.' :
    state.status === 'available' ? `Доступна версия ${state.latestVersion}.` : state.status === 'downloading' ? `Скачиваем обновление: ${state.percent ?? 0}%` :
      state.status === 'ready' ? `Версия ${state.latestVersion} готова к установке.` : state.status === 'installing' ? 'Сохраняем проект и запускаем обновление…' :
        state.status === 'error' ? state.message : 'Программа проверяет обновления при запуске.';
  const act = (action: () => Promise<UpdateState>) => { void action().then(setState).catch(() => setState(s => s && ({ ...s, status: 'error', message: 'Не удалось выполнить действие. Повторите попытку.' }))); };
  return <aside className="desktop-updates no-print" aria-label="Обновления программы">
    {!open ? <button className="btn secondary sm" onClick={() => setOpen(true)}>Обновления · {state.currentVersion}{state.status === 'error' ? ' · нет связи' : ''}</button> : <div className="card">
      <div className="actions" style={{ justifyContent: 'space-between', margin: 0 }}><strong>Обновления программы</strong><button className="btn ghost sm" aria-label="Свернуть обновления" onClick={() => setOpen(false)}>×</button></div>
      <p className="small">Установлена версия {state.currentVersion}</p>
      <p className="small" aria-live="polite" data-update-status={state.status}>{text}</p>
      {state.status === 'ready' && state.message && <p className="small" role="alert">{state.message}</p>}
      {state.status === 'downloading' && <progress max={100} value={state.percent ?? 0} aria-label="Скачивание обновления" style={{ width: '100%' }} />}
      <div className="actions">
        {!['ready', 'installing', 'downloading'].includes(state.status) && <button className="btn secondary sm" disabled={busy || !state.enabled} onClick={() => act(() => desktop!.checkUpdates())}>Проверить обновления</button>}
        {state.status === 'available' && <button className="btn sm" onClick={() => act(() => desktop!.downloadUpdate())}>Скачать обновление</button>}
        {state.status === 'ready' && <button className="btn sm" onClick={() => act(() => desktop!.installUpdate())}>Установить и перезапустить</button>}
      </div>
      {state.status === 'ready' && <p className="hint">Перед установкой открытый проект будет сохранён.</p>}
      {!state.enabled && <p className="hint">Проверка доступна в установленной Windows-версии.</p>}
    </div>}
  </aside>;
}
