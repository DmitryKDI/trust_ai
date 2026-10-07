// Клиентская страница: до трёх актуальных проверенных вариантов, выбранный отмечен. Без исходных документов,
// эталона, моделей, уверенностей и технических полей.
import { useMemo } from 'react';
import { SceneImage } from '../scene/SceneImage';
import { sceneSettings } from '../scene/types';
import { EMPTY_CATALOG } from '../scene/catalog';
import { geometryHash } from '../geometry/plan';
import { isReady } from '../layout/variants';
import '../scene/scene.css';
import { useStore } from '../state/store';
import { PlanView, planBounds, ScaleBar } from '../plan/PlanView';
import { COST_INFO } from '../rules/rules';
import { interiorGeom } from '../geometry/plan';
import { geomArea } from '../geometry/poly';

const mln = (v: number) => (v / 1e6).toFixed(2).replace('.', ',');

export function ClientScreen({ back }: { back: () => void }) {
  const { project, rules } = useStore();
  const settings = useMemo(() => ({ ...sceneSettings(project.concept.scene3d), fullWalls: false, showCeiling: false }), [project.concept.scene3d]);
  const v = project.variants.find((x) => x.id === project.selectedVariantId && x.approved);
  if (!v)
    return (
      <div className="view">
        <h1 className="heading">Страница для клиента</h1>
        <div className="notice err">Нет утверждённого варианта. Выберите и утвердите вариант на шаге «Варианты».</div>
        <div className="actions"><button className="btn" onClick={back}>К вариантам</button></div>
      </div>
    );

  const g = project.geometry;
  const planArea = geomArea(interiorGeom(g, false)) / 1e6;
  const briefArea = Number(String(project.brief.area).replace(',', '.'));
  const area = planArea > 5 ? planArea : briefArea || 0;
  const rooms = g.rooms.filter((r) => ['living', 'bedroom', 'kids', 'kitchen-living'].includes(r.type)).length;
  const vb = planBounds(g, 350);
  const c = project.concept;
  const variants = project.variants.filter(x => isReady(x) && x.geometryHash === geometryHash(g)).slice(0, 3);

  return (
    <div className="view">
      <div className="actions no-print" style={{ marginTop: 0, marginBottom: 16 }}>
        <button className="btn secondary" onClick={back}>Изменить вариант</button>
        <button className="btn ghost" onClick={() => { if (document.querySelectorAll('[data-client-3d]').length !== variants.length) { alert('Дождитесь подготовки 3D-визуализаций. Если 3D недоступно, включите аппаратное ускорение браузера.'); return; } window.print(); }}>Печать / PDF</button>
        <span className="muted small">Для PDF выберите «Сохранить как PDF» в окне печати.</span>
      </div>
      <article className="client">
        <header className="clienthero">
          <div>
            <div className="eyebrow" style={{ color: '#c7a990' }}>Траст ремонт · концепция для обсуждения</div>
            <h1>{variants.length === 3 ? 'Три варианта для вашей квартиры' : 'Варианты для вашей квартиры'}</h1>
            <p>Рекомендуем: {v.title}. {v.idea}.</p>
            <div className="counts" style={{ marginTop: 14 }}>
              {area > 0 && <span className="badge">{area.toFixed(1).replace('.', ',')} м² по обмеру</span>}
              {rooms > 0 && <span className="badge">{rooms} {rooms === 1 ? 'жилая комната' : 'жилые комнаты'}</span>}
              <span className="badge">{c.styleName}</span>
            </div>
          </div>
          <div className="planbox">
            <PlanView g={g} items={v.items} mode="client" viewBox={vb} wallImage={project.planImage} planStyle={project.planStyle} ariaLabel={`Предварительная схема: ${v.title}`}><ScaleBar vb={vb} /></PlanView>
          </div>
        </header>
        <div className="clientbody">
          {variants.length < 3 && <div className="notice no-print">Готово {variants.length} из 3 вариантов. Пересоберите или доработайте остальные на шаге «Варианты».</div>}
          <section>
            <div className="eyebrow">Сравните решения</div><h2>Планировки и 3D-визуализации</h2>
            <div className="client-variants">{variants.map((variant, i) => <article className="client-variant" key={variant.id}>
              <div className="eyebrow">Вариант {i + 1}{variant.id === v.id ? ' · рекомендуемый' : ''}</div><h3>{variant.title}</h3><p className="small">{variant.idea}.</p>
              <SceneImage geometry={g} items={variant.items} settings={settings} catalog={c.materialCatalog ?? EMPTY_CATALOG} palette={c.palette} title={variant.title} />
              <PlanView g={g} items={variant.items} mode="client" viewBox={vb} wallImage={project.planImage} planStyle={project.planStyle} ariaLabel={`План варианта ${i + 1}: ${variant.title}`} />
              <ul className="list">{variant.benefits.slice(0, 3).map(b => <li key={b}>{b}</li>)}</ul>
              {variant.compromises.length > 0 && <p className="muted small">Что учесть: {variant.compromises.filter(x => !x.startsWith('Не поместилось')).join('; ')}.</p>}
            </article>)}</div>
          </section>
          <section>
            <div className="eyebrow">Что получает квартира</div>
            <h2>Польза решения</h2>
            <div className="benefits">{v.benefits.slice(0, 6).map((b) => <div className="benefit" key={b}>{b}</div>)}</div>
            {v.compromises.filter((x) => !x.startsWith('Не поместилось')).length > 0 && (
              <p className="muted small" style={{ marginTop: 12 }}>Что учесть: {v.compromises.filter((x) => !x.startsWith('Не поместилось')).join('; ')}.</p>
            )}
          </section>
          <section>
            <div className="eyebrow">Настроение интерьера</div>
            <h2>{c.styleName}</h2>
            <p className="muted">{c.rationale}</p>
            <div className="palette" style={{ margin: '12px 0 16px' }}>
              {c.palette.map((s) => <div className="swatch" key={s.name}><div className="chip" style={{ background: s.hex }} /><div className="small" style={{ marginTop: 6 }}>{s.name}</div></div>)}
            </div>
            <ul className="list">{c.materials.filter(Boolean).map((m) => <li key={m}>{m}</li>)}</ul>
            <div className="refs" style={{ marginTop: 14 }}>
              {c.references.slice(0, 4).map((r) => (
                <figure className="ref" key={r.id} style={{ margin: 0 }}>
                  <img src={r.url} alt={r.caption} />
                  <span className="tag">{r.kind === 'reference' ? 'Референс' : 'Иллюстрация'}</span>
                  <figcaption className="cap">{r.caption}<br /><span className="muted">Источник: {r.sourceName}</span></figcaption>
                </figure>
              ))}
            </div>
          </section>
          <section className="cost">
            <div>
              <strong style={{ font: '400 24px Prata, serif' }}>Ориентир стоимости работ</strong>
              <p className="small muted" style={{ margin: '6px 0 0' }}>{Math.round(rules.costRateMin / 1000)}–{Math.round(rules.costRateMax / 1000)} тыс. ₽ за м² × {area.toFixed(1).replace('.', ',')} м². Предварительно, до подробной сметы.</p>
            </div>
            <div className="num">{area > 0 ? `${mln(area * rules.costRateMin)}–${mln(area * rules.costRateMax)} млн ₽` : 'уточняется'}</div>
            <div className="cols">
              <div><b>Входит</b><ul className="list">{COST_INFO.includes.map((x) => <li key={x}>{x}</li>)}</ul></div>
              <div><b>Не входит</b><ul className="list minus">{COST_INFO.excludes.map((x) => <li key={x}>{x}</li>)}</ul></div>
            </div>
          </section>
          <p className="fineprint">
            Предварительная концепция по обмерному плану. Схема, размеры мебели и стоимость уточняются в полноценном дизайн-проекте.
            {v.assumptions.length > 0 && ` Допущения: ${v.assumptions.join('; ').toLowerCase()}.`}
          </p>
        </div>
        <footer className="clientfooter">
          <div><strong style={{ font: '400 22px Prata, serif' }}>Сделаем следующий шаг?</strong><p style={{ margin: '6px 0 0', color: '#7b6759' }}>Разработаем детальный проект под ваш образ жизни и бюджет.</p></div>
          <button className="btn" onClick={() => alert('Менеджер согласует консультацию и подготовку полноценного дизайн-проекта.')}>Перейти к полноценному дизайн-проекту</button>
        </footer>
      </article>
    </div>
  );
}
