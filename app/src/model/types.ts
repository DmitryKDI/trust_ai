// Модель данных планировщика. Вся геометрия — в миллиметрах, ось Y направлена вниз
// (как в SVG и на листе чертежа). Три слоя не смешиваются:
//   1) PlanGeometry — подтверждённые факты плана;
//   2) Variant — варианты расстановки поверх утверждённой версии геометрии;
//   3) Concept — декоративная концепция (палитра, материалы, референсы).

export type Pt = { x: number; y: number };

export type Source = 'manual' | 'suggested';

/** Происхождение элемента разметки. */
export interface Provenance {
  source: Source;
  verifiedByManager: boolean;
  sourcePage: number | null;
}

export type WallKind = 'bearing' | 'partition' | 'unknown';

export interface Wall extends Provenance {
  id: string;
  a: Pt;
  b: Pt;
  thickness: number;
  kind: WallKind;
}

/**
 * Проём задаётся отрезком между откосами a→b и толщиной стены.
 * Для двери: петли у откоса `hinge`, полотно открывается в сторону `swing`
 * (+1 — влево от направления a→b, −1 — вправо; «влево» = нормаль (dy, −dx) при оси Y вниз).
 */
export interface Opening extends Provenance {
  id: string;
  type: 'door' | 'window';
  a: Pt;
  b: Pt;
  thickness: number;
  hinge: 'a' | 'b';
  /** Число створок; старые проекты без поля — одна створка. */
  leaves?: 1 | 2;
  swing: 1 | -1;
  isEntrance: boolean;
  /** Высота подоконника, мм; null — неизвестно. */
  sillHeight: number | null;
}

export type FixedKind = 'riser' | 'vent' | 'shaft' | 'radiator' | 'electrical' | 'column' | 'void' | 'other';

export interface FixedElement extends Provenance {
  id: string;
  kind: FixedKind;
  polygon: Pt[];
  label?: string;
}

export interface WetZone extends Provenance {
  id: string;
  polygon: Pt[];
  label?: string;
}

export type RoomType =
  | 'living' | 'kitchen' | 'kitchen-living' | 'bedroom' | 'kids' | 'bath' | 'wc'
  | 'hall' | 'corridor' | 'storage' | 'balcony' | 'other';

export interface Room extends Provenance {
  id: string;
  name: string;
  type: RoomType;
  polygon: Pt[];
  /** Источник назначения отделен от источника контура. Старые проекты: undefined = предположение. */
  typeSource?: 'manual' | 'learned';
  typeBasis?: string;
}

/** Калибровка: две точки в единицах листа (pt для PDF, px для растра) и известный размер. */
export interface Calibration {
  p1: Pt;
  p2: Pt;
  mm: number;
  mmPerUnit: number;
  /** Как получен масштаб: вручную, по размерным числам чертежа, по площади из брифа, условно. */
  method?: 'manual' | 'dimensions' | 'area' | 'typical' | 'assumed';
}

export interface PlanGeometry {
  version: number;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  calibration: Calibration | null;
  walls: Wall[];
  /** Скан: границы зон остаются основой стен при добавлении ручных перегородок. */
  wallMode?: 'rooms' | 'explicit';
  openings: Opening[];
  fixed: FixedElement[];
  wetZones: WetZone[];
  rooms: Room[];
  approved: boolean;
  approvedAt: string | null;
  /** Хэш содержимого утверждённой версии — варианты ссылаются на него. */
  approvedHash: string | null;
}

export interface SourceDocument {
  id: string;
  name: string;
  mime: string;
  size: number;
  pageCount: number;
  role: 'plan' | 'reference';
  addedAt: string;
}

export interface Brief {
  area: string;
  adults: number;
  children: number;
  childrenAges: string;
  rooms: string;
  priorities: string;
  workFromHome: boolean;
  style: string;
  budget: string;
  limits: string;
  mustHave: string;
  bans: string;
  /** Нужен ли доступ к двуспальной кровати с двух сторон. */
  bedAccessBothSides: boolean;
  diningSeats: number;
  preferShower: boolean;
}

export type ScenarioKey = 'space' | 'storage' | 'family';

export type FurnitureType =
  | 'bed-double' | 'bed-single' | 'bedside' | 'wardrobe' | 'dresser'
  | 'sofa' | 'armchair' | 'coffee-table' | 'tv-unit'
  | 'dining' | 'desk' | 'kitchen-run' | 'fridge'
  | 'bathtub' | 'shower' | 'toilet' | 'washbasin' | 'washer' | 'shoe-cabinet' | 'play-rug' | 'shelving';

export type Rot = 0 | 90 | 180 | 270;

export interface KitchenModule {
  kind: 'sink' | 'hob' | 'base' | 'dishwasher' | 'oven' | 'tall';
  w: number;
}

export interface FurnitureItem {
  id: string;
  type: FurnitureType;
  /** Центр предмета, мм. */
  x: number;
  y: number;
  rot: Rot;
  /** Ширина (вдоль спинки/фасада) и глубина, мм. */
  w: number;
  d: number;
  roomId: string | null;
  ruleId: string | null;
  movedByManager: boolean;
  modules?: KitchenModule[];
  seats?: number;
}

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  itemIds: string[];
}

export interface Variant {
  id: string;
  scenario: ScenarioKey;
  title: string;
  idea: string;
  geometryHash: string;
  items: FurnitureItem[];
  benefits: string[];
  compromises: string[];
  assumptions: string[];
  changes: string[];
  issues: Issue[];
  metrics: Record<string, number>;
  approved: boolean;
  editedByManager: boolean;
}

export interface ConceptReference {
  id: string;
  url: string;
  caption: string;
  sourceName: string;
  sourceUrl: string;
  kind: 'reference' | 'illustration';
}

export interface Concept {
  clientGoals?: string[];
  styleName: string;
  palette: { name: string; hex: string }[];
  materials: string[];
  references: ConceptReference[];
  rationale: string;
  /** Настройки процедурной 3D-сцены. Отсутствуют у старых проектов. */
  scene3d?: import('../scene/types').SceneSettings;
  materialCatalog?: import('../scene/types').MaterialCatalog;
}

export interface ReviewDecision {
  variantId: string;
  approvedBy: string;
  approvedAt: string;
  note: string;
}

export interface Project {
  id: string;
  alias: string;
  city: string;
  manager: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  brief: Brief;
  documents: SourceDocument[];
  geometry: PlanGeometry;
  variants: Variant[];
  selectedVariantId: string | null;
  review: ReviewDecision | null;
  concept: Concept;
  ruleOverrides: Record<string, number>;
  /** Заметки сравнения с эталонным решением дизайнера (внутренние). */
  referenceNotes: string;
  referencePage: number | null;
  /** Отчёт автоматического чтения плана (что найдено, как определён масштаб). */
  recognition?: import('../recognize/index').RecognizeReport;
  /** Стилизованные стены плана (сканы/картинки): маска и её размер в мм. */
  planImage?: { url: string; widthMm: number; heightMm: number };
  /** Стиль отображения плана. */
  planStyle?: PlanStyle;
}

export type PlanStyle = 'graphite' | 'warm' | 'blueprint' | 'original';
