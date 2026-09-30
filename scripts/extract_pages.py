"""Извлечение нужных страниц PDF заказчика в data/cases/<кейс>/pages/.

Для каждой страницы создаёт:
  p<N>.png  — растр 200 dpi (подложка в редакторе, превью);
  p<N>.pdf  — одностраничный PDF (загрузка в приложение без целого альбома).
И общий data/cases/manifest.json со связями «исходный план → варианты → финал».

Исходные PDF только читаются. Результат не коммитится (.gitignore).
Запуск: python scripts/extract_pages.py [--dpi 200] [--only pilot-r,ever]
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cases"

# Список кейсов и страниц — в data/cases/sources.json (не коммитится: в именах файлов есть данные клиентов).
# Формат — scripts/sources.example.json. id кейса обезличен. Роли: measured — обмерный план,
# layout — план с мебелью, search — вариант поиска, reference — эталон дизайнера.
SOURCES = OUT / "sources.json"


def load_cases() -> list[dict]:
    if not SOURCES.exists():
        raise SystemExit(f"Нет {SOURCES}. Скопируйте scripts/sources.example.json и укажите части имён PDF.")
    cases = json.loads(SOURCES.read_text(encoding="utf-8"))
    for c in cases:
        for d in c["docs"]:
            d["pages"] = {int(k): v for k, v in d["pages"].items()}
    return cases


def nfc(s: str) -> str:
    # Часть имён файлов записана в NFD (разложенная «й»): сравниваем в NFC.
    return unicodedata.normalize("NFC", s)


def find_pdf(match: str) -> Path:
    hits = [p for p in ROOT.glob("*.pdf") if nfc(match) in nfc(p.name)]
    if len(hits) != 1:
        raise SystemExit(f"Ожидался один PDF с «{match}», найдено: {[h.name for h in hits]}")
    return hits[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    only = {s for s in args.only.split(",") if s}

    manifest = {"version": 1, "dpi": args.dpi, "cases": []}
    for case in load_cases():
        if only and case["id"] not in only:
            continue
        pages_dir = OUT / case["id"] / "pages"
        pages_dir.mkdir(parents=True, exist_ok=True)
        entry = {"id": case["id"], "title": case["title"], "pages": []}
        for doc_cfg in case["docs"]:
            src = find_pdf(doc_cfg["match"])
            doc = pymupdf.open(src)
            stem = doc_cfg["match"].split()[0].lower()
            for n, role in doc_cfg["pages"].items():
                page = doc[n - 1]
                name = f"{stem}-p{n}"
                png = pages_dir / f"{name}.png"
                pdf = pages_dir / f"{name}.pdf"
                if not png.exists():
                    page.get_pixmap(dpi=args.dpi).save(png)
                if not pdf.exists():
                    one = pymupdf.open()
                    one.insert_pdf(doc, from_page=n - 1, to_page=n - 1)
                    one.save(pdf, garbage=3, deflate=True)
                entry["pages"].append({
                    "role": role,
                    "sourceFile": src.name,
                    "sourcePage": n,
                    "png": png.relative_to(OUT).as_posix(),
                    "pdf": pdf.relative_to(OUT).as_posix(),
                    "sizeMm": [round(page.rect.width * 25.4 / 72), round(page.rect.height * 25.4 / 72)],
                })
                print(f"{case['id']}: {name} ({role})", flush=True)
        # Связи: исходный план → варианты → финал.
        roles = lambda r: [p["png"] for p in entry["pages"] if p["role"] == r]
        entry["links"] = {"measured": roles("measured"), "variants": roles("search") + roles("layout"), "final": roles("reference")}
        manifest["cases"].append(entry)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("manifest:", (OUT / "manifest.json").relative_to(ROOT))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
