const path = require('node:path');
const ORIGIN = 'trust://planner';
const MAIN_URL = `${ORIGIN}/`;
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' blob: data:; worker-src 'self' blob:; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'self'";

function isAppUrl(value) {
  try { const u = new URL(value); return u.protocol === 'trust:' && u.hostname === 'planner' && !u.port && !u.username && !u.password; }
  catch { return false; }
}
function assetPath(root, value) {
  if (!isAppUrl(value)) return null;
  try {
    const decoded = decodeURIComponent(new URL(value).pathname);
    if (/[\\\0:]/.test(decoded) || decoded.split('/').includes('..')) return null;
    const target = path.resolve(root, decoded.replace(/^\/+/, '') || 'index.html');
    return target.startsWith(path.resolve(root) + path.sep) ? target : null;
  } catch { return null; }
}
function pdfName(value) {
  const safe = typeof value === 'string' ? value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100) : '';
  return `Траст ремонт - ${safe.replace(/[. ]+$/, '') || 'концепция'}.pdf`;
}
module.exports = { MAIN_URL, CSP, isAppUrl, assetPath, pdfName };
