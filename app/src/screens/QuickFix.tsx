// Быстрая правка распознанного плана прямо на экране вариантов: каждая типичная ошибка
// автоматического чтения исправляется одним-двумя щелчками поверх исходной картинки.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import type { Opening, PlanGeometry, Pt, Room, RoomType, Wall, WallKind } from '../model/types';
import { uid } from '../model/defaults';
import { useStore } from '../state/store';
import { RecognitionLegend, RecognitionOverlay } from '../plan/RecognitionOverlay';
import { PlanView, planBounds, polyPath } from '../plan/PlanView';
import { geometryHash, usesRoomWalls, detectRoomPolygon } from '../geometry/plan';
import { dist, pointInPolygon, type BBox } from '../geometry/poly';
import { addPlanWallChain, orthogonalPoint, resizeOpening, snapPolylineClosure, WALL_KINDS } from '../editor/ops';
import { ownsShortcut, historyShortcut } from '../editor/keyboard';
import { BatchProperties } from '../editor/BatchProperties';
import { GeometryHandles, WallAngle } from '../editor/GeometryHandles';
import { deleteSelection, selectElement, type ElementSelection } from '../editor/selection';
import { useDraftHistory } from '../editor/useDraftHistory';
import { repairWallJunctions, snapWallAxis } from '../editor/wallJunctions';
import { SizeInput } from '../editor/SizeInput';
import { doorAt, mergeRooms, newRoomFromImage, roomFromCorners, roomFromPoints, splitRoom, type ImageData8 } from '../editor/quickfix';
import { ROOM_TYPES, roomName } from '../learning/model';

type Tool = 'select' | 'pan' | 'add' | 'rect' | 'roomPoly' | 'split' | 'merge' | 'door' | 'wall';

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'pan', key: 'H', label: 'Рука', hint: 'Перетаскивайте план мышью. Колесо — масштаб. В любом инструменте: пробел или средняя кнопка мыши — временно перемещать план.' },
  { id: 'select', key: 'V', label: 'Выбрать', hint: 'Щёлкните объект — внизу появятся действия. Delete — удалить; колесо мыши — масштаб.' },
  { id: 'add', key: 'A', label: 'Добавить комнату', hint: 'Щёлкните по свободному полу внутри пропущенного помещения (не по сантехнике и цифрам) — контур найдётся сам.' },
  { id: 'rect', key: 'N', label: 'Комната по углам', hint: 'Два щелчка — противоположные углы помещения (удобно для санузлов с сантехникой).' },
  { id: 'roomPoly', key: 'P', label: 'Контур комнаты', hint: 'Щёлкайте углы по порядку. Enter на последней точке — автоматически соединить её с первой и заполнить комнату. Две точки + Enter — прямоугольник. Shift — горизонталь или вертикаль; Esc — отменить.' },
  { id: 'split', key: 'X', label: 'Разрезать', hint: 'Проведите линию по стене между слипшимися помещениями: два щелчка — начало и конец.' },
  { id: 'merge', key: 'M', label: 'Объединить', hint: 'Щёлкните два куска одного помещения (например, разрезанного надписью).' },
  { id: 'door', key: 'D', label: 'Дверь', hint: 'Щёлкните по стене, где должна быть дверь. Снаружи квартиры — входная.' },
  { id: 'wall', key: 'W', label: 'Стена', hint: 'Щёлкайте углы полилинии; Enter — создать стены; Shift — горизонталь или вертикаль; щелчок у первой точки — замкнуть; Esc — отменить.' },
];

const nameOf = roomName;

