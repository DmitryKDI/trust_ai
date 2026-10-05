import type { Brief, Concept, PlanGeometry, Project } from './types';

export const uid = (p = '') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function emptyGeometry(): PlanGeometry {
  return { version: 1, sourceDocumentId: null, sourcePage: null, calibration: null, walls: [], openings: [], fixed: [], wetZones: [], rooms: [], approved: false, approvedAt: null, approvedHash: null };
}

export function defaultBrief(): Brief {
  return {
    area: '', adults: 2, children: 1, childrenAges: '', rooms: '', priorities: '', workFromHome: false, style: 'Современный спокойный',
    budget: '', limits: 'Не переносить мокрые зоны. Сохранить несущие стены.', mustHave: '', bans: '', bedAccessBothSides: true, diningSeats: 4, preferShower: false,
  };
}

/** Изображения добавляются менеджером или сохраняются из 3D-сцены. */
export function defaultConcept(): Concept {
  return {
    styleName: 'Тёплая сдержанность',
    palette: [
      { name: 'Молочный', hex: '#eee8df' },
      { name: 'Песочный', hex: '#cbb9a7' },
      { name: 'Орех', hex: '#8d6f5b' },
      { name: 'Графит', hex: '#4a4f52' },
    ],
    materials: ['Натуральный дуб на полу', 'Матовая краска и фактурная штукатурка', 'Керамогранит под камень в мокрых зонах', 'Плотный текстиль: лён и букле'],
    references: [],
    rationale: 'Светлая база расширяет пространство, тёплое дерево и текстиль добавляют уюта, графит собирает композицию.',
  };
}

export function newProject(fields: Pick<Project, 'alias' | 'city' | 'manager' | 'date'>): Project {
  const now = new Date().toISOString();
  return {
    id: uid('p'), ...fields, createdAt: now, updatedAt: now,
    brief: defaultBrief(), documents: [], geometry: emptyGeometry(), variants: [], selectedVariantId: null, review: null,
    concept: defaultConcept(), ruleOverrides: {}, referenceNotes: '', referencePage: null,
  };
}
