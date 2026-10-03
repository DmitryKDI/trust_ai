import { useEffect, useState } from 'react';
import { geometryHash } from '../geometry/plan';
import { recognizeDocument } from '../recognize/run';
import { runVariantsInWorker } from '../layout/runVariants';
import { isReady } from '../layout/variants';
import { provisionalScale } from '../editor/ops';
import type { SourceDocument } from '../model/types';
import { emptyGeometry, uid } from '../model/defaults';
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
    const isImg = /^image\/(png|jpe?g|webp|bmp|gif)$/.test(f.type);
    if (!isPdf && !isImg) { setErr('Нужен PDF или картинка (JPG, PNG).'); return; }
    setBusy(true);
    try {
      const id = uid('doc');
      await putFile(id, f);
      const pageCount = isPdf ? await pdfPageCount(await f.arrayBuffer()) : 1;
      const d: SourceDocument = { id, name: f.name, mime: isPdf ? 'application/pdf' : f.type, size: f.size, pageCount, role, addedAt: new Date().toISOString() };
      update((p) => ({ ...p, documents: [...p.documents.filter((x) => x.role !== role), d], ...(role === 'reference' ? { referencePage: 1 } : {}) }));
      if (role === 'plan') {
        editGeometry((g) => ({ ...emptyGeometry(), version: g.version, sourceDocumentId: id, sourcePage: pageCount === 1 ? 1 : null }));
        update(p => ({ ...p, planImage: undefined, recognition: undefined, selectedVariantId: null, review: null }));
      }
    } catch (e) {
      setErr(`Не удалось прочитать файл: ${String((e as Error).message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Вставка картинки из буфера обмена (Ctrl+V): скриншот или фото плана.
  useEffect(() => {
    if (role !== 'plan') return;
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (!f) return;
      e.preventDefault();
      onFile(new File([f], `план из буфера ${new Date().toLocaleString('ru-RU').replace(/[:/]/g, '-')}.png`, { type: f.type || 'image/png' }));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const choose = (n: number) => {
    if (role === 'plan' && n !== page) {
      editGeometry(g => ({ ...emptyGeometry(), version: g.version, sourceDocumentId: doc?.id ?? null, sourcePage: n }));
      update(p => ({ ...p, planImage: undefined, recognition: undefined, selectedVariantId: null, review: null }));
    }
    else if (role === 'reference') update((p) => ({ ...p, referencePage: n }));
  };

  return (
    <div>
      <label className="upload">
        <div style={{ fontSize: 30, color: '#8a6853' }}>↥</div>
        <strong>{doc ? doc.name : role === 'plan' ? 'Перетащите или выберите план (PDF, JPG, PNG) — или вставьте картинку Ctrl+V' : 'Выберите файл PDF, JPG или PNG'}</strong>
        <p className="muted small">{doc ? `${doc.pageCount} стр. · ${(doc.size / 1e6).toFixed(1)} МБ · нажмите, чтобы заменить` : `до ${MAX_MB} МБ; файл остаётся в браузере`}</p>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*" onChange={(e) => onFile(e.target.files?.[0])} />
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

export function UploadScreen({ next, toVariants, toMarkup }: { next: () => void; toVariants: () => void; toMarkup: () => void }) {
  const { project, update } = useStore();
  const g = project.geometry;
  const doc = project.documents.find((d) => d.id === g.sourceDocumentId) ?? null;
  const ok = !!doc && !!g.sourcePage;
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needArea, setNeedArea] = useState(false);
  const [useLearning, setUseLearning] = useState(true);

  // Один шаг: прочитать план → построить варианты → показать.
  const build = async () => {
    if (!doc || !g.sourcePage) return;
    setErr(null);
    try {
      setStage('Читаю план: стены, окна, двери, комнаты…');
      const area = Number(String(project.brief.area).replace(',', '.')) || null;
      const { geometry, report, planImage } = await recognizeDocument(doc, g.sourcePage, { briefAreaM2: area, children: project.brief.children, fallbackK: provisionalScale(doc.mime), useLearning });
      if (report.scale.method === 'assumed' && !planImage) {
        setStage(null);
        setNeedArea(true);
        setErr('На плане не нашлось размеров, по которым определить масштаб. Впишите общую площадь квартиры (она указана на плане БТИ) и нажмите «Построить варианты» ещё раз.');
        return;
      }
      if (!geometry.rooms.length) throw new Error('Не удалось найти комнаты на этой странице. Проверьте, что выбрана страница с планом, или поправьте план вручную.');
      const auto = { ...geometry, sourceDocumentId: doc.id, sourcePage: g.sourcePage, approved: true, approvedAt: new Date().toISOString() };
      auto.approvedHash = geometryHash(auto);
      setStage('Подбираю варианты расстановки…');
      const res = await runVariantsInWorker(auto, project.brief, project.ruleOverrides);
      update((p) => ({ ...p, geometry: auto, variants: res.variants, selectedVariantId: null, review: null, recognition: report, planImage: planImage ?? undefined }));
      setStage(null);
      if (!res.variants.some(isReady)) setErr('Варианты построены, но все требуют доработки — откройте их и подвиньте мебель или поправьте план.');
      toVariants();
    } catch (e) {
      setStage(null);
      setErr(String((e as Error).message ?? e));
    }
  };

  return (
    <div className="view">
      <div className="eyebrow">Шаг 2 · план квартиры</div>
      <h1 className="heading">План квартиры</h1>
      <p className="lead">Загрузите план БТИ, обмер или план застройщика — файлом или вставьте картинку (Ctrl+V). Программа сама прочитает стены, окна и комнаты и предложит варианты расстановки.</p>
      <div className="grid2">
        <section className="card">
          <h2>План</h2>
          <DocPicker role="plan" />
          <label className="field" style={{ marginTop: 14, maxWidth: 360 }}>
            Общая площадь квартиры, м² (необязательно)
            <input inputMode="decimal" value={project.brief.area} placeholder="например, 52,4" style={needArea && !project.brief.area ? { borderColor: 'var(--err)' } : undefined}
              onChange={(e) => update((p) => ({ ...p, brief: { ...p.brief, area: e.target.value } }))} />
            <span className="hint">Если указать — размеры мебели будут точнее. Без неё масштаб прикидывается по дверям, его можно подправить ползунком.</span>
          </label>
          <label className="check-inline" style={{ marginTop: 12 }}><input type="checkbox" checked={useLearning} disabled={!!stage} onChange={e => setUseLearning(e.target.checked)} />Использовать мои проверенные планы и примеры назначений</label>
          <p className="muted small">Для того же файла восстанавливаются сохранённые границы и масштаб. Отключите, чтобы распознать исходник заново.</p>
          <div className="actions">
            <button className="btn" disabled={!ok || !!stage} onClick={build}>{stage ? <><span className="spinner" />{stage}</> : 'Построить варианты'}</button>
            <button className="btn secondary" disabled={!ok || !!stage} onClick={toMarkup}>Поправить план вручную</button>
            {!ok && <span className="muted small">Нужен план и выбранная страница</span>}
          </div>
          {err && <div className="notice err">{err}</div>}
          <p className="muted small">Состав семьи и пожелания — на шаге «Бриф» (<button className="btn ghost sm" onClick={next}>открыть</button>); от них зависят варианты.</p>
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
