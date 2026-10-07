// Редактор разметки: подложка (исходная страница), калибровка, стены, проёмы, инженерные элементы,
// мокрые зоны, помещения. Привязка к узлам разметки и к векторам PDF; подсказки «с чертежа» — suggested.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import type { FixedKind, Opening, PlanGeometry, Pt, Room, RoomType, WallKind } from '../model/types';
import { uid } from '../model/defaults';
import { useStore } from '../state/store';
import { useSourcePage } from '../state/useSource';
import { PlanView, planBounds, polyPath } from '../plan/PlanView';
import { addPlanWall, addPlanWallChain, WALL_KINDS, calibrate, doorFromArc, isWallFill, openingFromClicks, resizeOpening, scaleOf, snapPoint, snapPolylineClosure, wallFromFill, type SnapKind } from '../editor/ops';
import { isTextInput } from '../editor/keyboard';
import { BatchProperties } from '../editor/BatchProperties';
import { GeometryHandles, WallAngle } from '../editor/GeometryHandles';
import { deleteSelection, selectElement, type ElementSelection } from '../editor/selection';
import { SizeInput } from '../editor/SizeInput';
import { SnapIndex } from '../pdf/vectors';
import { detectRoomPolygon, geometryHash, openingWidth, roomArea } from '../geometry/plan';
import { add, dist, mul, norm, sub, type BBox } from '../geometry/poly';
import { validate } from '../validate/validator';
import { LearningPanel } from '../learning/Panel';
import { ROOM_TYPES, roomName, simpleRing } from '../learning/model';

type Tool = 'select' | 'pan' | 'calibrate' | 'wall' | 'pickWall' | 'door' | 'window' | 'pickDoor' | 'riser' | 'fixed' | 'wet' | 'room' | 'roomPoly';
type Sel = { kind: 'wall' | 'opening' | 'fixed' | 'room' | 'wet'; id: string } | null;

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Выбор', key: 'V', hint: 'Щёлкните элемент, чтобы изменить или подтвердить его. Shift + щелчок — выбрать несколько; Delete — удалить выбранные.' },
  { id: 'pan', label: 'Рука', key: 'H', hint: 'Перетаскивайте план. Колесо — масштаб. Также: пробел или средняя кнопка мыши.' },
  { id: 'calibrate', label: 'Масштаб', key: 'C', hint: 'Отметьте два конца известного размера (например, размерной линии) и введите его в мм.' },
  { id: 'pickWall', label: 'Стена с чертежа', key: 'P', hint: 'Щёлкните по заливке стены на чертеже — стена ляжет точно по ней (подсказка, нужна проверка).' },
  { id: 'wall', label: 'Стена', key: 'W', hint: 'Щёлкайте углы полилинии; Enter — создать стены; Shift — горизонталь/вертикаль; число + Enter — длина сегмента; Esc — отменить.' },
  { id: 'pickDoor', label: 'Дверь с чертежа', key: 'G', hint: 'Щёлкните по дуге открывания двери на чертеже.' },
  { id: 'door', label: 'Дверь', key: 'D', hint: 'Отметьте два откоса двери. Петли и сторону открывания задайте справа.' },
  { id: 'window', label: 'Окно', key: 'O', hint: 'Отметьте два откоса окна.' },
  { id: 'riser', label: 'Стояк', key: 'S', hint: 'Щёлкните в месте стояка.' },
  { id: 'fixed', label: 'Шахта / радиатор', key: 'F', hint: 'Два клика — противоположные углы прямоугольника.' },
  { id: 'wet', label: 'Мокрая зона', key: 'Z', hint: 'Два клика — противоположные углы зоны.' },
  { id: 'room', label: 'Помещение', key: 'R', hint: 'Щёлкните внутри помещения — контур найдётся по стенам и проёмам.' },
  { id: 'roomPoly', label: 'Помещение по точкам', key: 'N', hint: 'Для открытых зон: щёлкайте углы помещения; щелчок по первой точке или Enter — замкнуть.' },
];

const FIXED_KINDS: [FixedKind, string][] = [['shaft', 'Шахта'], ['vent', 'Вентканал'], ['radiator', 'Радиатор'], ['electrical', 'Электрощиток'], ['column', 'Колонна'], ['riser', 'Стояк'], ['void', 'Полость вне площади'], ['other', 'Другое']];

