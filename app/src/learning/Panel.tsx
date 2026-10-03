import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { checkedPlan } from './model';
import { clearLearning, forgetLearnedPlan, getFile, importLearning, learningBackup, listLearnedPlans, planKey, saveLearnedPlan } from '../storage/db';

export function LearningPanel() {
  const { project } = useStore();
  const [counts, setCounts] = useState({ plans: 0, types: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    const plans = await listLearnedPlans();
    setCounts({ plans: plans.length, types: plans.reduce((n, p) => n + p.geometry.rooms.filter(r => r.typeSource === 'manual' && r.type !== 'other').length, 0) });
  };
  useEffect(() => { refresh().catch(e => setError(String(e.message ?? e))); }, []);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await fn(); await refresh(); } catch (e) { setError(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  const sourceKey = async () => {
    const g = project.geometry;
    if (!g.sourceDocumentId || !g.sourcePage) throw new Error('Сначала загрузите план и выберите страницу.');
    const file = await getFile(g.sourceDocumentId);
    if (!file) throw new Error('Исходный файл не найден.');
    return planKey(file, g.sourcePage);
  };
  return <details className="card" style={{ marginTop: 14 }}>
    <summary>Обучение на моих правках · страниц: {counts.plans}</summary>
    <p className="muted small">Сначала проверьте все границы и проёмы. Кнопка сохраняет эту страницу для повторной загрузки того же файла. Для других планов используются только назначения, выбранные вами вручную; контуры не переносятся.</p>
    <p className="small">Сохранено страниц: {counts.plans} · назначений: {counts.types}. Новое предположение требует согласующихся примеров из трёх разных файлов.</p>
    <div className="actions">
      <button className="btn secondary" disabled={busy || !project.geometry.rooms.length} onClick={() => action(async () => {
        const key = await sourceKey();
        await saveLearnedPlan(checkedPlan(key, project.geometry));
        setMessage('Проверенный план сохранён. При повторной загрузке этого файла и страницы будут использованы ваши границы и назначения.');
      })}>Сохранить проверенный план для обучения</button>
      <button className="btn ghost sm" disabled={busy} onClick={() => action(async () => { await forgetLearnedPlan(await sourceKey()); setMessage('Эта страница исключена из обучения. Проект сохранён.'); })}>Забыть эту страницу</button>
    </div>
    <div className="actions">
      <button className="btn ghost sm" disabled={busy || !counts.plans} onClick={() => action(async () => {
        const url = URL.createObjectURL(await learningBackup()); const a = document.createElement('a');
        a.href = url; a.download = 'trust-learning.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      })}>Экспорт обучения</button>
      <label className="btn ghost sm">Импорт обучения<input type="file" accept=".json,application/json" hidden disabled={busy} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) action(async () => { if (file.size > 5_000_000) throw new Error('Файл обучения больше 5 МБ.'); await importLearning(await file.text()); setMessage('Примеры обучения импортированы.'); });
      }} /></label>
      <button className="btn ghost sm" disabled={busy || !counts.plans} onClick={() => {
        if (confirm('Очистить все примеры обучения? Сохранённые проекты останутся.')) action(async () => { await clearLearning(); setMessage('Примеры обучения очищены.'); });
      }}>Очистить обучение</button>
    </div>
    {message && <p className="notice" role="status">{message}</p>}
    {error && <p className="notice err" role="alert">{error}</p>}
    <p className="muted small">Данные остаются в этом браузере. До 200 страниц и 5 МБ; при заполнении забываются старейшие примеры. Перед сменой устройства экспортируйте обучение или резервную копию проекта.</p>
  </details>;
}
