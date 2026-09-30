import { useEffect, useState } from 'react';
import type { SourceDocument } from '../model/types';
import { uid } from '../model/defaults';
import { useStore } from '../state/store';
import { getFile, putFile } from '../storage/db';
import { pdfPageCount, pdfThumbnails } from '../pdf/load';

const MAX_MB = 60;

function DocPicker({ role }: { role: 'plan' | 'reference' }) {
  const { project, update, editGeometry } = useStore();
  const doc = project.documents.find((d) => d.role === role) ?? null;
  const page = role === 'plan' ? project.geometry.sourcePage : project.referencePage;
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setThumbs([]);
    if (!doc) return;
    setThumbsLoading(true);
    getFile(doc.id).then(async (b) => {
      if (!b || !alive) return;
      const t = doc.mime === 'application/pdf' ? await pdfThumbnails(await b.arrayBuffer(), 60, 180) : [URL.createObjectURL(b)];
      if (alive) setThumbs(t);
    }).catch((e) => setErr(String(e))).finally(() => alive && setThumbsLoading(false));
    return () => { alive = false; };
  }, [doc?.id]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    if (f.size > MAX_MB * 1024 * 1024) { setErr(`Файл больше ${MAX_MB} МБ. Для больших альбомов извлеките нужную страницу (scripts/extract_pages.py).`); return; }
    const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
    const isImg = /^image\/(png|jpe?g)$/.test(f.type);
    if (!isPdf && !isImg) { setErr('Нужен PDF, JPG или PNG.'); return; }
    setBusy(true);
    try {
      const id = uid('doc');
      await putFile(id, f);
      const pageCount = isPdf ? await pdfPageCount(await f.arrayBuffer()) : 1;
      const d: SourceDocument = { id, name: f.name, mime: isPdf ? 'application/pdf' : f.type, size: f.size, pageCount, role, addedAt: new Date().toISOString() };
      update((p) => ({ ...p, documents: [...p.documents.filter((x) => x.role !== role), d], ...(role === 'reference' ? { referencePage: 1 } : {}) }));
      if (role === 'plan') editGeometry((g) => ({ ...g, sourceDocumentId: id, sourcePage: pageCount === 1 ? 1 : null }));
    } catch (e) {
      setErr(`Не удалось прочитать файл: ${String((e as Error).message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  const choose = (n: number) => {
    if (role === 'plan') editGeometry((g) => ({ ...g, sourcePage: n }));
    else update((p) => ({ ...p, referencePage: n }));
  };

  return (
    <div>
      <label className="upload">
        <div style={{ fontSize: 30, color: '#8a6853' }}>↥</div>
        <strong>{doc ? doc.name : 'Выберите файл PDF, JPG или PNG'}</strong>
        <p className="muted small">{doc ? `${doc.pageCount} стр. · ${(doc.size / 1e6).toFixed(1)} МБ · нажмите, чтобы заменить` : `до ${MAX_MB} МБ; файл остаётся в браузере`}</p>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/png,image/jpeg" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {busy && <p className="muted"><span className="spinner" />Читаю файл…</p>}
      {thumbsLoading && !busy && <p className="muted small"><span className="spinner" />Готовлю миниатюры страниц…</p>}
      {err && <div className="notice err">{err}</div>}
      {doc && thumbs.length > 1 && <p className="muted small" style={{ marginTop: 12 }}>Выберите страницу {role === 'plan' ? 'с обмерным планом' : 'с эталонным решением'}:</p>}
      {doc && (
        <div className="thumbs">
          {thumbs.map((t, i) => (
            <button key={i} className={`thumb ${page === i + 1 ? 'sel' : ''}`} onClick={() => choose(i + 1)} aria-pressed={page === i + 1}>
              <img src={t} alt={`Страница ${i + 1}`} />стр. {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function UploadScreen({ next }: { next: () => void }) {
  const { project } = useStore();
  const ok = !!project.geometry.sourceDocumentId && !!project.geometry.sourcePage;
  return (
    <div className="view">
      <div className="eyebrow">Шаг 2 · исходные данные</div>
      <h1 className="heading">План квартиры</h1>
      <p className="lead">Загрузите обмерный план, план БТИ или план застройщика и выберите страницу. Геометрию вы разметите поверх оригинала на шаге «Разметка» — программа ничего не распознаёт молча.</p>
      <div className="grid2">
        <section className="card">
          <h2>Исходный план</h2>
          <DocPicker role="plan" />
          <div className="actions">
            <button className="btn" disabled={!ok} onClick={next}>Продолжить</button>
            {!ok && <span className="muted small">Нужен файл и выбранная страница</span>}
          </div>
        </section>
        <section className="card">
          <h2>Эталон дизайнера <span className="badge">внутреннее</span></h2>
          <p className="muted small">Необязательно. Готовое решение дизайнера для сравнения с вариантами. На клиентской странице не показывается.</p>
          <DocPicker role="reference" />
        </section>
      </div>
    </div>
  );
}
