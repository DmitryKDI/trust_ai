import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
const { assetPath, isAppUrl, isCompanyUrl, pdfName } = createRequire(import.meta.url)('../desktop/security.cjs');

describe('desktop boundary', () => {
  const root = path.resolve('dist');
  it('opens only the fixed company homepage outside the app', () => {
    expect(isCompanyUrl('https://trustremont.ru')).toBe(true);
    expect(isCompanyUrl('https://trustremont.ru/')).toBe(true);
    for (const url of ['http://trustremont.ru', 'https://trustremont.ru.evil.test/', 'https://trustremont.ru@evil.test/', 'https://user@trustremont.ru/', 'https://trustremont.ru/?next=evil', 'file:///tmp/a', 'javascript:alert(1)']) expect(isCompanyUrl(url)).toBe(false);
  });
  it('serves only compiled assets from the app origin', () => {
    expect(assetPath(root, 'trust://planner/')).toBe(path.join(root, 'index.html'));
    expect(assetPath(root, 'trust://planner/assets/app.js')).toBe(path.join(root, 'assets/app.js'));
    for (const url of ['file:///C:/Windows/win.ini', 'https://planner/assets/a.js', 'trust://other/assets/a.js', 'trust://user@planner/a.js', 'trust://planner:8000/a.js']) expect(assetPath(root, url)).toBeNull();
  });
  it('rejects encoded traversal, Windows separators, alternate streams and invalid URLs', () => {
    for (const suffix of ['/%2e%2e%2fpackage.json', '/%5c..%5csecret', '/assets/a.js%3asecret', '/%00', '/%ZZ']) expect(assetPath(root, 'trust://planner' + suffix)).toBeNull();
    expect(isAppUrl('javascript:alert(1)')).toBe(false);
  });
  it('keeps filenames inside the chosen folder', () => {
    expect(pdfName('../../CON:<client>')).not.toMatch(/[<>:"/\\|?*\x00-\x1f]/);
    expect(pdfName(undefined)).toBe('Траст ремонт - концепция.pdf');
    expect(pdfName('А'.repeat(1000)).length).toBeLessThan(130);
  });
});
