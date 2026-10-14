const path = require('node:path');
const ORIGIN = 'trust://planner';
const MAIN_URL = `${ORIGIN}/`;
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; worker-src 'self' blob:; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'";

function isAppUrl(value) {
  try { const u = new URL(value); return u.protocol === 'trust:' && u.hostname === 'planner' && !u.port && !u.username && !u.password; }
  catch { return false; }
}
function isCompanyUrl(value) {
  try { return new URL(value).href === 'https://trustremont.ru/'; }
  catch { return false; }
}
function isAppPageUrl(value) {
  try { const u = new URL(value); return isAppUrl(value) && u.pathname === '/' && !u.search; }
  catch { return false; }
}
function isTrustedIpc(event, window) {
  try { return !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && isAppPageUrl(event.senderFrame.url); }
  catch { return false; }
}
function isLocalDownload(value) {
  try { return typeof value === 'string' && value.startsWith('blob:') && isAppUrl(new URL(value).pathname); }
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
module.exports = { MAIN_URL, CSP, isAppUrl, isAppPageUrl, isTrustedIpc, isLocalDownload, isCompanyUrl, assetPath, pdfName };
