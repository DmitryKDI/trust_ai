import type { Brief } from '../model/types';
import { useStore } from '../state/store';

export function BriefScreen({ next }: { next: () => void }) {
  const { project, update } = useStore();
  const b = project.brief;
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => update((p) => ({ ...p, brief: { ...p.brief, [k]: v } }));
  const text = (k: keyof Brief, label: string, area = false, hint?: string) => (
    <label className={`field ${area ? 'wide' : ''}`}>{label}
      {area ? <textarea value={String(b[k])} onChange={(e) => set(k, e.target.value as never)} /> : <input value={String(b[k])} onChange={(e) => set(k, e.target.value as never)} />}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
  const num = (k: 'adults' | 'children' | 'diningSeats', label: string, min = 0, max = 10) => (
    <label className="field">{label}<input type="number" min={min} max={max} value={b[k]} onChange={(e) => set(k, Math.max(min, Math.min(max, Number(e.target.value) || 0)))} /></label>
  );
  return (
    <div className="view">
      <div className="eyebrow">Шаг 3 · потребности</div>
      <h1 className="heading">Короткий бриф</h1>
      <p className="lead">Главное — состав семьи и приоритеты. Бриф влияет на расстановку: доступ к кровати, рабочее место, число мест за столом.</p>
      <section className="card" style={{ maxWidth: 900 }}>
        <div className="fields">
          {text('area', 'Площадь, м²', false, 'Из документов клиента; по разметке площадь посчитается сама')}
          {num('adults', 'Взрослых', 1, 8)}
          {num('children', 'Детей', 0, 6)}
          {text('childrenAges', 'Возраст детей')}
          <label className="check-inline wide"><input type="checkbox" checked={b.workFromHome} onChange={(e) => set('workFromHome', e.target.checked)} />Кто-то работает из дома — нужно рабочее место</label>
          {text('priorities', 'Приоритеты', true, 'Например: больше хранения, светлая гостиная, место для гостей')}
        </div>
        <details>
          <summary>Подробнее</summary>
          <div className="fields">
            {text('rooms', 'Помещения и задачи', true)}
            {text('style', 'Предпочитаемый стиль')}
            {text('budget', 'Бюджет на ремонт', false, 'Для менеджера; в расчёт ставки не входит')}
            {num('diningSeats', 'Мест за обеденным столом', 2, 8)}
            <label className="check-inline"><input type="checkbox" checked={b.bedAccessBothSides} onChange={(e) => set('bedAccessBothSides', e.target.checked)} />Подход к двуспальной кровати с двух сторон</label>
            <label className="check-inline"><input type="checkbox" checked={b.preferShower} onChange={(e) => set('preferShower', e.target.checked)} />Душ вместо ванны</label>
            {text('limits', 'Ограничения', true)}
            {text('mustHave', 'Обязательные предметы', true)}
            {text('bans', 'Запреты', true)}
          </div>
        </details>
        <div className="actions"><button className="btn" onClick={next}>К разметке плана</button></div>
      </section>
    </div>
  );
}