export function MarkupScreen({ next }: { next: () => void }) {
  const { project, editGeometry, update, undo, redo, canUndo, canRedo, rules } = useStore();
  const g = project.geometry;
  const doc = project.documents.find((d) => d.id === g.sourceDocumentId) ?? null;
  const src = useSourcePage(doc, g.sourcePage);
  const k = scaleOf(g, doc?.mime);
  const index = useMemo(() => (src.page?.vectors ? new SnapIndex(src.page.vectors) : null), [src.page]);

  const [tool, setTool] = useState<Tool>('select');
  const [newRoomType, setNewRoomType] = useState<RoomType>('other');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<{ p: Pt; kind: SnapKind } | null>(null);
  const [selection, setSelection] = useState<ElementSelection[]>([]);
  const sel: Sel = selection.length === 1 ? selection[0] : null;
  const setSel = (value: Sel) => setSelection(value ? [value] : []);
  const [view, setView] = useState<BBox | null>(null);
  const [opacity, setOpacity] = useState(0.8);
  const [showUnderlay, setShowUnderlay] = useState(true);
  const [ortho, setOrtho] = useState(true);
  const [vecSnap, setVecSnap] = useState(true);
  const [wallT, setWallT] = useState(150);
  const [wallKind, setWallKind] = useState<WallKind>('unknown');
  const [doorLeaves, setDoorLeaves] = useState<1 | 2>(1);
  const [fixedKind, setFixedKind] = useState<FixedKind>('shaft');
  const [lenInput, setLenInput] = useState('');
  const [calMm, setCalMm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pan = useRef<{ x: number; y: number; vb: BBox } | null>(null);
  const spaceDown = useRef(false);
  const lastPointer = useRef<Pt | null>(null);

  const underlay = src.page && showUnderlay ? { url: src.page.imageUrl, widthMm: src.page.width * k, heightMm: src.page.height * k, opacity } : null;

  // Начальный вид: вся страница или разметка.
  useEffect(() => {
    if (view) return;
    if (g.walls.length) setView(planBounds(g, 1500));
    else if (src.page) setView({ minX: 0, minY: 0, maxX: src.page.width * k, maxY: src.page.height * k });
  }, [src.page, g.walls.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const vb = view ?? { minX: 0, minY: 0, maxX: 20000, maxY: 14000 };

  const toWorld = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM()!.inverse();
    const r = pt.matrixTransform(m);
    return { x: r.x, y: r.y };
  }, []);
  const mmPerPx = () => {
    const svg = svgRef.current;
    if (!svg) return 20;
    const r = svg.getBoundingClientRect();
    return Math.max((vb.maxX - vb.minX) / r.width, (vb.maxY - vb.minY) / r.height);
  };

  const snap = (raw: Pt, shift: boolean) => {
    const closed = (tool === 'wall' || tool === 'roomPoly') ? snapPolylineClosure(raw, draft, 12 * mmPerPx()) : null;
    if (closed) return { p: closed, kind: 'closure' as const };
    const anchor = draft.length ? draft[draft.length - 1] : null;
    const linear = ['wall', 'door', 'window', 'calibrate', 'roomPoly'].includes(tool);
    return snapPoint(raw, { g, k, index, radiusMm: 12 * mmPerPx(), anchor, ortho: ortho && linear, forceOrtho: shift && linear, vectors: vecSnap });
  };

  const page = g.sourcePage;
  const setG = (fn: (g: PlanGeometry) => PlanGeometry) => editGeometry(fn);

  const finishWalls = (points = draft) => {
    if (points.length < 2) return;
    setG(x => addPlanWallChain(x, points, { thickness: wallT, kind: wallKind }));
    setDraft([]); setLenInput(''); setCursor(null); setSel(null); setTool('select');
    setMsg('Стены добавлены. Ctrl+Z — отменить всю полилинию.');
  };
  const rectPoly = (a: Pt, b: Pt): Pt[] => [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];

  const onDown = (e: RPE<SVGSVGElement>) => {
    if (e.button === 1 || tool === 'pan' || spaceDown.current) {
      pan.current = { x: e.clientX, y: e.clientY, vb };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const raw = toWorld(e);
    const s = snap(raw, e.shiftKey).p;
    setMsg(null);
    switch (tool) {
      case 'calibrate':
        setDraft((d) => (d.length >= 2 ? [s] : [...d, s]));
        break;
      case 'wall':
        if (snapPolylineClosure(raw, draft, 12 * mmPerPx())) { finishWalls([...draft, draft[0]]); break; }
        if (draft.length && dist(draft[draft.length - 1], s) < 50) return;
        setDraft((d) => [...d, { x: Math.round(s.x), y: Math.round(s.y) }]);
        setLenInput('');
        break;
      case 'door':
      case 'window':
        if (draft.length === 1) {
          const o = openingFromClicks(g, draft[0], s, tool, page);
          setG((x) => ({ ...x, openings: [...x.openings, { ...o, ...(tool === 'door' ? { leaves: doorLeaves } : {}), verifiedByManager: true }] }));
          setSel({ kind: 'opening', id: o.id });
          setDraft([]);
        } else setDraft([s]);
        break;
      case 'pickWall': {
        const f = index?.fillAt(mul(raw, 1 / k), isWallFill);
        if (!f) { setMsg('Под курсором нет заливки стены. Нарисуйте стену инструментом «Стена».'); break; }
        const w = wallFromFill(f, k, page, g);
        if (g.walls.some((x) => dist(x.a, w.a) < 5 && dist(x.b, w.b) < 5)) { setMsg('Эта стена уже добавлена.'); break; }
        setG(x => addPlanWall(x, w));
        setSel({ kind: 'wall', id: w.id });
        break;
      }
      case 'pickDoor': {
        const arc = index?.arcNear(mul(raw, 1 / k), 15 * mmPerPx() / k);
        if (!arc) { setMsg('Рядом нет дуги двери. Отметьте дверь инструментом «Дверь».'); break; }
        const d = doorFromArc(g, arc, k, page);
        if (!d) break;
        setG((x) => ({ ...x, openings: [...x.openings, d] }));
        setSel({ kind: 'opening', id: d.id });
        break;
      }
      case 'riser': {
        const r = 80;
        const poly = Array.from({ length: 8 }, (_, i) => ({ x: Math.round(s.x + r * Math.cos((i * Math.PI) / 4)), y: Math.round(s.y + r * Math.sin((i * Math.PI) / 4)) }));
        const f = { id: uid('f'), kind: 'riser' as const, polygon: poly, label: 'Стояк', source: 'manual' as const, verifiedByManager: true, sourcePage: page };
        setG((x) => ({ ...x, fixed: [...x.fixed, f] }));
        break;
      }
      case 'fixed':
      case 'wet':
        if (draft.length === 1) {
          const poly = rectPoly(draft[0], s).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }));
          if (tool === 'fixed') setG((x) => ({ ...x, fixed: [...x.fixed, { id: uid('f'), kind: fixedKind, polygon: poly, label: FIXED_KINDS.find((f) => f[0] === fixedKind)?.[1], source: 'manual', verifiedByManager: true, sourcePage: page }] }));
          else setG((x) => ({ ...x, wetZones: [...x.wetZones, { id: uid('z'), polygon: poly, label: 'Мокрая зона', source: 'manual', verifiedByManager: true, sourcePage: page }] }));
          setDraft([]);
        } else setDraft([s]);
        break;
      case 'room': {
        const poly = detectRoomPolygon(g, raw);
        if (!poly) { setMsg('Контур не найден: точка вне квартиры или помещение не замкнуто стенами и проёмами.'); break; }
        if (g.rooms.some((r) => Math.abs(roomArea(r.polygon) - roomArea(poly)) < 1e4 && dist(r.polygon[0], poly[0]) < 10)) { setMsg('Это помещение уже отмечено.'); break; }
        const room: Room = { id: uid('r'), name: roomName(newRoomType), type: newRoomType, typeSource: 'manual', polygon: poly, source: 'manual', verifiedByManager: true, sourcePage: page };
        setG((x) => ({ ...x, rooms: [...x.rooms, room] }));
        setSel({ kind: 'room', id: room.id });
        break;
      }
      case 'roomPoly': {
        if (draft.length >= 3 && dist(s, draft[0]) < 12 * mmPerPx()) { finishRoomPoly(draft); break; }
        setDraft((d) => [...d, { x: Math.round(s.x), y: Math.round(s.y) }]);
        break;
      }
      default:
        break;
    }
  };

  function finishRoomPoly(pts: Pt[]) {
    if (pts.length < 3) return;
    if (!simpleRing(pts)) { setMsg('Контур пересекает сам себя или имеет нулевую площадь. Исправьте точки или отмените построение.'); return; }
    const room: Room = { id: uid('r'), name: roomName(newRoomType), type: newRoomType, typeSource: 'manual', polygon: pts, source: 'manual', verifiedByManager: true, sourcePage: page };
    setG((x) => ({ ...x, rooms: [...x.rooms, room] }));
    setSel({ kind: 'room', id: room.id });
    setDraft([]);
  }

  const onMove = (e: RPE<SVGSVGElement>) => {
    if (pan.current) {
      const svg = svgRef.current!;
      const r = svg.getBoundingClientRect();
      const s = Math.max((pan.current.vb.maxX - pan.current.vb.minX) / r.width, (pan.current.vb.maxY - pan.current.vb.minY) / r.height);
      const dx = (e.clientX - pan.current.x) * s, dy = (e.clientY - pan.current.y) * s;
      const v = pan.current.vb;
      setView({ minX: v.minX - dx, maxX: v.maxX - dx, minY: v.minY - dy, maxY: v.maxY - dy });
      return;
    }
    lastPointer.current = toWorld(e);
    setCursor(snap(lastPointer.current, e.shiftKey));
  };
  const onUp = () => { pan.current = null; };

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const p = toWorld(e);
    const f = Math.exp(e.deltaY * 0.0015);
    setView((v) => {
      const cur = v ?? vb;
      return { minX: p.x + (cur.minX - p.x) * f, maxX: p.x + (cur.maxX - p.x) * f, minY: p.y + (cur.minY - p.y) * f, maxY: p.y + (cur.maxY - p.y) * f };
    });
  }, [toWorld, vb]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const removeSelected = useCallback(() => {
    if (!selection.length) return;
    editGeometry(x => deleteSelection(x, selection)); setSel(null);
  }, [selection, editGeometry]);

  // Клавиатура.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const typing = isTextInput(e.target);
      if (typing || e.defaultPrevented) return;
      if (e.key === ' ' && !typing) { spaceDown.current = true; e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (!e.shiftKey && draft.length) setDraft(d => d.slice(0, -1)); else if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === 'Shift' && lastPointer.current) setCursor(snap(lastPointer.current, true));
      if (e.key === 'Escape') { e.preventDefault(); setDraft([]); setLenInput(''); setSel(null); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) { e.preventDefault(); removeSelected(); return; }
      if (tool === 'roomPoly' && e.key === 'Enter' && draft.length >= 3) { finishRoomPoly(draft); return; }
      if (tool === 'wall' && draft.length && /^[0-9]$/.test(e.key)) { setLenInput((s) => s + e.key); return; }
      if (tool === 'wall' && e.key === 'Enter' && lenInput && draft.length && cursor) {
        const a = draft[draft.length - 1];
        const d = norm(sub(cursor.p, a));
        const b = add(a, mul(d, Number(lenInput)));
        e.preventDefault();
        if (dist(a, b) < 50) return;
        setDraft((dr) => [...dr, { x: Math.round(b.x), y: Math.round(b.y) }]);
        setLenInput('');
        return;
      }
      if (tool === 'wall' && e.key === 'Enter') { e.preventDefault(); finishWalls(); return; }
      const tl = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (tl && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setTool(tl.id); setDraft([]); setSel(null); setLenInput(''); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') spaceDown.current = false; if (e.key === 'Shift' && lastPointer.current) setCursor(snap(lastPointer.current, false)); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  const applyCalibration = () => {
    const mm = Number(calMm.replace(',', '.'));
    if (draft.length !== 2 || !(mm > 0)) return;
    editGeometry((x) => calibrate(x, draft[0], draft[1], mm, k));
    const f = (mm / dist(draft[0], draft[1]));
    setView((v) => (v ? { minX: v.minX * f, minY: v.minY * f, maxX: v.maxX * f, maxY: v.maxY * f } : v));
    setDraft([]);
    setCalMm('');
    setTool('select');
  };

  // Проверки перед утверждением.
  const checks = useMemo(() => {
    const v = g.rooms.length ? validate({ ...g, approved: true }, [], rules, project.brief) : null;
    const unverified = [...g.walls, ...g.openings, ...g.fixed, ...g.rooms, ...g.wetZones].filter((x) => !x.verifiedByManager).length;
    const list: { ok: boolean; text: string }[] = [
      { ok: !!g.calibration, text: g.calibration ? `Масштаб: ${g.calibration.mm} мм по двум точкам` : 'Масштаб не откалиброван — размеры неточные' },
      { ok: g.walls.length > 0 || g.rooms.length > 0, text: g.walls.length ? `Стены: ${g.walls.length}` : 'Стены — по изображению плана' },
      { ok: g.openings.some((o) => o.isEntrance), text: g.openings.some((o) => o.isEntrance) ? 'Входная дверь отмечена' : 'Отметьте входную дверь (выберите дверь → «Входная»)' },
      { ok: g.rooms.length > 0, text: `Помещения: ${g.rooms.length}${g.rooms.some((r) => r.type === 'other') ? ' (есть без типа)' : ''}` },
      { ok: !!v && v.unreachableRooms.length === 0, text: v ? (v.unreachableRooms.length ? `Недостижимы от входа: ${v.unreachableRooms.map((id) => g.rooms.find((r) => r.id === id)?.name).join(', ')}` : 'Все помещения достижимы от входа') : 'Проходимость — после разметки помещений' },
      { ok: true, text: g.fixed.some((f) => f.kind === 'riser') ? `Стояки: ${g.fixed.filter((f) => f.kind === 'riser').length}` : 'Стояки не отмечены — будет помечено как неизвестное' },
    ];
    return { list, unverified, blocking: list.slice(0, 5).some((c) => !c.ok) };
  }, [g, rules, project.brief]);

  const approve = () => {
    if (checks.unverified && !confirm(`Не подтверждено элементов: ${checks.unverified} (подсказки с чертежа). Утвердить геометрию — значит подтвердить их все. Продолжить?`)) return;
    update((p) => {
      const mark = <T extends { verifiedByManager: boolean }>(a: T[]) => a.map((x) => ({ ...x, verifiedByManager: true }));
      const geometry: PlanGeometry = { ...p.geometry, walls: mark(p.geometry.walls), openings: mark(p.geometry.openings), fixed: mark(p.geometry.fixed), rooms: mark(p.geometry.rooms), wetZones: mark(p.geometry.wetZones) };
      return { ...p, geometry: { ...geometry, approved: true, approvedAt: new Date().toISOString(), approvedHash: geometryHash(geometry) } };
    });
  };

  const importMarkup = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const gm: PlanGeometry = data.format === 'trust-planner-project' ? data.project.geometry : data;
      if (!Array.isArray(gm.walls) || !Array.isArray(gm.rooms)) throw new Error('В файле нет разметки');
      editGeometry((x) => ({ ...gm, sourceDocumentId: x.sourceDocumentId, sourcePage: x.sourcePage, approved: false, approvedAt: null, approvedHash: null }));
      setView(null);
      setMsg(`Разметка загружена: стен ${gm.walls.length}, проёмов ${gm.openings.length}, помещений ${gm.rooms.length}. Проверьте её поверх оригинала.`);
    } catch (e) {
      setMsg(`Не удалось прочитать разметку: ${(e as Error).message}`);
    }
  };
  const exportMarkup = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(g, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${project.alias || 'plan'}.markup.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const hint = TOOLS.find((x) => x.id === tool)!.hint;
  const drawAnchor = draft.length ? draft[draft.length - 1] : null;

  return (
    <div className="view">
      <div className="eyebrow">Шаг 4 · разметка</div>
      <h1 className="heading">Разметка плана</h1>
      <p className="lead">Оригинал — подложкой. Откалибруйте масштаб, обведите стены и проёмы, отметьте стояки и помещения. Всё, что взято с чертежа автоматически, помечено пунктиром до вашего подтверждения.</p>
      {!doc && <div className="notice err">Сначала загрузите план на шаге «Загрузка» и выберите страницу.</div>}
      {src.error && <div className="notice err">{src.error}</div>}
      {!g.calibration && doc && <div className="notice">Масштаб не откалиброван: сейчас принят условный масштаб 1:50 для PDF. Инструмент «Масштаб» → два конца размерной линии → размер в мм.</div>}
      {(tool === 'room' || tool === 'roomPoly') && <label className="field" style={{ maxWidth: 360 }}>Назначение новой зоны<select value={newRoomType} onChange={e => setNewRoomType(e.target.value as RoomType)}>{ROOM_TYPES.map(([t, label]) => <option key={t} value={t}>{label}</option>)}</select></label>}
      <LearningPanel />

      <div className="toolbar" role="toolbar" aria-label="Инструменты разметки">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool ${tool === t.id ? 'on' : ''} ${t.id.startsWith('pick') ? 'alt' : ''}`} onClick={() => { setTool(t.id); setDraft([]); setSel(null); setLenInput(''); }} title={`${t.hint} (${t.key})`} disabled={t.id.startsWith('pick') && !index}>
            {t.label}
          </button>
        ))}
        <button className="tool" onClick={undo} disabled={!canUndo} title="Ctrl+Z">Отменить</button>
        <button className="tool" onClick={redo} disabled={!canRedo} title="Ctrl+Y">Повторить</button>
        <button className="tool" onClick={() => setView(g.walls.length ? planBounds(g, 1500) : src.page ? { minX: 0, minY: 0, maxX: src.page.width * k, maxY: src.page.height * k } : null)}>Вписать</button>
      </div>

      <div className="editor">
        <div>
          <div className="canvas-wrap">
            <PlanView ref={svgRef} g={g} mode="editor" underlay={underlay} viewBox={vb} selectedIds={selection.map(s => s.id)}
              onElementClick={(kind, id, event) => { if (tool === 'select') setSelection(current => selectElement(current, { kind, id }, event.shiftKey)); }}
              svgProps={{ tabIndex: 0, onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerLeave: () => setCursor(null), style: { cursor: tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' } }}>
              {tool === 'calibrate' && draft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={6 * mmPerPx()} fill="#d2691e" />)}
              {tool === 'calibrate' && draft.length === 2 && <path d={`M${draft[0].x} ${draft[0].y}L${draft[1].x} ${draft[1].y}`} stroke="#d2691e" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
              {drawAnchor && cursor && tool !== 'calibrate' && (
                (tool === 'fixed' || tool === 'wet')
                  ? <path d={polyPath([drawAnchor, { x: cursor.p.x, y: drawAnchor.y }, cursor.p, { x: drawAnchor.x, y: cursor.p.y }])} fill="rgba(210,105,30,.12)" stroke="#d2691e" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="5 4" />
                  : <path d={`M${drawAnchor.x} ${drawAnchor.y}L${cursor.p.x} ${cursor.p.y}`} stroke="#d2691e" strokeWidth={tool === 'wall' ? 3 : 2} vectorEffect="non-scaling-stroke" strokeDasharray={tool === 'wall' ? undefined : '6 4'} />
              )}
              {tool === 'wall' && draft.length > 1 && <path data-wall-draft="true" d={'M' + draft.map(q => `${q.x} ${q.y}`).join('L')} fill="none" stroke="#d2691e" strokeWidth={3} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
              {tool === 'roomPoly' && draft.length > 0 && <path d={'M' + draft.map((q) => `${q.x} ${q.y}`).join('L')} fill="rgba(210,105,30,.08)" stroke="#d2691e" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
              {draft.length > 0 && (tool === 'wall' || tool === 'roomPoly') && draft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4 * mmPerPx()} fill="#d2691e" />)}
              {cursor && tool !== 'select' && tool !== 'pan' && (
                <g pointerEvents="none">
                  <circle cx={cursor.p.x} cy={cursor.p.y} r={7 * mmPerPx()} fill="none" stroke={cursor.kind === 'none' ? '#999' : cursor.kind === 'geometry' ? '#2f6f8f' : '#d2691e'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  {cursor.kind !== 'none' && <circle cx={cursor.p.x} cy={cursor.p.y} r={2 * mmPerPx()} fill="#d2691e" />}
                </g>
              )}
              {tool === 'select' && <GeometryHandles key={sel?.id ?? 'none'} geometry={g} selection={sel} radius={6 * mmPerPx()} onChange={setG} onError={setMsg} />}
              {cursor?.kind === 'closure' && draft.length >= 3 && <circle data-closure-snap="true" cx={draft[0].x} cy={draft[0].y} r={10 * mmPerPx()} fill="none" stroke="#2f6f8f" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
            </PlanView>
            <div className="canvas-hint">{msg ?? hint}</div>
            <div className="canvas-hud">
              {cursor ? `x ${Math.round(cursor.p.x)} · y ${Math.round(cursor.p.y)} мм` : 'Наведите курсор на план'}
              {cursor && cursor.kind !== 'none' && ` · привязка: ${({ geometry: 'узел разметки', 'vector-point': 'точка чертежа', 'vector-line': 'линия чертежа', ortho: 'ортогональ', closure: 'замыкание', none: '' } as Record<SnapKind, string>)[cursor.kind]}`}
              {drawAnchor && cursor && ` · длина ${Math.round(dist(drawAnchor, cursor.p))} мм`}
              {lenInput && ` · ввод длины: ${lenInput} мм (Enter)`}
            </div>
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <label className="check-inline"><input type="checkbox" checked={showUnderlay} onChange={(e) => setShowUnderlay(e.target.checked)} />Оригинал</label>
            <label className="check-inline">Прозрачность<input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} style={{ width: 110 }} /></label>
            <label className="check-inline"><input type="checkbox" checked={ortho} onChange={(e) => setOrtho(e.target.checked)} />Ортогональ</label>
            <label className="check-inline"><input type="checkbox" checked={vecSnap} onChange={(e) => setVecSnap(e.target.checked)} disabled={!index} />Привязка к чертежу{!index && src.page ? ' (нет векторов — скан)' : ''}</label>
          </div>
        </div>

        <aside className="panel">
          {tool === 'calibrate' && (
            <div className="card">
              <h3>Калибровка масштаба</h3>
              <p className="muted small">{draft.length < 2 ? `Отметьте ${draft.length ? 'вторую' : 'первую'} точку известного размера.` : `Отрезок на листе: ${(dist(draft[0], draft[1]) / k).toFixed(2)} ед.`}</p>
              <label className="field">Реальный размер, мм<input inputMode="numeric" value={calMm} onChange={(e) => setCalMm(e.target.value)} disabled={draft.length < 2} onKeyDown={(e) => e.key === 'Enter' && applyCalibration()} /></label>
              <div className="actions"><button className="btn sm" disabled={draft.length < 2 || !calMm} onClick={applyCalibration}>Применить</button></div>
              {g.walls.length > 0 && <p className="muted small">Уже нарисованная разметка пересчитается в новый масштаб.</p>}
            </div>
          )}
          {tool === 'wall' && (
            <div className="card">
              <h3>Новая стена</h3>
              <div className="actions"><button className="btn sm" disabled={draft.length < 2} onClick={() => finishWalls()}>Завершить стены (Enter)</button><button className="btn ghost sm" disabled={!draft.length} onClick={() => { setDraft([]); setLenInput(''); }}>Отменить рисование (Esc)</button></div>
              <div className="fields">
                <label className="field">Толщина, мм<input type="number" value={wallT} onChange={(e) => setWallT(Math.max(30, Number(e.target.value) || 150))} /></label>
                <label className="field">Тип<select value={wallKind} onChange={(e) => setWallKind(e.target.value as WallKind)}>{WALL_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              </div>
            </div>
          )}
          {tool === 'fixed' && (
            <div className="card"><h3>Инженерный элемент</h3><select value={fixedKind} onChange={(e) => setFixedKind(e.target.value as FixedKind)}>{FIXED_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          )}
          {tool === 'door' && <div className="card"><h3>Новая дверь</h3><label className="field">Створки новой двери<select value={doorLeaves} onChange={e => setDoorLeaves(Number(e.target.value) as 1 | 2)}><option value={1}>Одна створка</option><option value={2}>Две равные створки</option></select></label><p className="hint">Ширина — расстояние между двумя отмеченными откосами. После добавления её можно задать числом.</p></div>}
          <BatchProperties geometry={g} selection={selection} onChange={setG} onDelete={removeSelected} />
          {sel && <div className="card"><WallAngle geometry={g} selection={sel} onChange={setG} onError={setMsg} /><p className="hint">Перетаскивайте точки на углах выбранной фигуры. Shift — ортогональ; Alt — без привязки.</p></div>}
          {sel && <Properties sel={sel} onDelete={removeSelected} />}
          <div className="card">
            <h3>Проверка разметки</h3>
            <ul className="list" style={{ listStyle: 'none', paddingLeft: 0 }}>
              {checks.list.map((c, i) => <li key={i} style={{ color: c.ok ? 'var(--ok)' : 'var(--warn)' }}>{c.ok ? '✓' : '!'} {c.text}</li>)}
              <li className="muted">Не подтверждено: {checks.unverified}</li>
            </ul>
            <div className="actions">
              <button className="btn" disabled={checks.blocking} onClick={approve}>{g.approved ? 'Утверждено' : 'Утвердить геометрию'}</button>
              <button className="btn secondary" disabled={!g.approved} onClick={next}>К вариантам</button>
            </div>
            {g.approved && <div className="notice ok">Утверждено {new Date(g.approvedAt!).toLocaleString('ru-RU')}. Любая правка снимет утверждение.</div>}
          </div>
          <div className="card">
            <h3>Файл разметки</h3>
            <p className="muted small">Перенос разметки между проектами или восстановление из резервной копии.</p>
            <div className="actions" style={{ marginTop: 8 }}>
              <label className="btn secondary sm" style={{ display: 'inline-flex', alignItems: 'center' }}>Загрузить JSON<input type="file" accept=".json" hidden onChange={(e) => importMarkup(e.target.files?.[0])} /></label>
              <button className="btn ghost sm" onClick={exportMarkup}>Сохранить JSON</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Properties({ sel, onDelete }: { sel: NonNullable<Sel>; onDelete: () => void }) {
  const { project, editGeometry } = useStore();
  const g = project.geometry;
  const verify = (v: boolean) => (
    <label className="check-inline"><input type="checkbox" checked={v} onChange={(e) => patch({ verifiedByManager: e.target.checked })} />Проверено менеджером</label>
  );
  const key = ({ wall: 'walls', opening: 'openings', fixed: 'fixed', room: 'rooms', wet: 'wetZones' } as const)[sel.kind];
  const item = (g[key] as { id: string }[]).find((x) => x.id === sel.id) as never;
  function patch(p: Record<string, unknown>) {
    editGeometry((x) => ({ ...x, [key]: (x[key] as { id: string }[]).map((i) => (i.id === sel.id ? { ...i, ...p } : i)) }));
  }
  if (!item) return null;
  const src = (x: { source: string; sourcePage: number | null }) => <p className="muted small">Источник: {x.source === 'suggested' ? 'подсказка с чертежа' : 'вручную'}{x.sourcePage ? `, стр. ${x.sourcePage}` : ''}</p>;

  if (sel.kind === 'wall') {
    const w = item as PlanGeometry['walls'][number];
    return (
      <div className="card"><h3>Стена</h3>{src(w)}
        <dl className="kv"><dt>Длина</dt><dd>{Math.round(dist(w.a, w.b))} мм</dd></dl>
        <div className="fields" style={{ marginTop: 8 }}>
          <label className="field">Толщина, мм<input type="number" value={Math.round(w.thickness)} onChange={(e) => patch({ thickness: Math.max(30, Number(e.target.value) || w.thickness) })} /></label>
          <label className="field">Тип<select value={w.kind} onChange={(e) => patch({ kind: e.target.value })}>{WALL_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        {verify(w.verifiedByManager)}
        <div className="actions"><button className="btn ghost sm" onClick={onDelete}>Удалить</button></div>
      </div>
    );
  }
  if (sel.kind === 'opening') {
    const o = item as Opening;
    return (
      <div className="card" key={o.id}><h3>{o.type === 'door' ? 'Дверь' : 'Окно'}</h3>{src(o)}
        <div className="fields">
          <SizeInput label="Ширина проёма, мм" value={openingWidth(o)} min={300} max={6000} onCommit={w => patch(resizeOpening(o, w) as unknown as Record<string, unknown>)} />
          {o.type === 'door' && <label className="field">Створки двери<select value={o.leaves ?? 1} onChange={e => patch({ leaves: Number(e.target.value), source: 'manual', verifiedByManager: true })}><option value={1}>Одна створка</option><option value={2}>Две равные створки</option></select></label>}
          <label className="field">Толщина стены<input type="number" value={Math.round(o.thickness)} onChange={(e) => patch({ thickness: Math.max(30, Number(e.target.value) || o.thickness) })} /></label>
          {o.type === 'window' && <label className="field">Подоконник, мм<input type="number" value={o.sillHeight ?? ''} placeholder="неизвестно" onChange={(e) => patch({ sillHeight: e.target.value === '' ? null : Number(e.target.value) })} /></label>}
        </div>
        {o.type === 'door' && (
          <div className="actions" style={{ marginTop: 8 }}>
            {o.leaves !== 2 && <button className="btn secondary sm" onClick={() => patch({ hinge: o.hinge === 'a' ? 'b' : 'a' })}>Петли у другого откоса</button>}
            <button className="btn secondary sm" onClick={() => patch({ swing: -o.swing })}>Открывание в другую сторону</button>
            <label className="check-inline"><input type="checkbox" checked={o.isEntrance} onChange={(e) => editGeometry((x) => ({ ...x, openings: x.openings.map((i) => ({ ...i, isEntrance: i.id === o.id ? e.target.checked : e.target.checked ? false : i.isEntrance })) }))} />Входная дверь</label>
          </div>
        )}
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="btn ghost sm" onClick={() => patch({ type: o.type === 'door' ? 'window' : 'door', isEntrance: false })}>Сделать {o.type === 'door' ? 'окном' : 'дверью'}</button>
        </div>
        {verify(o.verifiedByManager)}
        <div className="actions"><button className="btn ghost sm" onClick={onDelete}>Удалить</button></div>
      </div>
    );
  }
  if (sel.kind === 'room') {
    const r = item as Room;
    return (
      <div className="card"><h3>Помещение</h3>{src(r)}
        <dl className="kv"><dt>Площадь</dt><dd>{(roomArea(r.polygon) / 1e6).toFixed(2).replace('.', ',')} м²</dd></dl>
        <div className="fields" style={{ marginTop: 8 }}>
          <label className="field">Название<input value={r.name} onChange={(e) => patch({ name: e.target.value })} /></label>
          <label className="field">Назначение<select value={r.type} onChange={(e) => { const t = e.target.value as RoomType; patch({ type: t, name: roomName(t), typeSource: 'manual', typeBasis: undefined, verifiedByManager: true }); }}>{ROOM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <span className="hint">{r.typeSource === 'manual' ? 'Назначение выбрано вами' : r.typeBasis ?? 'Автоматическое предположение'}</span>
          {r.typeSource !== 'manual' && r.type !== 'other' && <button className="btn ghost sm" onClick={() => patch({ typeSource: 'manual', typeBasis: undefined, verifiedByManager: true })}>Подтвердить назначение</button>}
        </div>
        {verify(r.verifiedByManager)}
        <div className="actions"><button className="btn ghost sm" onClick={onDelete}>Удалить</button></div>
      </div>
    );
  }
  const f = item as PlanGeometry['fixed'][number];
  return (
    <div className="card"><h3>{sel.kind === 'wet' ? 'Мокрая зона' : 'Инженерный элемент'}</h3>{src(f)}
      {sel.kind === 'fixed' && <label className="field">Вид<select value={f.kind} onChange={(e) => patch({ kind: e.target.value })}>{FIXED_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
      {verify(f.verifiedByManager)}
      <div className="actions"><button className="btn ghost sm" onClick={onDelete}>Удалить</button></div>
    </div>
  );
}

