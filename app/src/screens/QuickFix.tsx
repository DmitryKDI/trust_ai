// Быстрая правка распознанного плана прямо на экране вариантов: каждая типичная ошибка
// автоматического чтения исправляется одним-двумя щелчками поверх исходной картинки.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import type { Opening, PlanGeometry, Pt, Room, RoomType } from '../model/types';
import { uid } from '../model/defaults';
import { useStore } from '../state/store';
import { PlanView, planBounds, polyPath } from '../plan/PlanView';
import { geometryHash } from '../geometry/plan';
import { pointInPolygon, type BBox } from '../geometry/poly';
import { doorAt, mergeRooms, roomFromImage, splitRoom, type ImageData8 } from '../editor/quickfix';

type Tool = 'select' | 'add' | 'split' | 'merge' | 'door';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Выбрать', hint: 'Щёлкните помещение или дверь — внизу появятся действия. Колесо мыши — масштаб.' },
  { id: 'add', label: 'Добавить комнату', hint: 'Щёлкните по свободному полу внутри пропущенного помещения (не по сантехнике и цифрам) — контур найдётся сам.' },
  { id: 'split', label: 'Разрезать', hint: 'Проведите линию по стене между слипшимися помещениями: два щелчка — начало и конец.' },
  { id: 'merge', label: 'Объединить', hint: 'Щёлкните два куска одного помещения (например, разрезанного надписью).' },
  { id: 'door', label: 'Дверь', hint: 'Щёлкните по стене, где должна быть дверь. Снаружи квартиры — входная.' },
];

const TYPES: [RoomType, string][] = [
  ['living', 'Гостиная'], ['bedroom', 'Спальня'], ['kids', 'Детская'], ['kitchen', 'Кухня'], ['kitchen-living', 'Кухня-гостиная'],
  ['hall', 'Прихожая'], ['corridor', 'Коридор'], ['bath', 'Ванная'], ['wc', 'Санузел'], ['storage', 'Кладовая'], ['balcony', 'Балкон / лоджия'],
];
const nameOf = (t: RoomType) => TYPES.find((x) => x[0] === t)?.[1] ?? 'Помещение';

