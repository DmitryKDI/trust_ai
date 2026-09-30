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

/** Референсы по умолчанию — чужие фото, явно помеченные как «референс» с источником. */
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
    references: [
      { id: 'ref1', url: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=900&q=80', caption: 'Светлая общая зона', sourceName: 'Unsplash', sourceUrl: 'https://unsplash.com/photos/1600210492486-724fe5c67fb0', kind: 'reference' },
      { id: 'ref2', url: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=900&q=80', caption: 'Натуральные фактуры', sourceName: 'Unsplash', sourceUrl: 'https://unsplash.com/photos/1600607687920-4e2a09cf159d', kind: 'reference' },
      { id: 'ref3', url: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=900&q=80', caption: 'Спокойная спальня', sourceName: 'Unsplash', sourceUrl: 'https://unsplash.com/photos/1618221195710-dd6b41faaea6', kind: 'reference' },
    ],
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
