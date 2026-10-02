// Картинки для проверки зон: оригинал слева, зоны (номер + площадь) справа.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const G = process.argv[2];
const ids = fs.readdirSync(G).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2 / 1e6; };
const cols = ['#e5484d', '#30a46c', '#3e63dd', '#f76b15', '#8e4ec6', '#12a594', '#ab6400', '#d6409f', '#0090ff', '#6e6e6e'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let n = 0;
for (const id of ids) {
  n++;
  const d = JSON.parse(fs.readFileSync(`${G}/${id}.json`));
  const W = 560, H = Math.round(W * d.h / d.w), Wm = d.w * d.k, Hm = d.h * d.k;
  const img = `data:image/${d.img.endsWith('png') ? 'png' : 'jpeg'};base64,` + fs.readFileSync(`${G}/${d.img}`).toString('base64');
  const path = (pts) => 'M' + pts.map((q) => `${q.x},${q.y}`).join('L') + 'Z';
  const fsz = Wm / W * 15;
  const zones = `<svg viewBox="0 0 ${Wm} ${Hm}" width="${W}" height="${H}"><image href="${img}" width="${Wm}" height="${Hm}" opacity="0.35" preserveAspectRatio="none"/>
${d.rooms.map((r, i) => { const xs = r.polygon.map(q=>q.x), ys = r.polygon.map(q=>q.y); const cx=(Math.min(...xs)+Math.max(...xs))/2, cy=(Math.min(...ys)+Math.max(...ys))/2; const c = cols[i % 10];
  return `<path d="${path(r.polygon)}" fill="${c}" fill-opacity="0.35" stroke="${c}" stroke-width="${fsz / 5}"/><text x="${cx}" y="${cy}" text-anchor="middle" font-size="${fsz * 1.2}" font-family="sans-serif" font-weight="700" fill="#111" stroke="#fff" stroke-width="${fsz / 4}" paint-order="stroke">${i + 1}</text><text x="${cx}" y="${cy + fsz * 1.2}" text-anchor="middle" font-size="${fsz * 0.8}" font-family="sans-serif" fill="#111" stroke="#fff" stroke-width="${fsz / 4}" paint-order="stroke">${area(r.polygon).toFixed(1)} м²</text>`; }).join('')}
</svg>`;
  const t = d.truth;
  const html = `<body style="margin:0;background:#fff;font:14px sans-serif;color:#111"><div style="padding:10px 14px 2px"><b style="font-size:20px">Пример ${n}</b> <span style="color:#555">(${id}) — найдено зон: ${d.rooms.length}</span></div>
<div style="display:flex;gap:14px;padding:8px 14px 12px"><div><div style="font-weight:700">Оригинал</div><img src="${img}" width="${W}" height="${H}"></div><div><div style="font-weight:700">Зоны (номер, площадь)</div>${zones}</div></div></body>`;
  const p = await b.newPage({ viewport: { width: 2 * W + 42, height: 300 }, deviceScaleFactor: 1.3 });
  await p.setContent(html);
  await p.screenshot({ path: `${G}/${String(n).padStart(2, '0')}-${id}.png`, fullPage: true });
  await p.close();
}
await b.close();