export function QuickFix({ onRebuild, busy }: { onRebuild: () => void; busy: boolean }) {
  const { project, editGeometry, update, undo, redo, canUndo, canRedo } = useStore();
  const g = project.geometry;
  const img = project.planImage ?? null;
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<{ kind: 'room' | 'opening'; id: string } | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [first, setFirst] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [view, setView] = useState<BBox | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pixels = useRef<{ data: ImageData8; mmPerPx: number } | null>(null);

  // Пиксели исходной картинки — для «Добавить комнату».
  useEffect(() => {
    pixels.current = null;
    if (!img) return;
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      pixels.current = { data: { data: d.data, width: d.width, height: d.height }, mmPerPx: img.widthMm / im.naturalWidth };
    };
    im.src = img.url;
  }, [img]);

  const vb = view ?? planBounds(g, 800);
  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const r = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: r.x, y: r.y };
  };

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const f = Math.exp(e.deltaY * 0.0015);
    setView((v) => {
      const cur = v ?? planBounds(g, 800);
      return { minX: p.x + (cur.minX - p.x) * f, maxX: p.x + (cur.maxX - p.x) * f, minY: p.y + (cur.minY - p.y) * f, maxY: p.y + (cur.maxY - p.y) * f };
    });
  }, [g]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // Ctrl+Z / Ctrl+Y и Esc (сбросить начатое действие).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Escape') { setDraft([]); setFirst(null); setSel(null); }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [undo, redo]);

  /** Правка с историей (отмена) и сразу утверждённая: варианты пересобираются по кнопке. */
  const fix = (fn: (x: PlanGeometry) => PlanGeometry, note?: string) => {
    editGeometry(fn);
    update((p) => ({ ...p, geometry: { ...p.geometry, approved: true, approvedAt: new Date().toISOString(), approvedHash: geometryHash(p.geometry) } }));
    setChanged(true);
    setMsg(note ?? null);
  };

  const roomAt = (p: Pt) => g.rooms.find((r) => pointInPolygon(p, r.polygon)) ?? null;

  const onDown = (e: RPE<SVGSVGElement>) => {
    if (e.button !== 0 || tool === 'select' || tool === 'merge') return;
    const p = toWorld(e);
    if (tool === 'add') {
      if (!pixels.current) { setMsg('Картинка плана ещё загружается или недоступна — помещение можно обвести на шаге «Разметка».'); return; }
      if (roomAt(p)) { setMsg('Здесь уже есть помещение. Если оно неверное — выберите его и удалите, затем добавьте заново.'); return; }
      const { data, mmPerPx } = pixels.current;
      const poly = roomFromImage(data, { x: p.x / mmPerPx, y: p.y / mmPerPx }, mmPerPx);
      if (!poly) { setMsg('Контур не найден: помещение не замкнуто на картинке. Обведите его на шаге «Разметка» инструментом «Помещение по точкам».'); return; }
      const room: Room = { id: uid('r'), name: 'Помещение', type: 'other', polygon: poly, source: 'manual', verifiedByManager: true, sourcePage: g.sourcePage };
      fix((x) => ({ ...x, rooms: [...x.rooms, room] }), 'Помещение добавлено — выберите его назначение ниже.');
      setSel({ kind: 'room', id: room.id });
      setTool('select');
      return;
    }
    if (tool === 'split') {
      if (!draft.length) { setDraft([p]); return; }
      const a = draft[0];
      setDraft([]);
      const mid = { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 };
      const r = roomAt(mid) ?? g.rooms.find((x) => [0.25, 0.75].some((t) => pointInPolygon({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t }, x.polygon))) ?? null;
      const parts = r && splitRoom(r, a, p);
      if (!parts) { setMsg('Линия должна пересекать помещение целиком, от стены до стены.'); return; }
      fix((x) => ({ ...x, rooms: x.rooms.flatMap((q) => (q.id === r!.id ? parts : [q])) }), 'Помещение разрезано. Назначьте тип новой части.');
      setSel({ kind: 'room', id: parts[1].id });
      setTool('select');
      return;
    }
    if (tool === 'door') {
      const near = g.openings.find((o) => Math.hypot((o.a.x + o.b.x) / 2 - p.x, (o.a.y + o.b.y) / 2 - p.y) < 400);
      if (near) { setSel({ kind: 'opening', id: near.id }); setTool('select'); return; }
      const d = doorAt(g, p);
      if (!d) { setMsg('Щёлкните ближе к стене помещения.'); return; }
      fix((x) => ({ ...x, openings: [...x.openings, d] }), d.isEntrance ? 'Входная дверь добавлена.' : 'Дверь добавлена.');
      setSel({ kind: 'opening', id: d.id });
    }
  };

  const onElement = (kind: string, id: string) => {
    if (tool === 'merge' && kind === 'room') {
      if (!first) { setFirst(id); setMsg('Теперь щёлкните вторую часть.'); return; }
      if (first === id) return;
      const r1 = g.rooms.find((r) => r.id === first)!, r2 = g.rooms.find((r) => r.id === id)!;
      setFirst(null);
      const m = mergeRooms(r1, r2);
      if (!m) { setMsg('Эти помещения не соседние — объединять нечего.'); return; }
      fix((x) => ({
        ...x,
        rooms: x.rooms.filter((r) => r.id !== r1.id && r.id !== r2.id).concat(m),
        // Двери между объединёнными частями больше не нужны.
        openings: x.openings.filter((o) => !pointInPolygon({ x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 }, m.polygon)),
      }), 'Помещения объединены.');
      setSel({ kind: 'room', id: m.id });
      setTool('select');
      return;
    }
    if (tool === 'select' && (kind === 'room' || kind === 'opening')) { setSel({ kind, id }); setMsg(null); }
  };

  const room = sel?.kind === 'room' ? g.rooms.find((r) => r.id === sel.id) ?? null : null;
  const opening = sel?.kind === 'opening' ? g.openings.find((o) => o.id === sel.id) ?? null : null;
  const setRoom = (patch: Partial<Room>) => fix((x) => ({ ...x, rooms: x.rooms.map((r) => (r.id === room!.id ? { ...r, ...patch, verifiedByManager: true } : r)) }));
  const setOpening = (fn: (o: Opening, all: Opening[]) => Opening[]) => fix((x) => ({ ...x, openings: fn(x.openings.find((o) => o.id === opening!.id)!, x.openings) }));
  const firstRoom = first ? g.rooms.find((r) => r.id === first) : null;

  return (
    <details className="card" style={{ marginTop: 14 }} open>
      <summary style={{ margin: 0 }}>Быстрая правка плана</summary>
      <p className="muted small">Проверьте план поверх оригинала. Ошибки распознавания правятся щелчком; Ctrl+Z — отменить.</p>
      <div className="toolbar" role="toolbar" aria-label="Быстрая правка">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool ${tool === t.id ? 'on' : ''}`} disabled={t.id === 'add' && !img}
            onClick={() => { setTool(t.id); setDraft([]); setFirst(null); setMsg(null); }}>{t.label}</button>
        ))}
        <button className="tool" onClick={undo} disabled={!canUndo}>Отменить</button>
        <button className="tool" onClick={redo} disabled={!canRedo}>Повторить</button>
        <button className="tool" onClick={() => setView(null)}>Вписать</button>
      </div>
      <div className="canvas-wrap qf-canvas">
        <PlanView ref={svgRef} g={g} mode="editor" viewBox={vb} selectedId={sel?.id}
          underlay={img ? { url: img.url, widthMm: img.widthMm, heightMm: img.heightMm, opacity: 0.45 } : null}
          onElementClick={onElement}
          svgProps={{ onPointerDown: onDown, style: { cursor: tool === 'select' || tool === 'merge' ? 'pointer' : 'crosshair' } }}>
          {room && <path d={polyPath(room.polygon)} fill="rgba(210,105,30,.12)" stroke="#d2691e" strokeWidth={3} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {firstRoom && <path d={polyPath(firstRoom.polygon)} fill="rgba(47,111,143,.15)" stroke="#2f6f8f" strokeWidth={3} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {opening && <path d={`M${opening.a.x} ${opening.a.y}L${opening.b.x} ${opening.b.y}`} stroke="#d2691e" strokeWidth={8} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {draft.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={(vb.maxX - vb.minX) / 150} fill="#d2691e" pointerEvents="none" />)}
        </PlanView>
        <div className="canvas-hint">{msg ?? TOOLS.find((t) => t.id === tool)!.hint}</div>
      </div>

      {room && (
        <div className="qf-actions">
          <div className="small"><b>{room.name}</b> — назначение:</div>
          <div className="qf-chips">
            {TYPES.map(([t, l]) => (
              <button key={t} className={`tool ${room.type === t ? 'on' : ''}`} onClick={() => setRoom({ type: t, name: nameOf(t) })}>{l}</button>
            ))}
          </div>
          <div className="actions" style={{ marginTop: 6 }}>
            <button className="btn ghost sm" onClick={() => { fix((x) => ({ ...x, rooms: x.rooms.filter((r) => r.id !== room.id) }), 'Помещение удалено.'); setSel(null); }}>Удалить помещение</button>
          </div>
        </div>
      )}
      {opening && (
        <div className="qf-actions">
          <div className="small"><b>{opening.type === 'door' ? (opening.isEntrance ? 'Входная дверь' : 'Дверь') : 'Окно'}</b></div>
          <div className="actions" style={{ marginTop: 6 }}>
            {opening.type === 'door' && !opening.isEntrance && (
              <button className="btn secondary sm" onClick={() => setOpening((o, all) => all.map((x) => ({ ...x, isEntrance: x.id === o.id })))}>Сделать входной</button>
            )}
            <button className="btn secondary sm" onClick={() => setOpening((o, all) => all.map((x) => (x.id === o.id ? { ...x, type: x.type === 'door' ? 'window' : 'door', isEntrance: false } : x)))}>
              Это {opening.type === 'door' ? 'окно' : 'дверь'}
            </button>
            <button className="btn ghost sm" onClick={() => { setOpening((o, all) => all.filter((x) => x.id !== o.id)); setSel(null); }}>Удалить</button>
          </div>
        </div>
      )}
      {changed && (
        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => { setChanged(false); onRebuild(); }}>{busy ? 'Пересобираю…' : 'Пересобрать варианты по исправленному плану'}</button>
        </div>
      )}
    </details>
  );
}
