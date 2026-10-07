import { useEffect, useState } from 'react';
import type { ConceptReference } from '../model/types';
import { uid } from '../model/defaults';
import { useStore } from '../state/store';
import { PlanView, planBounds } from '../plan/PlanView';
import { ScenePanel } from '../scene/ScenePanel';
import { CLIENT_GOALS, STYLE_PRESETS, applyStyle, alternatePalette, randomStyleIndex, rationaleFor } from '../concept/presets';

export function ConceptScreen({ next }: { next: () => void }) {
  const { project, update } = useStore();
  const c = project.concept;
  const v = project.variants.find((x) => x.id === project.selectedVariantId);
  const set = (p: Partial<typeof c>) => update((x) => ({ ...x, concept: { ...x.concept, ...p } }));
  const [newRef, setNewRef] = useState({ caption: '', sourceName: '', kind: 'reference' as ConceptReference['kind'] });

  // Удаляем только три старых встроенных фото-заглушки. Собственные референсы сохраняются.
  useEffect(() => {
    const stock = ['photo-1600210492486-724fe5c67fb0', 'photo-1600607687920-4e2a09cf159d', 'photo-1618221195710-dd6b41faaea6'];
    const isStock = (r: ConceptReference) => /^ref[123]$/.test(r.id) && stock.some(id => r.url.startsWith(`https://images.unsplash.com/${id}?`));
    if (c.references.some(isStock)) update(p => ({ ...p, concept: { ...p.concept, references: p.concept.references.filter(r => !isStock(r)) } }));
  }, [c.references, update]);

  // Вставка изображения из буфера обмена (Ctrl+V) — как референс.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const f = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
      if (!f) return;
      e.preventDefault();
      addImage(f, { caption: newRef.caption || 'Изображение из буфера', sourceName: newRef.sourceName || 'вставлено из буфера' });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const addImage = (f: File | undefined, over?: { caption: string; sourceName: string }) => {
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { alert('Изображение больше 3 МБ — уменьшите его.'); return; }
    const r = new FileReader();
    r.onload = () => set({ references: [...c.references, { id: uid('ref'), url: String(r.result), caption: over?.caption ?? (newRef.caption || f.name), sourceName: over?.sourceName ?? (newRef.sourceName || 'не указан'), sourceUrl: '', kind: newRef.kind }] });
    r.readAsDataURL(f);
  };

  return (
    <div className="view">
      <div className="eyebrow">Шаг 6 · образ интерьера</div>
      <h1 className="heading">Мини-концепция</h1>
      <p className="lead">Объёмная схема квартиры, палитра и материалы. Сохраните ракурсы 3D для клиента или добавьте собственные референсы.</p>
      <ScenePanel />
      <div className="grid2">
        <section className="card">
          <h3>Задачи клиента</h3>
          <div className="actions" style={{ marginTop: 8 }}>{CLIENT_GOALS.map(goal => <label key={goal.id} className="check-inline"><input type="checkbox" checked={(c.clientGoals ?? []).includes(goal.id)} onChange={e => {
            const clientGoals = e.target.checked ? [...(c.clientGoals ?? []), goal.id] : (c.clientGoals ?? []).filter(id => id !== goal.id);
            set({ clientGoals, rationale: rationaleFor(STYLE_PRESETS.find(p => p.styleName === c.styleName)?.rationale ?? STYLE_PRESETS[0].rationale, clientGoals) });
          }} />{goal.name}</label>)}</div>
          <button className="btn secondary sm" onClick={() => {
            const goals = c.clientGoals ?? []; const index = goals.includes('care') || goals.includes('family') ? 2 : goals.includes('space') || goals.includes('light') ? 1 : goals.includes('budget') ? 3 : goals.includes('cozy') ? 4 : 0;
            set(applyStyle(c, index));
          }}>Подобрать под задачи клиента</button>
          <label className="field" style={{ marginTop: 16 }}>Готовый стиль<select aria-label="Готовый стиль" value={STYLE_PRESETS.findIndex(p => p.styleName === c.styleName)} onChange={e => set(applyStyle(c, Number(e.target.value)))}>
            <option value={-1} disabled>Свой стиль</option>{STYLE_PRESETS.map((p, i) => <option key={p.styleName} value={i}>{p.styleName}</option>)}
          </select></label>
          <div className="actions" style={{ marginTop: 10 }}><button className="btn secondary sm" onClick={() => set(applyStyle(c, randomStyleIndex(c.styleName)))}>Случайный стиль</button><button className="btn secondary sm" onClick={() => set({ palette: alternatePalette(c) })}>Другая сочетающаяся палитра</button></div>
          <label className="field" style={{ marginTop: 12 }}>Название стиля<input value={c.styleName} onChange={(e) => set({ styleName: e.target.value })} /></label>
          <h3 style={{ marginTop: 16 }}>Палитра</h3>
          <div className="palette">
            {c.palette.map((s, i) => (
              <div className="swatch" key={i}>
                <input type="color" aria-label={`Цвет ${s.name}`} value={s.hex} onChange={(e) => set({ palette: c.palette.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)) })} style={{ height: 64, padding: 2 }} />
                <input value={s.name} onChange={(e) => set({ palette: c.palette.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              </div>
            ))}
          </div>
          <h3 style={{ marginTop: 16 }}>Материалы (3–5)</h3><datalist id="material-suggestions">{[...new Set(STYLE_PRESETS.flatMap(p => p.materials))].map(m => <option key={m} value={m} />)}</datalist>
          {c.materials.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input list="material-suggestions" aria-label={`Материал ${i + 1}`} value={m} onChange={(e) => set({ materials: c.materials.map((x, j) => (j === i ? e.target.value : x)) })} />
              <button className="btn ghost sm" onClick={() => set({ materials: c.materials.filter((_, j) => j !== i) })} disabled={c.materials.length <= 3} aria-label="Убрать материал">✕</button>
            </div>
          ))}
          {c.materials.length < 5 && <button className="btn secondary sm" onClick={() => set({ materials: [...c.materials, ''] })}>Добавить материал</button>}
          <label className="field" style={{ marginTop: 14 }}>Обоснование<textarea aria-label="Обоснование" value={c.rationale} onChange={(e) => set({ rationale: e.target.value })} /></label>
        </section>
        <section className="card">
          <h3>Выбранный вариант</h3>
          {v ? <><PlanView g={project.geometry} items={v.items} mode="client" wallImage={project.planImage} planStyle={project.planStyle} viewBox={planBounds(project.geometry, 400)} /><p className="muted small">{v.title}: {v.idea.toLowerCase()}.</p></> : <p className="muted">Сначала утвердите вариант.</p>}
        </section>
      </div>
      <section className="card" style={{ marginTop: 18 }}>
        <h2>Изображения ({c.references.length} из 4)</h2>
        <div className="refs">
          {c.references.map((r) => (
            <div className="ref" key={r.id}>
              <img src={r.url} alt={r.caption} loading="lazy" />
              <span className="tag">{r.kind === 'reference' ? 'Референс' : 'Иллюстрация'}</span>
              <div className="cap">
                <input value={r.caption} onChange={(e) => set({ references: c.references.map((x) => (x.id === r.id ? { ...x, caption: e.target.value } : x)) })} />
                <div className="muted" style={{ marginTop: 4 }}>Источник: {r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer">{r.sourceName}</a> : r.sourceName}</div>
                <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => set({ references: c.references.filter((x) => x.id !== r.id) })}>Убрать</button>
              </div>
            </div>
          ))}
        </div>
        {c.references.length < 4 && (
          <div className="fields" style={{ marginTop: 14 }}>
            <label className="field">Подпись<input value={newRef.caption} onChange={(e) => setNewRef({ ...newRef, caption: e.target.value })} /></label>
            <label className="field">Источник<input value={newRef.sourceName} onChange={(e) => setNewRef({ ...newRef, sourceName: e.target.value })} placeholder="Сайт, автор или «собственное фото»" /></label>
            <label className="field">Пометка<select value={newRef.kind} onChange={(e) => setNewRef({ ...newRef, kind: e.target.value as ConceptReference['kind'] })}><option value="reference">Референс (чужой интерьер)</option><option value="illustration">Иллюстрация</option></select></label>
            <label className="btn secondary" style={{ alignSelf: 'end', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Загрузить изображение<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => addImage(e.target.files?.[0])} /></label>
          </div>
        )}
        {!c.references.length && <div className="notice">Сохраните ракурс 3D или добавьте изображение.</div>}
        <p className="muted small">Картинку можно вставить из буфера обмена: Ctrl+V.</p>
      </section>
      <div className="actions"><button className="btn" onClick={next} disabled={!v}>К странице клиента</button></div>
    </div>
  );
}
