import { useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { scaleGeometry } from '../editor/ops';
import { changeFurnitureType, resizeFurniture } from '../editor/furniture';
import { FurnitureHandles } from '../editor/FurnitureHandles';
import { furnitureSnapContext, resizeFurnitureAtHandle, snapFurnitureMove, snapFurnitureResize, type ResizeHandle, type SnapGuide, type FurnitureSnapContext } from '../editor/furniture-interaction';
import { ownsShortcut } from '../editor/keyboard';
import { SizeInput } from '../editor/SizeInput';
import type { FurnitureItem, FurnitureType, PlanStyle, Project, RoomType, Rot, Variant } from '../model/types';
import { uid } from '../model/defaults';
import { useStore } from '../state/store';
import { useSourcePage } from '../state/useSource';
import { PlanView, planBounds, STYLE_NAMES } from '../plan/PlanView';
import { CATALOG, DINING_PRESETS, kitchenModules } from '../furniture/catalog';
import { geometryHash, roomArea } from '../geometry/plan';
import { centroid, localToWorld, pointInPolygon } from '../geometry/poly';
import { validate } from '../validate/validator';
import { explain, isReady, layoutSignature, type Rejected } from '../layout/variants';
import { runVariantsInWorker } from '../layout/runVariants';
import { QuickFix } from './QuickFix';
import { LearningPanel } from '../learning/Panel';
import { ROOM_TYPES, roomName } from '../learning/model';

const ADDABLE: FurnitureType[] = ['bed-double', 'bed-single', 'bedside', 'wardrobe', 'dresser', 'sofa', 'armchair', 'coffee-table', 'tv-unit', 'dining', 'desk', 'kitchen-run', 'fridge', 'bathtub', 'shower', 'toilet', 'washbasin', 'washer', 'shoe-cabinet', 'shelving', 'play-rug'];

export function VariantsScreen({ next, back }: { next: () => void; back: () => void }) {
  const { project, update, rules } = useStore();
  const currentProject = useRef(project); currentProject.current = project;
  const buildStamp = (p: Project) => JSON.stringify([geometryHash(p.geometry), p.geometry.approved, p.brief, p.ruleOverrides, p.variants]);
  const g = project.geometry;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [openId, setOpenId] = useState<string | null>(project.selectedVariantId ?? project.variants[0]?.id ?? null);
  const hash = useMemo(() => geometryHash(g), [g]);
  const stale = project.variants.some((v) => v.geometryHash !== hash);

  const [rebuild, setRebuild] = useState(0);
  useEffect(() => { if (rebuild) build(); }, [rebuild]); // eslint-disable-line react-hooks/exhaustive-deps

  const build = async (target?: Variant) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const stamp = buildStamp(project);
    try {
      const res = await runVariantsInWorker(g, project.brief, project.ruleOverrides, target ? [target.scenario] : undefined, { seed: crypto.getRandomValues(new Uint32Array(1))[0] || 1, previous: project.variants.flatMap(v => v.items) });
      if (buildStamp(currentProject.current) !== stamp) { setErr('План, бриф или варианты изменились во время сборки. Запустите пересборку ещё раз.'); return; }
      if (target) {
        const replacement = res.variants[0];
        if (!replacement || layoutSignature(replacement.items) === layoutSignature(target.items) || project.variants.some(v => v.id !== target.id && layoutSignature(v.items) === layoutSignature(replacement.items))) {
          setErr('Другую расстановку для этого варианта найти не удалось. Измените задачи клиента или размеры мебели и повторите.'); return;
        }
        update(p => ({ ...p, variants: p.variants.map(v => v.id === target.id ? replacement : v), selectedVariantId: p.selectedVariantId === target.id ? null : p.selectedVariantId, review: p.review?.variantId === target.id ? null : p.review }));
        setOpenId(replacement.id);
      } else {
        if (project.variants.length && res.variants.every(v => project.variants.some(old => layoutSignature(old.items) === layoutSignature(v.items)))) {
          setErr('Новые допустимые расстановки не найдены. Текущие варианты сохранены.'); return;
        }
        update(p => ({ ...p, variants: res.variants, selectedVariantId: null, review: null }));
        setOpenId(res.variants.find(isReady)?.id ?? res.variants[0]?.id ?? null);
      }
      setRejected(res.rejected);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (!g.approved)
    return (
      <div className="view">
        <div className="eyebrow">Шаг 5 · варианты</div>
        <h1 className="heading">Варианты расстановки</h1>
        <div className="notice err">Варианты строятся только на утверждённой геометрии. Проверьте и утвердите разметку.</div>
        <div className="actions"><button className="btn" onClick={back}>К разметке</button></div>
      </div>
    );

  const open = project.variants.find((v) => v.id === openId) ?? null;
  const ready = project.variants.filter(isReady);

  return (
    <div className="view">
      <div className="eyebrow">Шаг 5 · варианты</div>
      <h1 className="heading">Варианты расстановки</h1>
      <p className="lead">Варианты под бриф клиента на одном плане. Каждый проверен на проходы, двери, окна и доступ к мебели. Мебель можно двигать мышью — проверка пересчитывается сразу.</p>
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn" onClick={() => build()} disabled={busy}>{busy ? <><span className="spinner" />Подбираю варианты…</> : project.variants.length ? 'Пересобрать все варианты' : 'Построить варианты'}</button>
        <label className="check-inline">Стиль плана
          <select value={project.planStyle ?? 'graphite'} onChange={(e) => update((p) => ({ ...p, planStyle: e.target.value as PlanStyle }))} style={{ width: 'auto' }}>
            {(Object.keys(STYLE_NAMES) as PlanStyle[]).filter((k) => k !== 'original' || project.planImage).map((k) => <option key={k} value={k}>{STYLE_NAMES[k]}</option>)}
          </select>
        </label>
        {stale && <span className="badge warn">Геометрия изменилась — варианты устарели</span>}
        {project.variants.length > 0 && <span className="muted small">Готовых к показу: {ready.length} из {project.variants.length}</span>}
      </div>
      {err && <div className="notice err">Ошибка сборки: {err}</div>}
      {project.recognition && (
        <div className="notice">
          План прочитан автоматически: {project.recognition.rooms.length} помещ., {project.recognition.openings.windows} окон, {project.recognition.openings.doors} дверей; масштаб — {({ dimensions: 'по размерам на чертеже', area: 'по площади квартиры', typical: 'прикинут по типичным размерам — введите площадь квартиры или подправьте ползунком', assumed: 'прикинут приблизительно — подправьте ползунком' } as const)[project.recognition.scale.method]}.
          {' '}Если комната или дверь определена неверно — исправьте в «Быстрой правке» ниже; сложные случаи — на шаге <button className="btn ghost sm" onClick={back}>разметки</button>.
          {project.recognition.notes?.map((t, i) => <div key={i} className="small" style={{ marginTop: 6 }}>{t}</div>)}
        </div>
      )}
      {g.rooms.length > 0 && <QuickFix busy={busy} onRebuild={() => setRebuild((n) => n + 1)} />}
      {project.planImage && <ScalePanel busy={busy} onApplied={() => setRebuild((n) => n + 1)} />}
      <RoomsPanel onChanged={() => build()} busy={busy} onRescaled={() => setRebuild((n) => n + 1)} />
      <LearningPanel />
      {rejected.length > 0 && (
        <div className="notice">
          <strong>Показано меньше трёх готовых вариантов:</strong>
          <ul className="list">{rejected.map((r) => <li key={r.scenario}>«{r.title}» — {r.reason}</li>)}</ul>
        </div>
      )}

      {project.variants.length > 0 && (
        <div className="variants" style={{ marginTop: 18 }}>
          {project.variants.map((v, i) => (
            <article key={v.id} className={`card vcard ${openId === v.id ? 'sel' : ''}`} onClick={() => setOpenId(v.id)}>
              <div className="thumbwrap"><PlanView g={g} items={v.items} mode="thumb" wallImage={project.planImage} planStyle={project.planStyle} ariaLabel={`Схема варианта «${v.title}»`} /></div>
              <div className="body">
                <span className="eyebrow">Вариант {i + 1}{v.approved ? ' · утверждён' : ''}</span>
                <h2>{v.title}</h2>
                <p className="small" style={{ margin: 0 }}><b>{v.idea}.</b></p>
                <StatusBadge v={v} /><div className="actions" style={{ marginTop: 10 }}><button className="btn secondary sm" disabled={busy} onClick={e => { e.stopPropagation(); void build(v); }} aria-label={`Пересобрать вариант ${i + 1}`}>Пересобрать этот вариант</button></div>
                <ul className="list">{v.benefits.slice(0, 3).map((b) => <li key={b}>{b}</li>)}</ul>
              </div>
            </article>
          ))}
        </div>
      )}

      {open && <VariantDetail key={open.id} v={open} />}
      {open && <ReferenceCompare v={open} />}

      <div className="actions">
        <button className="btn" disabled={!project.variants.some((v) => v.approved)} onClick={next}>К мини-концепции</button>
        <button className="btn secondary" onClick={back}>К разметке</button>
        {!project.variants.some((v) => v.approved) && project.variants.length > 0 && <span className="muted small">Утвердите вариант перед показом клиенту</span>}
      </div>
      <p className="fineprint">Проверки используют рабочие допущения («Правила»: проход {rules.passageMin} мм, подход {rules.accessMin} мм и т. д.). Это предпродажная схема, не проектная документация.</p>
    </div>
  );
}

function StatusBadge({ v }: { v: Variant }) {
  const e = v.issues.filter((i) => i.severity === 'error').length;
  const w = v.issues.filter((i) => i.severity === 'warning').length;
  if (e) return <span className="badge err">Требует доработки: {e} {e === 1 ? 'проблема' : 'проблем'}</span>;
  return <span className={`badge ${w ? 'warn' : 'ok'}`}>Проверки пройдены{w ? ` · замечаний: ${w}` : ''}</span>;
}

function VariantDetail({ v }: { v: Variant }) {
  const { project, update, rules } = useStore();
  const g = project.geometry;
  const [items, setItems] = useState<FurnitureItem[]>(v.items);
  const rootRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const selId = selection.length === 1 ? selection[0] : null;
  const setSelId = (id: string | null) => setSelection(id ? [id] : []);
  const itemsRef = useRef(items);
  const [history, setHistory] = useState<{ past: FurnitureItem[][]; future: FurnitureItem[][] }>({ past: [], future: [] });
  const [snapping, setSnapping] = useState(true);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [dragging, setDragging] = useState(false);
  const [hl, setHl] = useState<string[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: 'move' | 'resize'; id: string; ids: string[]; start: { x: number; y: number }; item: FurnitureItem; before: FurnitureItem[]; context: FurnitureSnapContext; inverse: DOMMatrix; handle?: ResizeHandle; moved: boolean } | null>(null);
  const deferred = useDeferredValue(items);
  const result = useMemo(() => validate(g, deferred, rules, project.brief, { expectedHash: v.geometryHash }), [g, deferred, rules, project.brief, v.geometryHash]);
  const errors = result.issues.filter((i) => i.severity === 'error');

  // Сохраняем правки и актуальные проверки в проект.
  useEffect(() => {
    if (dragging || deferred === v.items) return; // ничего не менялось
      const ex = explain(g, v.scenario, deferred, rules, project.brief, result.issues, []);
      update((p) => ({
        ...p,
        variants: p.variants.map((x) => (x.id === v.id ? { ...x, items: deferred, issues: result.issues, benefits: ex.benefits, compromises: x.compromises.filter((c) => c.startsWith('Не поместилось')).concat(ex.compromises.filter((c) => !c.startsWith('Не поместилось'))), metrics: ex.metrics, editedByManager: true, approved: false } : x)),
        selectedVariantId: p.selectedVariantId === v.id ? null : p.selectedVariantId,
        review: p.selectedVariantId === v.id ? null : p.review,
      }));
  }, [deferred, dragging]); // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = (e: { clientX: number; clientY: number }, inverse?: DOMMatrix) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(inverse ?? svg.getScreenCTM()!.inverse());
  };
  const live = (next: FurnitureItem[]) => { itemsRef.current = next; setItems(next); };
  const record = (before: FurnitureItem[]) => setHistory(h => ({ past: [...h.past.slice(-99), before], future: [] }));
  const changeItems = (fn: (list: FurnitureItem[]) => FurnitureItem[]) => { const before = itemsRef.current, next = fn(before); if (JSON.stringify(before) === JSON.stringify(next)) return; record(before); live(next); };
  const undoItems = () => {
    if (drag.current) { live(drag.current.before); drag.current = null; setDragging(false); setGuides([]); return; }
    const before = history.past.at(-1); if (!before) return; const currentItems = itemsRef.current;
    setHistory(h => ({ past: h.past.slice(0, -1), future: [currentItems, ...h.future] })); live(before);
  };
  const redoItems = () => { const next = history.future[0]; if (!next) return; const before = itemsRef.current; setHistory(h => ({ past: [...h.past, before], future: h.future.slice(1) })); live(next); };
  const mmPerPx = () => { const m = svgRef.current?.getScreenCTM(); return m ? 1 / Math.hypot(m.a, m.b) : 20; };
  const onItemDown = (e: RPE<SVGGElement>, it: FurnitureItem) => {
    if (e.button !== 0) return; e.stopPropagation();
    svgRef.current?.focus({ preventScroll: true });
    if (e.shiftKey) { setSelection(current => current.includes(it.id) ? current.filter(id => id !== it.id) : [...current, it.id]); return; }
    const ids = selection.includes(it.id) ? selection : [it.id]; setSelection(ids);
    const p = toWorld(e), before = itemsRef.current;
    drag.current = { mode: 'move', id: it.id, ids, start: { x: p.x, y: p.y }, item: it, before, inverse: svgRef.current!.getScreenCTM()!.inverse(), context: furnitureSnapContext(g, before.filter(i => !ids.includes(i.id))), moved: false };
    setDragging(true); svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onResizeDown = (e: RPE<SVGRectElement>, handle: ResizeHandle) => {
    if (e.button !== 0 || !sel) return; e.preventDefault(); e.stopPropagation(); svgRef.current?.focus({ preventScroll: true });
    const p = toWorld(e), before = itemsRef.current;
    drag.current = { mode: 'resize', id: sel.id, ids: [sel.id], start: { x: p.x, y: p.y }, item: sel, before, inverse: svgRef.current!.getScreenCTM()!.inverse(), context: furnitureSnapContext(g, before.filter(i => i.id !== sel.id)), handle, moved: false };
    setDragging(true); svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPE<SVGSVGElement>) => {
    const d = drag.current; if (!d) return;
    const p = toWorld(e, d.inverse); if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 2 * mmPerPx()) return;
    d.moved = true;
    const radius = Math.min(120, 10 * mmPerPx()), useSnap = snapping && !e.altKey;
    let item: FurnitureItem;
    if (d.mode === 'resize') {
      const anchor = localToWorld({ x: d.handle!.x * d.item.w / 2, y: d.handle!.y * d.item.d / 2 }, d.item.x, d.item.y, d.item.rot);
      const target = { x: anchor.x + p.x - d.start.x, y: anchor.y + p.y - d.start.y };
      const result = useSnap ? snapFurnitureResize(d.item, d.handle!, target, d.context, radius) : { item: resizeFurnitureAtHandle(d.item, d.handle!, target), guides: [] };
      item = result.item; setGuides(result.guides);
      live(d.before.map(i => i.id === d.id ? { ...item, roomId: g.rooms.find(r => pointInPolygon(item, r.polygon))?.id ?? i.roomId } : i));
    } else {
      const raw = { ...d.item, x: Math.round((d.item.x + p.x - d.start.x) / 10) * 10, y: Math.round((d.item.y + p.y - d.start.y) / 10) * 10 };
      const result = useSnap ? snapFurnitureMove(raw, d.context, radius) : { item: raw, guides: [] }; item = result.item; setGuides(result.guides);
      const dx = item.x - d.item.x, dy = item.y - d.item.y;
      live(d.before.map(i => { if (!d.ids.includes(i.id)) return i; const x = i.x + dx, y = i.y + dy; return { ...i, x, y, movedByManager: true, roomId: g.rooms.find(r => pointInPolygon({ x, y }, r.polygon))?.id ?? i.roomId }; }));
    }
  };
  const onUp = () => { const d = drag.current; if (d?.moved && JSON.stringify(d.before) !== JSON.stringify(itemsRef.current)) record(d.before); drag.current = null; setDragging(false); setGuides([]); };
  const onCancel = () => { if (drag.current) live(drag.current.before); drag.current = null; setDragging(false); setGuides([]); };

  const selectedItems = items.filter(i => selection.includes(i.id));
  const sel = items.find(i => i.id === selId) ?? null;
  const commonType = selectedItems.length && selectedItems.every(i => i.type === selectedItems[0].type) ? selectedItems[0].type : null;
  const patchSel = (p: Partial<FurnitureItem>) => changeItems(l => l.map(i => i.id === selId ? { ...i, ...p, movedByManager: true } : i));
  const rotate = () => changeItems(l => l.map(i => selection.includes(i.id) ? { ...i, rot: ((i.rot + 90) % 360) as Rot, movedByManager: true } : i));
  const remove = () => { if (selection.length) { changeItems(l => l.filter(i => !selection.includes(i.id))); setSelId(null); } };
  const addItem = (type: FurnitureType) => {
    const c = CATALOG[type];
    const room = g.rooms.filter((r) => r.type !== 'balcony').sort((a, b) => b.polygon.length - a.polygon.length)[0];
    const ctr = room ? centroid(room.polygon) : { x: 0, y: 0 };
    const size = type === 'dining' ? DINING_PRESETS[project.brief.diningSeats >= 6 ? 6 : 4] : { w: c.w, d: c.d };
    const it: FurnitureItem = { id: uid('f'), type, x: Math.round(ctr.x), y: Math.round(ctr.y), rot: 0, ...size, roomId: room?.id ?? null, ruleId: null, movedByManager: true, seats: type === 'dining' ? project.brief.diningSeats : undefined, modules: type === 'kitchen-run' ? kitchenModules(c.w, true) : undefined };
    changeItems((l) => [...l, it]);
    setSelId(it.id);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!ownsShortcut(rootRef.current, e)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redoItems(); else undoItems(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoItems(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 'r' && selection.length) rotate();
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) { e.preventDefault(); remove(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); setSelId(null); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const approve = () => update((p) => ({
    ...p,
    variants: p.variants.map((x) => ({ ...x, approved: x.id === v.id })),
    selectedVariantId: v.id,
    review: { variantId: v.id, approvedBy: p.manager || 'менеджер', approvedAt: new Date().toISOString(), note: '' },
  }));
  const current = project.variants.find((x) => x.id === v.id) ?? v;
  const shown = hl.length ? result.issues.filter((i) => i.itemIds.some((id) => hl.includes(id))) : result.issues;

  return (
    <div ref={rootRef} className="detail">
      <div className="card" style={{ padding: 12 }}>
        <PlanView ref={svgRef} g={g} items={items} issues={result.issues} mode="variant" wallImage={project.planImage} planStyle={project.planStyle} selectedIds={selection} viewBox={planBounds(g, 500)}
          onItemPointerDown={onItemDown} svgProps={{ tabIndex: 0, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onCancel, onLostPointerCapture: () => { if (drag.current) onCancel(); }, onPointerDown: e => { svgRef.current?.focus({ preventScroll: true }); if (!e.shiftKey) setSelId(null); } }}>
          {guides.map((guide, index) => <path key={index} data-snap-guide={guide.kind} d={`M${guide.a.x} ${guide.a.y}L${guide.b.x} ${guide.b.y}`} stroke="#2f6f8f" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
          {sel && <FurnitureHandles item={sel} radius={6 * mmPerPx()} onDown={onResizeDown} />}
        </PlanView>
        <div className="actions" style={{ marginTop: 10 }}>
          <button className="btn secondary sm" disabled={!history.past.length} onClick={undoItems}>Отменить мебель</button>
          <button className="btn secondary sm" disabled={!history.future.length} onClick={redoItems}>Повторить мебель</button>
          <label className="check-inline"><input type="checkbox" checked={snapping} onChange={e => setSnapping(e.target.checked)} />Прилипание мебели</label>
          {selectedItems.length > 1 && <span className="badge">Выбрано предметов: {selectedItems.length}</span>}
          {commonType && <label className="field">Тип выбранной мебели<select value={commonType} onChange={e => { const type = e.target.value as FurnitureType; changeItems(list => list.map(i => selection.includes(i.id) ? changeFurnitureType(i, type) : i)); }}>{ADDABLE.map(type => <option key={type} value={type}>{CATALOG[type].name}</option>)}</select></label>}
          {selectedItems.length > 1 && <><button className="btn secondary sm" onClick={rotate}>Повернуть выбранные (R)</button><button className="btn ghost sm" onClick={remove}>Удалить выбранные предметы</button></>}
          <label className="field" style={{ minWidth: 200 }}><span className="hint">Добавить предмет</span>
            <select value="" onChange={(e) => e.target.value && addItem(e.target.value as FurnitureType)}>
              <option value="">— выберите —</option>
              {ADDABLE.map((t) => <option key={t} value={t}>{CATALOG[t].name}</option>)}
            </select>
          </label>
          {sel && (
            <>
              <span className="badge">{CATALOG[sel.type].name} {Math.round(sel.w)}×{Math.round(sel.d)}</span>
              <button className="btn secondary sm" onClick={rotate}>Повернуть (R)</button>
              <div className="fields" key={sel.id}>
                <SizeInput label="Ширина предмета, мм" value={sel.w} onCommit={w => patchSel(resizeFurniture(sel, w, sel.d))} />
                <SizeInput label="Глубина предмета, мм" value={sel.d} onCommit={d => patchSel(resizeFurniture(sel, sel.w, d))} />
              </div>
              <span className="hint">Enter или выход из поля — применить размер. Ширина и глубина заданы до поворота предмета.</span>
              <button className="btn ghost sm" onClick={remove}>Удалить</button>
            </>
          )}
        </div>
        <p className="fineprint">Перетаскивайте мебель; Shift + щелчок — выбрать несколько; маркеры на сторонах и углах — изменить размер. Alt — временно без прилипания. Ctrl+Z — отменить правку мебели. Красная рамка — нарушение, жёлтая — замечание.</p>
      </div>
      <aside className="panel">
        <div className="card">
          <h3>{v.title}</h3>
          <p className="small muted" style={{ marginTop: 0 }}>{v.idea}</p>
          <span className={`badge ${errors.length ? 'err' : 'ok'}`}>{errors.length ? `Нарушений: ${errors.length}` : 'Проверки пройдены'}</span>
          <h3 style={{ marginTop: 14 }}>Проверки</h3>
          <div className="issues">
            {!shown.length && <p className="muted small">Замечаний нет.</p>}
            {shown.map((i, n) => (
              <button key={n} className={`issue ${i.severity}`} onClick={() => setHl(i.itemIds)} title="Показать предметы">
                <span>{i.severity === 'error' ? '✕' : '!'}</span><span>{i.message}</span>
              </button>
            ))}
          </div>
          {hl.length > 0 && <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setHl([])}>Показать все</button>}
          <div className="actions">
            <button className="btn" disabled={errors.length > 0 || current.approved} onClick={approve}>{current.approved ? 'Утверждён для клиента' : 'Утвердить для клиента'}</button>
          </div>
          {errors.length > 0 && <p className="muted small">Вариант с нарушениями нельзя показать клиенту: доработайте расстановку вручную.</p>}
        </div>
        <div className="card">
          <h3>Польза</h3><ul className="list">{current.benefits.map((b) => <li key={b}>{b}</li>)}</ul>
          <h3>Компромиссы</h3><ul className="list minus">{current.compromises.length ? current.compromises.map((b) => <li key={b}>{b}</li>) : <li>Существенных нет</li>}</ul>
          <h3>Предполагаемые изменения</h3><ul className="list">{current.changes.map((b) => <li key={b}>{b}</li>)}</ul>
          <h3>Допущения</h3><ul className="list">{current.assumptions.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      </aside>
    </div>
  );
}

function ReferenceCompare({ v }: { v: Variant }) {
  const { project, update } = useStore();
  const ref = project.documents.find((d) => d.role === 'reference') ?? null;
  const src = useSourcePage(ref, project.referencePage, false);
  if (!ref) return null;
  return (
    <section className="card" style={{ marginTop: 18 }}>
      <h2>Сравнение с решением дизайнера <span className="badge">внутреннее</span></h2>
      <p className="muted small">Эталон не показывается клиенту. Запишите, что совпало, что отличается и почему.</p>
      <div className="compare">
        <div><h3>Вариант «{v.title}»</h3><PlanView g={project.geometry} items={v.items} mode="variant" wallImage={project.planImage} planStyle={project.planStyle} viewBox={planBounds(project.geometry, 400)} /></div>
        <div><h3>Эталон, стр. {project.referencePage}</h3>{src.loading ? <p className="muted"><span className="spinner" />Загружаю…</p> : src.page ? <img src={src.page.imageUrl} alt="Эталонное решение дизайнера" /> : <p className="muted">{src.error ?? 'Выберите страницу эталона на шаге «Загрузка».'}</p>}</div>
      </div>
      <label className="field" style={{ marginTop: 12 }}>Разбор отличий
        <textarea value={project.referenceNotes} onChange={(e) => update((p) => ({ ...p, referenceNotes: e.target.value }))} placeholder="Совпало: … Отличается: … Почему: …" style={{ minHeight: 110 }} />
      </label>
    </section>
  );
}


/** Назначение комнат: одним кликом поправить то, что программа угадала неверно, и пересобрать варианты. */
function RoomsPanel({ onChanged, busy, onRescaled }: { onChanged: () => void; busy: boolean; onRescaled: () => void }) {
  const { project, update } = useStore();
  const g = project.geometry;
  const [dirty, setDirty] = useState(false);
  const [areaInput, setAreaInput] = useState<{ id: string; v: string } | null>(null);
  // Площадь комнаты с плана БТИ → масштаб всего плана.
  const applyArea = () => {
    if (!areaInput) return;
    const r = g.rooms.find((x) => x.id === areaInput.id);
    const want = Number(areaInput.v.replace(',', '.'));
    if (!r || !(want > 0.5)) return;
    const f = Math.sqrt((want * 1e6) / roomArea(r.polygon));
    update((p) => scaleProject(p, f));
    setAreaInput(null);
    onRescaled();
  };
  if (!g.rooms.length) return null;
  const setType = (id: string, type: RoomType) => {
    update((p) => {
      const rooms = p.geometry.rooms.map((r) => (r.id === id ? { ...r, type, name: roomName(type), typeSource: 'manual' as const, typeBasis: undefined, verifiedByManager: true } : r));
      const geometry = { ...p.geometry, rooms };
      return { ...p, geometry: { ...geometry, approvedHash: geometryHash(geometry) } };
    });
    setDirty(true);
  };
  return (
    <details className="card" style={{ marginTop: 14 }} open={dirty}>
      <summary style={{ margin: 0 }}>Комнаты ({g.rooms.length}) — назначение и масштаб</summary>
      <p className="muted small">Впишите площадь любой комнаты с плана БТИ (например, 23,1) — весь план растянется по ней, и мебель встанет в реальном размере.</p>
      <div className="fields" style={{ marginTop: 12 }}>
        {g.rooms.map((r) => (
          <label className="field" key={r.id}>
            <span>{r.name} · {(roomArea(r.polygon) / 1e6).toFixed(1).replace('.', ',')} м²</span>
            <select value={r.type} onChange={(e) => setType(r.id, e.target.value as RoomType)}>
              {ROOM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="hint">{r.typeSource === 'manual' ? 'Назначение выбрано вами' : r.typeBasis ?? 'Автоматическое предположение — проверьте назначение'}</span>
            {r.typeSource !== 'manual' && r.type !== 'other' && <button className="btn ghost sm" disabled={busy} onClick={() => setType(r.id, r.type)}>Подтвердить назначение</button>}
            <input inputMode="decimal" placeholder="площадь по плану, м²" value={areaInput?.id === r.id ? areaInput.v : ''}
              onChange={(e) => setAreaInput({ id: r.id, v: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && applyArea()} />
          </label>
        ))}
      </div>
      {areaInput?.v && (
        <div className="actions"><button className="btn" disabled={busy} onClick={applyArea}>Растянуть план по площади и пересобрать</button></div>
      )}
      {dirty && (
        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => { setDirty(false); onChanged(); }}>Пересобрать варианты с новыми назначениями</button>
        </div>
      )}
    </details>
  );
}

/** «Растянуть» план: если мебель выглядит слишком крупной или мелкой относительно плана. */
function ScalePanel({ onApplied, busy }: { onApplied: () => void; busy: boolean }) {
  const { update } = useStore();
  const [pct, setPct] = useState(100);
  const apply = () => {
    update((p) => scaleProject(p, pct / 100));
    setPct(100);
    onApplied();
  };
  return (
    <div className="card" style={{ marginTop: 14, padding: 14 }}>
      <div className="actions" style={{ marginTop: 0 }}>
        <label className="check-inline" style={{ flex: '1 1 320px' }}>
          Размер квартиры относительно мебели
          <input type="range" min={60} max={160} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ flex: 1 }} />
          <b style={{ minWidth: 48 }}>{pct}%</b>
        </label>
        <button className="btn sm" disabled={busy || pct === 100} onClick={apply}>Применить и пересобрать</button>
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>Мебель кажется слишком крупной — увеличьте процент, слишком мелкой — уменьшите.</p>
    </div>
  );
}

/** Растянуть план (геометрию и картинку) в f раз по линейным размерам. */
function scaleProject(p: Project, f: number): Project {
  const g2 = { ...scaleGeometry(p.geometry, f), calibration: p.geometry.calibration ? { ...p.geometry.calibration, mmPerUnit: p.geometry.calibration.mmPerUnit * f, method: 'manual' as const } : null };
  // Старые варианты построены на прежнем масштабе — убираем, их пересоберут.
  return { ...p, geometry: { ...g2, approvedHash: geometryHash(g2) }, planImage: p.planImage && { ...p.planImage, widthMm: p.planImage.widthMm * f, heightMm: p.planImage.heightMm * f }, variants: [], selectedVariantId: null, review: null };
}
