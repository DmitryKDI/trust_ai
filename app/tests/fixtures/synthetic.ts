// Синтетические квартиры для тестов (не клиентские данные).
import type { Brief, Opening, PlanGeometry, Pt, Room, Wall } from '../../src/model/types';

const prov = { source: 'manual' as const, verifiedByManager: true, sourcePage: 1 };
let n = 0;
const id = (p: string) => `${p}${++n}`;

export const wall = (a: Pt, b: Pt, thickness: number, kind: Wall['kind'] = 'unknown'): Wall => ({ id: id('w'), a, b, thickness, kind, ...prov });
export const door = (a: Pt, b: Pt, thickness: number, hinge: 'a' | 'b', swing: 1 | -1, isEntrance = false): Opening => ({ id: id('d'), type: 'door', a, b, thickness, hinge, swing, isEntrance, sillHeight: null, ...prov });
export const win = (a: Pt, b: Pt, thickness: number): Opening => ({ id: id('o'), type: 'window', a, b, thickness, hinge: 'a', swing: 1, isEntrance: false, sillHeight: 800, ...prov });
export const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
export const room = (name: string, type: Room['type'], polygon: Pt[]): Room => ({ id: id('r'), name, type, polygon, ...prov });

/**
 * Двухкомнатная «коробка» 10×7 м (оси наружных стен), стены 300 мм, перегородки 100 мм.
 * Слева — кухня-гостиная, справа сверху — спальня, справа снизу — прихожая с входом.
 */
export function twoRoom(): PlanGeometry {
  const walls = [
    wall({ x: 0, y: 0 }, { x: 10000, y: 0 }, 300, 'bearing'),
    wall({ x: 10000, y: 0 }, { x: 10000, y: 7000 }, 300, 'bearing'),
    wall({ x: 10000, y: 7000 }, { x: 0, y: 7000 }, 300, 'bearing'),
    wall({ x: 0, y: 7000 }, { x: 0, y: 0 }, 300, 'bearing'),
    wall({ x: 5000, y: 150 }, { x: 5000, y: 6850 }, 100, 'partition'),
    wall({ x: 5050, y: 3500 }, { x: 9850, y: 3500 }, 100, 'partition'),
  ];
  const openings = [
    // Вход снизу в прихожую, открывание наружу (вниз = вправо от направления a→b слева направо).
    door({ x: 8000, y: 7000 }, { x: 8900, y: 7000 }, 300, 'b', -1, true),
    // Прихожая → спальня (стена y=3500), открывание в спальню (вверх = влево от a→b).
    door({ x: 5300, y: 3500 }, { x: 6100, y: 3500 }, 100, 'a', 1),
    // Прихожая → кухня-гостиная (стена x=5000, a→b вниз, левая нормаль = +x), открывание в гостиную (−x).
    door({ x: 5000, y: 5000 }, { x: 5000, y: 5800 }, 100, 'b', -1),
    win({ x: 6500, y: 0 }, { x: 8000, y: 0 }, 300),
    win({ x: 1500, y: 0 }, { x: 3500, y: 0 }, 300),
  ];
  const rooms = [
    room('Кухня-гостиная', 'kitchen-living', rect(150, 150, 4950, 6850)),
    room('Спальня', 'bedroom', rect(5050, 150, 9850, 3450)),
    room('Прихожая', 'hall', rect(5050, 3550, 9850, 6850)),
  ];
  return {
    version: 1, sourceDocumentId: null, sourcePage: 1,
    calibration: { p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, mm: 1000, mmPerUnit: 1 },
    walls, openings, rooms,
    fixed: [{ id: 'riser1', kind: 'riser', polygon: rect(160, 6640, 360, 6840), ...prov }],
    wetZones: [],
    approved: true, approvedAt: null, approvedHash: null,
  };
}

export const brief: Brief = {
  area: '65', adults: 2, children: 0, childrenAges: '', rooms: '', priorities: '', workFromHome: true, style: '', budget: '', limits: '',
  mustHave: '', bans: '', bedAccessBothSides: true, diningSeats: 4, preferShower: false,
};