export function QuickFix({ onRebuild, busy }: { onRebuild: () => void; busy: boolean }) {
  const { project, editGeometry, update, undo, redo, canUndo, canRedo } = useStore();
  const g = project.geometry;
  const img = project.planImage ?? null;
  const [tool, setTool] = useState<Tool>('select');
  const [newRoomType, setNewRoomType] = useState<RoomType>('other');
  const [selection, setSelection] = useState<ElementSelection[]>([]);
  const sel = selection.length === 1 ? selection[0] : null;
  const setSel = (value: ElementSelection | null) => setSelection(value ? [value] : []);
  const [wallKind, setWallKind] = useState<WallKind>('unknown');
  const [wallT, setWallT] = useState(100);
  const [doorWidth, setDoorWidth] = useState(800);
  const [doorLeaves, setDoorLeaves] = useState<1 | 2>(1);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const lastPointer = useRef<Pt | null>(null);
  const { points: draft, set: setDraft, undo: undoDraft, redo: redoDraft, canRedo: canRedoDraft } = useDraftHistory();
  const [first, setFirst] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [view, setView] = useState<BBox | null>(null);
  const [showRecognition, setShowRecognition] = useState(true);
  const [originalOnly, setOriginalOnly] = useState(false);
  const rootRef = useRef<HTMLDetailsElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pan = useRef<{ pointerId: number; start: Pt; view: BBox; inverse: DOMMatrix } | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceDown = useRef(false);
  const suppressClick = useRef(false);
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

  const showOriginal = originalOnly && !!img;
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
    if (pan.current) return;
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

  const stopPan = () => {
    const gesture = pan.current; pan.current = null; setPanning(false);
    if (gesture && svgRef.current?.hasPointerCapture(gesture.pointerId)) svgRef.current.releasePointerCapture(gesture.pointerId);
  };

  // Ctrl+Z / Ctrl+Y и Esc (сбросить начатое действие).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!ownsShortcut(rootRef.current, e)) return;
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); spaceDown.current = true; setSpaceHeld(true); return; }
      if (pan.current) { if (e.key === 'Escape') { e.preventDefault(); stopPan(); } return; }
      if (originalOnly && img) { if (e.key === 'Escape') { e.preventDefault(); setOriginalOnly(false); } return; }
      const history = historyShortcut(e);
      if (history) { e.preventDefault(); if (history === 'undo') { if (draft.length) undoDraft(); else undo(); } else { if (canRedoDraft) redoDraft(); else redo(); } }
      else if (e.key === 'Escape') { e.preventDefault(); setDraft([]); setFirst(null); setSel(null); }
      else if (e.key === 'Enter' && tool === 'wall') { e.preventDefault(); finishWalls(); }
      else if (e.key === 'Enter' && tool === 'roomPoly') { e.preventDefault(); finishRoom(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) { e.preventDefault(); removeSelected(); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const next = TOOLS.find(t => t.key.toLowerCase() === e.key.toLowerCase());
        if (next && !(next.id === 'add' && !img && !g.walls.length)) { e.preventDefault(); setTool(next.id); setDraft([]); setSel(null); setFirst(null); setMsg(null); }
      }
      if (e.key === 'Shift' && (tool === 'wall' || tool === 'roomPoly') && draft.length && lastPointer.current) setCursor(wallPoint(lastPointer.current, true));
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') { spaceDown.current = false; setSpaceHeld(false); }
      if (e.key === 'Shift' && lastPointer.current) setCursor(wallPoint(lastPointer.current, false));
    };
    const blur = () => { spaceDown.current = false; setSpaceHeld(false); stopPan(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  });

  /** Правка с историей (отмена) и сразу утверждённая: варианты пересобираются по кнопке. */
  const fix = (fn: (x: PlanGeometry) => PlanGeometry, note?: string) => {
    editGeometry(fn);
    update((p) => ({ ...p, geometry: { ...p.geometry, approved: true, approvedAt: new Date().toISOString(), approvedHash: geometryHash(p.geometry) } }));
    setChanged(true);
    setMsg(note ?? null);
  };

  const mmPerPx = () => { const svg = svgRef.current; const m = svg?.getScreenCTM(); return m ? 1 / Math.hypot(m.a, m.b) : 20; };
  const wallPoint = (raw: Pt, shift: boolean) => snapPolylineClosure(raw, draft, 12 * mmPerPx()) ?? (tool === 'wall' ? snapWallAxis(raw, g.walls, 12 * mmPerPx(), draft.at(-1) ?? null, shift) : shift && draft.length ? orthogonalPoint(draft[draft.length - 1], raw) : raw);
  const finishWalls = (points = draft) => {
    if (points.length < 2) return;
    fix(x => addPlanWallChain(x, points, { thickness: wallT, kind: wallKind }), 'Стены добавлены. Пересоберите мебель. Ctrl+Z — отменить всю полилинию.');
    setDraft([]); setSel(null); setCursor(null); setTool('select');
  };
  const finishRoom = (points = draft) => {
    if (points.length < 2) return;
    const polygon = roomFromPoints(points, g.rooms);
    if (!polygon) { setMsg('Контур пересекается, слишком мал или занят другой комнатой. Исправьте точки; Ctrl+Z — убрать последнюю.'); return; }
    const room: Room = { id: uid('r'), name: nameOf(newRoomType), type: newRoomType, typeSource: 'manual', polygon, source: 'manual', verifiedByManager: true, sourcePage: g.sourcePage };
    fix(x => ({ ...x, rooms: [...x.rooms, room] }), 'Комната добавлена по контуру. Пересоберите варианты.');
    setDraft([]); setCursor(null); setSel({ kind: 'room', id: room.id }); setTool('select');
  };

  const removeSelected = () => {
    if (!selection.length) return;
    fix(x => deleteSelection(x, selection), 'Выбранные элементы удалены. Пересоберите варианты.');
    setSel(null);
  };

  const roomAt = (p: Pt) => g.rooms.find((r) => pointInPolygon(p, r.polygon)) ?? null;

  const onDown = (e: RPE<SVGSVGElement>) => {
    const svg = svgRef.current; svg?.focus({ preventScroll: true });
    if (pan.current || !e.isPrimary) return;
    suppressClick.current = false;
    if (e.button === 1 || e.button === 0 && (tool === 'pan' || spaceDown.current || originalOnly && !!img)) {
      const matrix = svg?.getScreenCTM(); if (!svg || !matrix) return;
      e.preventDefault();
      suppressClick.current = true;
      pan.current = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, view: vb, inverse: matrix.inverse() };
      setPanning(true); setCursor(null); svg.setPointerCapture(e.pointerId); return;
    }
    if (e.button !== 0 || tool === 'select' || tool === 'merge') return;
    const p = toWorld(e);
    if (tool === 'roomPoly') {
      if (snapPolylineClosure(p, draft, 12 * mmPerPx())) { finishRoom(); return; }
      const point = wallPoint(p, e.shiftKey), q = { x: Math.round(point.x), y: Math.round(point.y) };
      if (draft.length && dist(draft.at(-1)!, q) < 50) return;
      setDraft(d => [...d, q]); setMsg(null); return;
    }
    if (tool === 'wall') {
      const closed = snapPolylineClosure(p, draft, 12 * mmPerPx());
      if (closed) { finishWalls([...draft, closed]); return; }
      const point = wallPoint(p, e.shiftKey);
      const q = { x: Math.round(point.x), y: Math.round(point.y) };
      if (draft.length && dist(draft[draft.length - 1], q) < 50) { setMsg('Выберите следующую точку дальше от предыдущей.'); return; }
      setDraft(d => [...d, q]); setMsg(null);
      return;
    }
    if (tool === 'add') {
      if (roomAt(p)) { setMsg('Здесь уже есть помещение. Если оно неверное — выберите его и удалите, затем добавьте заново.'); return; }
      const roomGeometry = repairWallJunctions(g);
      const contour = detectRoomPolygon(roomGeometry, p);
      let poly = contour ? roomFromPoints(contour, g.rooms) : null;
      if (!poly && pixels.current) {
        const { data, mmPerPx } = pixels.current;
        poly = newRoomFromImage(data, { x: p.x / mmPerPx, y: p.y / mmPerPx }, mmPerPx, g.rooms);
      }
      if (!poly) { setMsg('Контур не замкнут. Нажмите «Соединить углы стен» или добавьте отсутствующие стены и проёмы.'); return; }
      const room: Room = { id: uid('r'), name: nameOf(newRoomType), type: newRoomType, typeSource: 'manual', polygon: poly, source: 'manual', verifiedByManager: true, sourcePage: g.sourcePage };
      fix((x) => ({ ...x, walls: roomGeometry.walls, rooms: [...x.rooms, room] }), 'Помещение добавлено по замкнутому контуру — выберите его назначение ниже.');
      setSel({ kind: 'room', id: room.id });
      setTool('select');
      return;
    }
    if (tool === 'rect') {
      if (!draft.length) { setDraft([p]); return; }
      const poly = roomFromCorners(draft[0], p, g.rooms);
      setDraft([]);
      if (!poly) { setMsg('Прямоугольник слишком мал или целиком занят другими помещениями.'); return; }
      const room: Room = { id: uid('r'), name: nameOf(newRoomType), type: newRoomType, typeSource: 'manual', polygon: poly, source: 'manual', verifiedByManager: true, sourcePage: g.sourcePage };
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
      const found = doorAt(g, p, doorWidth);
      if (!found) { setMsg('Щёлкните ближе к стене помещения.'); return; }
      const d = { ...found, leaves: doorLeaves };
      fix((x) => ({ ...x, openings: [...x.openings, d] }), d.isEntrance ? 'Входная дверь добавлена.' : 'Дверь добавлена.');
      setSel({ kind: 'opening', id: d.id });
    }
  };

  const onMove = (e: RPE<SVGSVGElement>) => {
    const gesture = pan.current;
    if (gesture) {
      if (e.pointerId !== gesture.pointerId) return;
      e.preventDefault();
      const x = e.clientX - gesture.start.x, y = e.clientY - gesture.start.y;
      const dx = gesture.inverse.a * x + gesture.inverse.c * y, dy = gesture.inverse.b * x + gesture.inverse.d * y;
      const v = gesture.view;
      setView({ minX: v.minX - dx, maxX: v.maxX - dx, minY: v.minY - dy, maxY: v.maxY - dy });
      return;
    }
    const point = toWorld(e); lastPointer.current = point;
    setCursor(tool === 'pan' || spaceDown.current ? null : tool === 'wall' || tool === 'roomPoly' ? wallPoint(point, e.shiftKey) : point);
  };
  const onUp = (e: RPE<SVGSVGElement>) => { if (pan.current?.pointerId === e.pointerId) stopPan(); };

  const onElement = (kind: ElementSelection['kind'], id: string, event: React.MouseEvent<SVGElement>) => {
    if (tool === 'pan' || spaceDown.current || suppressClick.current) return;
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
    if (tool === 'select') { setSelection(current => selectElement(current, { kind, id }, event.shiftKey)); setMsg(null); }
  };

  const room = sel?.kind === 'room' ? g.rooms.find((r) => r.id === sel.id) ?? null : null;
  const opening = sel?.kind === 'opening' ? g.openings.find((o) => o.id === sel.id) ?? null : null;
  const wall = sel?.kind === 'wall' ? g.walls.find(w => w.id === sel.id) ?? null : null;
  const setWall = (patch: Partial<Wall>) => fix(x => ({ ...x, walls: x.walls.map(w => w.id === wall!.id ? { ...w, ...patch, source: 'manual', verifiedByManager: true } : w) }));
  const setRoom = (patch: Partial<Room>) => fix((x) => ({ ...x, rooms: x.rooms.map((r) => (r.id === room!.id ? { ...r, ...patch, verifiedByManager: true } : r)) }));
  const setOpening = (fn: (o: Opening, all: Opening[]) => Opening[]) => fix((x) => ({ ...x, openings: fn(x.openings.find((o) => o.id === opening!.id)!, x.openings) }));
  const shownGeometry = originalOnly && img ? { ...g, walls: [], openings: [], rooms: [], fixed: [], wetZones: [] } : g;
  const firstRoom = first ? g.rooms.find((r) => r.id === first) : null;

  return (
    <details ref={rootRef} className="card" style={{ marginTop: 14 }} open>
      <summary style={{ margin: 0 }}>Быстрая правка плана</summary>
      <p className="muted small">Проверьте план поверх оригинала. Ошибки распознавания правятся щелчком; Enter — завершить стены; Esc — отменить рисование; Shift + щелчок — выбрать несколько; Delete — удалить выбранные; Ctrl+Z — отменить. Рука (H), пробел или средняя кнопка мыши — двигать план.</p>
      <div className="toolbar" role="toolbar" aria-label="Быстрая правка">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool ${tool === t.id ? 'on' : ''}`} aria-pressed={tool === t.id} title={`${t.hint} (${t.key})`} disabled={t.id === 'add' && !img && !g.walls.length}
            onClick={() => { setTool(t.id); setDraft([]); setSel(null); setFirst(null); setMsg(null); }}>{t.label}</button>
        ))}
        <button className="tool" onClick={() => draft.length ? undoDraft() : undo()} disabled={!canUndo && !draft.length} title="Ctrl+Z">Отменить</button>
        <button className="tool" onClick={() => canRedoDraft ? redoDraft() : redo()} disabled={!canRedo && !canRedoDraft} title="Ctrl+Y">Повторить</button>
        <button className="tool" onClick={() => { const next = repairWallJunctions(g); if (next === g) setMsg('Близких разрывов в углах не найдено. Проверьте все стены и двери.'); else fix(() => next, 'Углы стен соединены. Ctrl+Z — отменить.'); }} title="Соединить близкие стыки до 120 мм, сохраняя оси стен и проёмы">Соединить углы стен</button>
        <button className="tool" onClick={() => setView(null)}>Вписать</button>
      </div>
      {(tool === 'add' || tool === 'rect' || tool === 'roomPoly') && <label className="field" style={{ maxWidth: 360 }}>Назначение новой зоны<select value={newRoomType} onChange={e => setNewRoomType(e.target.value as RoomType)}>{ROOM_TYPES.map(([t, label]) => <option key={t} value={t}>{label}</option>)}</select></label>}
      {tool === 'roomPoly' && <div className="actions"><button className="btn sm" disabled={draft.length < 2} onClick={() => finishRoom()}>Заполнить комнату (Enter)</button><button className="btn ghost sm" disabled={!draft.length} onClick={() => setDraft([])}>Отменить контур (Esc)</button><span className="hint">Углов: {draft.length}. Две точки — прямоугольник; три и больше — контур.</span></div>}
      {tool === 'wall' && <div className="fields">
        <label className="field">Тип новой стены<select value={wallKind} onChange={e => setWallKind(e.target.value as WallKind)}>{WALL_KINDS.map(([t, label]) => <option key={t} value={t}>{label}</option>)}</select></label>
        <label className="field">Толщина новой стены, мм<input type="number" min="30" value={wallT} onChange={e => setWallT(Math.max(30, Number(e.target.value) || 100))} /></label>
        <div className="actions"><button className="btn sm" disabled={draft.length < 2} onClick={() => finishWalls()}>Завершить стены (Enter)</button><button className="btn ghost sm" disabled={!draft.length} onClick={() => setDraft([])}>Отменить рисование (Esc)</button></div>
      </div>}
      {tool === 'door' && <div className="fields">
        <SizeInput label="Ширина новой двери, мм" value={doorWidth} min={300} max={6000} onCommit={setDoorWidth} />
        <label className="field">Створки новой двери<select value={doorLeaves} onChange={e => setDoorLeaves(Number(e.target.value) as 1 | 2)}><option value={1}>Одна створка</option><option value={2}>Две равные створки</option></select></label>
      </div>}
      {g.rooms.length > 0 && (g.walls.length > 0 || tool === 'wall') && <label className="check-inline"><input type="checkbox" checked={usesRoomWalls(g)} onChange={e => fix(x => ({ ...x, wallMode: e.target.checked ? 'rooms' : 'explicit' }), 'Основа стен изменена. Пересоберите варианты.')} />Использовать границы зон как основу стен</label>}
      <div className="actions" style={{ marginTop: 10 }}>
        <label className="check-inline"><input type="checkbox" checked={showRecognition} disabled={originalOnly && !!img} onChange={e => setShowRecognition(e.target.checked)} />Подсветка найденных и ручных элементов</label>
        {img && <label className="check-inline"><input type="checkbox" checked={originalOnly} onChange={e => { stopPan(); setOriginalOnly(e.target.checked); setDraft([]); setFirst(null); setSel(null); }} />Только исходный план</label>}
      </div>
      {showRecognition && !showOriginal && <RecognitionLegend geometry={g} />}
      <p className="hint">Синий пунктир — найдено программой, зелёный — проверено, оранжевый — вручную. Сравните с исходником: непомеченные детали нужно добавить.</p>
      {usesRoomWalls(g) && !g.walls.length && <p className="hint">Стены построены по границам найденных зон. Отдельные перегородки пока не выделены — проверьте и дорисуйте их.</p>}
      <div className="canvas-wrap qf-canvas">
        <PlanView ref={svgRef} g={shownGeometry} mode="editor" viewBox={vb} selectedIds={selection.map(s => s.id)} labelScale={1.8}
          underlay={img ? { url: img.url, widthMm: img.widthMm, heightMm: img.heightMm, opacity: showOriginal ? 1 : 0.65 } : null}
          onElementClick={onElement}
          svgProps={{ tabIndex: 0, onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp, onLostPointerCapture: onUp, style: { cursor: panning ? 'grabbing' : tool === 'pan' || spaceHeld || originalOnly && !!img ? 'grab' : tool === 'select' || tool === 'merge' ? 'pointer' : 'crosshair', userSelect: 'none', touchAction: 'none' } }}>
          {!showOriginal && tool === 'roomPoly' && draft.length >= 2 && <path data-room-draft="true" d={draft.length === 2 ? polyPath([{ x: draft[0].x, y: draft[0].y }, { x: draft[1].x, y: draft[0].y }, draft[1], { x: draft[0].x, y: draft[1].y }]) : polyPath(cursor ? [...draft, cursor] : draft)} fill="rgba(47,111,143,.12)" stroke="#2f6f8f" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {showRecognition && !showOriginal && <RecognitionOverlay geometry={g} />}
          {!showOriginal && tool === 'wall' && draft.length > 1 && <path data-wall-draft="true" d={'M' + draft.map(q => `${q.x} ${q.y}`).join('L')} fill="none" stroke="#d2691e" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {!showOriginal && tool === 'wall' && draft.length > 0 && cursor && <path data-wall-preview="true" d={`M${draft[draft.length - 1].x} ${draft[draft.length - 1].y}L${cursor.x} ${cursor.y}`} stroke="#d2691e" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {!showOriginal && room && <path d={polyPath(room.polygon)} fill="rgba(210,105,30,.12)" stroke="#d2691e" strokeWidth={3} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {!showOriginal && firstRoom && <path d={polyPath(firstRoom.polygon)} fill="rgba(47,111,143,.15)" stroke="#2f6f8f" strokeWidth={3} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {!showOriginal && opening && <path d={`M${opening.a.x} ${opening.a.y}L${opening.b.x} ${opening.b.y}`} stroke="#d2691e" strokeWidth={8} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {!showOriginal && tool === 'rect' && draft.length === 1 && <circle cx={draft[0].x} cy={draft[0].y} r={(vb.maxX - vb.minX) / 120} fill="none" stroke="#d2691e" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {!showOriginal && draft.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={(vb.maxX - vb.minX) / 150} fill="#d2691e" pointerEvents="none" />)}
          {!showOriginal && tool === 'select' && !spaceHeld && !panning && <GeometryHandles key={sel?.id ?? 'none'} geometry={g} selection={sel} radius={6 * mmPerPx()} onChange={fix} onError={setMsg} />}
          {!showOriginal && (tool === 'wall' || tool === 'roomPoly') && draft.length >= 3 && cursor && dist(cursor, draft[0]) < 1 && <circle data-closure-snap="true" cx={draft[0].x} cy={draft[0].y} r={10 * mmPerPx()} fill="none" stroke="#2f6f8f" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        </PlanView>
        <div className="canvas-hint">{originalOnly && img ? 'Исходный план: перетаскивайте мышью, колесо — масштаб. Выключите «Только исходный план», чтобы вернуться к правке.' : msg ?? TOOLS.find((t) => t.id === tool)!.hint}</div>
      </div>

      <BatchProperties geometry={g} selection={selection} onChange={fix} onDelete={removeSelected} />
      {sel && <><WallAngle geometry={g} selection={sel} onChange={fix} onError={setMsg} /><p className="hint">Перетаскивайте точки на углах выбранной фигуры. Shift — ортогональ; Alt — без привязки.</p></>}
      {room && (
        <div className="qf-actions">
          <div className="small"><b>{room.name}</b> — назначение:</div>
          <div className="qf-chips">
            {ROOM_TYPES.map(([t, l]) => (
              <button key={t} className={`tool ${room.type === t ? 'on' : ''}`} onClick={() => setRoom({ type: t, name: nameOf(t), typeSource: 'manual', typeBasis: undefined })}>{l}</button>
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
          <div className="fields" key={opening.id}>
            <SizeInput label="Ширина выбранного проёма, мм" value={dist(opening.a, opening.b)} min={300} max={6000} onCommit={w => setOpening((o, all) => all.map(x => x.id === o.id ? resizeOpening(o, w) : x))} />
            {opening.type === 'door' && <label className="field">Створки выбранной двери<select value={opening.leaves ?? 1} onChange={e => setOpening((o, all) => all.map(x => x.id === o.id ? { ...o, leaves: Number(e.target.value) as 1 | 2, source: 'manual', verifiedByManager: true } : x))}><option value={1}>Одна створка</option><option value={2}>Две равные створки</option></select></label>}
          </div>
          <div className="actions" style={{ marginTop: 6 }}>
            {opening.type === 'door' && <>
              {opening.leaves !== 2 && <button className="btn secondary sm" onClick={() => setOpening((o, all) => all.map(x => x.id === o.id ? { ...o, hinge: o.hinge === 'a' ? 'b' : 'a' } : x))}>Петли у другого откоса</button>}
              <button className="btn secondary sm" onClick={() => setOpening((o, all) => all.map(x => x.id === o.id ? { ...o, swing: o.swing === 1 ? -1 : 1 } : x))}>Открывание в другую сторону</button>
            </>}
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
      {wall && <div className="qf-actions">
        <div className="small"><b>Стена</b> · длина {Math.round(dist(wall.a, wall.b))} мм</div>
        <div className="fields">
          <label className="field">Тип выбранной стены<select value={wall.kind} onChange={e => setWall({ kind: e.target.value as WallKind })}>{WALL_KINDS.map(([t, label]) => <option key={t} value={t}>{label}</option>)}</select></label>
          <label className="field">Толщина выбранной стены, мм<input type="number" min="30" value={wall.thickness} onChange={e => setWall({ thickness: Math.max(30, Number(e.target.value) || 100) })} /></label>
        </div>
        <button className="btn ghost sm" onClick={() => { fix(x => ({ ...x, walls: x.walls.filter(w => w.id !== wall.id) }), 'Стена удалена.'); setSel(null); }}>Удалить стену</button>
      </div>}
      {(wall || tool === 'wall') && <p className="muted small">Тёмная стена — несущая, светлее — перегородка, штриховка — тип неизвестен. Тип задаётся вами. Стена не разделяет назначения зон: для этого используйте «Разрезать».</p>}
      {changed && (
        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => { setChanged(false); onRebuild(); }}>{busy ? 'Пересобираю…' : 'Пересобрать варианты по исправленному плану'}</button>
        </div>
      )}
    </details>
  );
}

