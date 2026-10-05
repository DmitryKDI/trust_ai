import { MATERIAL_SLOTS, type MaterialCatalog, type SceneMaterial } from './types';

const fail = (message: string): never => { throw new Error(message); };
export const EMPTY_CATALOG: MaterialCatalog = { version: 1, materials: [] };
export function parseMaterialCatalog(text: string): MaterialCatalog {
  if (text.length > 12 * 1024 * 1024) fail('Каталог больше 12 МБ.');
  let data: any;
  try { data = JSON.parse(text); } catch { fail('Не удалось прочитать JSON каталога.'); }
  if (!data || data.version !== 1 || !Array.isArray(data.materials) || data.materials.length > 100) fail('Нужен каталог version: 1 с массивом materials (до 100 элементов).');
  const ids = new Set<string>();
  const materials = data.materials.map((m: any): SceneMaterial => {
    if (!m || typeof m.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(m.id) || ids.has(m.id)) fail('У каждого материала должен быть уникальный id: латиница, цифры, _ или -.');
    ids.add(m.id);
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 160) fail('Укажите название материала (до 160 символов).');
    if (!MATERIAL_SLOTS.includes(m.category) || typeof m.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(m.color)) fail(`Материал «${m.name}»: проверьте category и цвет #RRGGBB.`);
    if (m.textureDataUrl !== undefined && (typeof m.textureDataUrl !== 'string' || m.textureDataUrl.length > 4 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(m.textureDataUrl))) fail(`Материал «${m.name}»: текстура должна быть локальным PNG/JPEG/WebP до 3 МБ.`);
    for (const key of ['tileWidthMm', 'tileHeightMm']) if (m[key] !== undefined && (!Number.isFinite(m[key]) || m[key] < 10 || m[key] > 10000)) fail(`Материал «${m.name}»: размер текстуры от 10 до 10000 мм.`);
    if (m.price !== undefined && (!Number.isFinite(m.price) || m.price < 0)) fail(`Материал «${m.name}»: цена должна быть неотрицательным числом.`);
    const result: SceneMaterial = { id: m.id, name: m.name.trim(), category: m.category, color: m.color };
    for (const key of ['textureDataUrl', 'tileWidthMm', 'tileHeightMm', 'price'] as const) if (m[key] !== undefined) Object.assign(result, { [key]: m[key] });
    for (const key of ['article', 'unit'] as const) if (typeof m[key] === 'string') result[key] = m[key].slice(0, 160);
    return result;
  });
  return { version: 1, materials };
}
