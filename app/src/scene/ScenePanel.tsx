import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { SizeInput } from '../editor/SizeInput';
import { CATALOG } from '../furniture/catalog';
import { uid } from '../model/defaults';
import type { FurnitureType } from '../model/types';
import { SceneView } from './SceneView';
import { EMPTY_CATALOG, parseMaterialCatalog } from './catalog';
import { DEFAULT_HEIGHTS, MATERIAL_SLOTS, SLOT_NAMES, sceneSettings, type SceneSettings } from './types';

export function ScenePanel() {
  const { project, update } = useStore();
  const [variantId, setVariantId] = useState(project.selectedVariantId ?? project.variants[0]?.id ?? ''), [error, setError] = useState(''), [snapshotNote, setSnapshotNote] = useState('');
  const variant = project.variants.find(v => v.id === variantId) ?? project.variants.find(v => v.id === project.selectedVariantId) ?? project.variants[0];
  const settings = useMemo(() => sceneSettings(project.concept.scene3d), [project.concept.scene3d]);
  const catalog = project.concept.materialCatalog ?? EMPTY_CATALOG;
  const types = [...new Set(variant?.items.map(i => i.type) ?? [])];
  const patch = (change: Partial<SceneSettings>) => update(p => ({ ...p, concept: { ...p.concept, scene3d: { ...sceneSettings(p.concept.scene3d), ...change } } }));
  const setHeight = (type: FurnitureType, height: number) => update(p => {
    const old = sceneSettings(p.concept.scene3d);
    return { ...p, concept: { ...p.concept, scene3d: { ...old, heights: { ...old.heights, [type]: height } } } };
  });
  const importCatalog = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('Каталог больше 12 МБ.');
      const incoming = parseMaterialCatalog(await file.text());
      update(p => {
        const old = sceneSettings(p.concept.scene3d), assignments: SceneSettings['assignments'] = {};
        for (const slot of MATERIAL_SLOTS) if (incoming.materials.some(m => m.id === old.assignments[slot] && m.category === slot)) assignments[slot] = old.assignments[slot];
        return { ...p, concept: { ...p.concept, materialCatalog: incoming, scene3d: { ...old, assignments } } };
      });
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось импортировать каталог.'); }
  };
  const texture = async (id: string, file?: File) => {
    if (!file) return; setError('');
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Нужна текстура PNG/JPEG/WebP до 3 МБ.');
      const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Не удалось прочитать текстуру.')); reader.readAsDataURL(file); });
      update(p => ({ ...p, concept: { ...p.concept, materialCatalog: { version: 1, materials: (p.concept.materialCatalog?.materials ?? []).map(m => m.id === id ? { ...m, textureDataUrl: url } : m) } } }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось добавить текстуру.'); }
  };
  const template = () => {
    const blob = new Blob([JSON.stringify({ version: 1, materials: [{ id: 'oak-natural', name: 'Дуб натуральный — пример', category: 'floor', color: '#c9ad8e', tileWidthMm: 1200, tileHeightMm: 200, article: '', price: 0, unit: 'м²' }] }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'trust-material-catalog.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="card" style={{ marginBottom: 18 }}>
    <h2>3D из планировки</h2>
    <p className="muted">Стены и мебель собираются по размерам плана. Каталог пока может быть пустым: используются базовые цвета и условные формы предметов.</p>
    <div className="scene-fields">
      <label className="field">Вариант для просмотра<select aria-label="Вариант 3D" value={variant?.id ?? ''} onChange={e => { setVariantId(e.target.value); setSnapshotNote(''); }}>
        {!project.variants.length && <option value="">План без мебели</option>}
        {project.variants.map(v => <option key={v.id} value={v.id}>{v.title}{v.id === project.selectedVariantId ? ' · выбран для клиента' : ''}</option>)}
      </select></label>
      <SizeInput label="Высота потолка, мм" value={settings.ceilingHeight} min={2200} max={6000} onCommit={ceilingHeight => patch({ ceilingHeight })} />
      <SizeInput label="Высота дверей, мм" value={settings.doorHeight} min={1800} max={settings.ceilingHeight} onCommit={doorHeight => patch({ doorHeight })} />
      <SizeInput label="Высота окон, мм" value={settings.windowHeight} min={300} max={4000} onCommit={windowHeight => patch({ windowHeight })} />
      <SizeInput label="Подоконник по умолчанию, мм" value={settings.windowSill} min={0} max={2500} onCommit={windowSill => patch({ windowSill })} />
    </div>
    <div className="actions" style={{ marginBottom: 12 }}>
      <label className="check-inline"><input type="checkbox" checked={settings.fullWalls} onChange={e => patch({ fullWalls: e.target.checked })} />Полная высота стен</label>
      <label className="check-inline"><input type="checkbox" checked={settings.showCeiling} onChange={e => patch({ showCeiling: e.target.checked })} />Показать потолок</label>
    </div>
    {project.geometry.rooms.length || project.geometry.walls.length ? <SceneView geometry={project.geometry} items={variant?.items ?? []} settings={settings} catalog={catalog} title={variant?.title ?? 'План без мебели'} onSnapshot={url => {
      setSnapshotNote('');
      if (project.concept.references.length >= 4) { setSnapshotNote('Уже сохранено четыре изображения. Уберите одно в разделе изображений ниже.'); return; }
      update(p => ({ ...p, concept: { ...p.concept, references: [...p.concept.references.slice(0, 3), { id: uid('view'), url, caption: `3D · ${variant?.title ?? 'План без мебели'}`, sourceName: 'Траст ремонт · объёмная схема по планировке', sourceUrl: '', kind: 'illustration' }] } }));
      setSnapshotNote('Ракурс добавлен в изображения концепции и на страницу клиента.');
    }} /> : <div className="notice">Сначала добавьте стены или контуры помещений на шаге разметки.</div>}
    {snapshotNote && <p role="status" className="muted small">{snapshotNote}</p>}
    <p className="muted small">Обзорный разрез показывает стены высотой 700 мм. Полная высота и потолок могут закрывать интерьер. Высоты предметов типовые; масштаб плана и размеры нужно проверить по обмерам.</p>
    <details style={{ marginTop: 16 }}><summary>Высоты мебели</summary>
      <p className="muted small">Настройка применяется ко всем предметам этого типа во всех вариантах. Ширина, глубина и поворот берутся из редактора; высота ограничена потолком.</p>
      <div className="scene-fields">{types.map(type => <SizeInput key={type} label={`${CATALOG[type]?.name ?? type}: высота, мм`} value={settings.heights[type] ?? DEFAULT_HEIGHTS[type]} min={10} max={5000} onCommit={height => setHeight(type, height)} />)}</div>
    </details>
    <details style={{ marginTop: 16 }}><summary>Каталог материалов ({catalog.materials.length})</summary>
      <p className="muted small">Импортируйте JSON по шаблону. Можно указать цвет, артикул, цену и размер повторения текстуры; фотография товара служит справкой, для поверхности нужна текстура. Импорт заменяет каталог текущего проекта.</p>
      <div className="actions">
        <button className="btn secondary sm" onClick={template}>Скачать шаблон каталога</button>
        <label className="btn secondary sm">Импортировать каталог<input type="file" aria-label="Импорт каталога материалов" accept="application/json,.json" hidden onChange={e => { void importCatalog(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      {error && <div className="notice err" role="alert">{error}</div>}
      {!catalog.materials.length && <p className="muted">Каталог пуст. 3D работает с базовыми материалами.</p>}
      <div className="scene-fields">{MATERIAL_SLOTS.map(slot => <label className="field" key={slot}>{SLOT_NAMES[slot]}<select aria-label={`Материал: ${SLOT_NAMES[slot]}`} value={settings.assignments[slot] ?? ''} onChange={e => {
        const id = e.target.value; update(p => { const old = sceneSettings(p.concept.scene3d); return { ...p, concept: { ...p.concept, scene3d: { ...old, assignments: { ...old.assignments, [slot]: id } } } }; });
      }}><option value="">Базовый материал</option>{catalog.materials.filter(m => m.category === slot).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>)}</div>
      <div className="scene-materials">{catalog.materials.map(m => <div className="scene-catalog-card" key={m.id}>
        <div className="scene-catalog-chip" style={{ backgroundColor: m.color, backgroundImage: m.textureDataUrl ? `url(${m.textureDataUrl})` : undefined, backgroundSize: 'cover' }} />
        <b>{m.name}</b><p className="muted small">{SLOT_NAMES[m.category]}{m.article ? ` · ${m.article}` : ''}{m.price !== undefined ? ` · ${m.price.toLocaleString('ru-RU')} ₽/${m.unit || 'ед.'}` : ''}</p>
        <label className="btn ghost sm">Добавить текстуру<input type="file" aria-label={`Текстура: ${m.name}`} accept="image/png,image/jpeg,image/webp" hidden onChange={e => { void texture(m.id, e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>)}</div>
      <p className="muted small">Каталог сохраняется с проектом. Цены справочные и пока не включаются в смету автоматически.</p>
    </details>
  </section>;
}
