"""Inventory image examples, deduplicate against bench, and prepare only new unlabelled inputs.

Usage: python scripts/intake_plan_archive.py archive.zip --output /path/to/intake
Requires Pillow. It does not modify bench/plans or claim training/recognition accuracy.
"""
import argparse
import hashlib
import io
import json
import pathlib
import zipfile
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('archive', type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
parser.add_argument('--bench', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / 'bench/plans')
args = parser.parse_args()
known = {}
for file in sorted(args.bench.glob('*/plan.*')):
    known.setdefault(hashlib.sha256(file.read_bytes()).hexdigest(), []).append(file.parent.name)
args.output.mkdir(parents=True, exist_ok=True)
records = []
with zipfile.ZipFile(args.archive) as archive:
    for entry in sorted(archive.infolist(), key=lambda entry: entry.filename):
        if entry.is_dir() or pathlib.Path(entry.filename).suffix.lower() not in ('.jpg', '.jpeg', '.png'):
            continue
        content = archive.read(entry)
        sha = hashlib.sha256(content).hexdigest()
        with Image.open(io.BytesIO(content)) as image:
            image.verify()
        with Image.open(io.BytesIO(content)) as image:
            width, height = image.size
        basename = pathlib.Path(entry.filename).name
        matches = known.get(sha, [])
        record = {'file': basename, 'sha256': sha, 'w': width, 'h': height, 'existing': matches, 'annotationStatus': 'existing-area-truth' if matches else 'unlabelled'}
        if not matches:
            # Content-derived directory avoids ZIP path traversal and basename collisions.
            sample = args.output / 'inputs' / f'sample-{sha[:12]}'
            sample.mkdir(parents=True, exist_ok=True)
            image_name = 'plan' + pathlib.Path(basename).suffix.lower()
            (sample / image_name).write_bytes(content)
            truth = {'source': f'archive {args.archive.name}, entry {basename}', 'inputAreaM2': None, 'rooms': [], 'roomsComplete': False, 'doors': None, 'windows': None, 'entrance': None, 'annotationStatus': 'unlabelled'}
            (sample / 'truth.json').write_text(json.dumps(truth, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            record['inputDirectory'] = str(sample.relative_to(args.output))
        records.append(record)
    notes = {}
    for name in ('README.txt', 'sources.txt'):
        if name in archive.namelist():
            notes[name] = archive.read(name).decode('utf-8-sig', errors='replace')
result = {'archive': args.archive.name, 'archiveSha256': hashlib.sha256(args.archive.read_bytes()).hexdigest(), 'examples': records, 'sourceNotes': notes, 'duplicates': sum(bool(r['existing']) for r in records), 'new': sum(not r['existing'] for r in records), 'groundTruthStatus': 'no approved contour labels supplied'}
(args.output / 'inventory.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'examples': len(records), 'duplicates': result['duplicates'], 'new': result['new'], 'inventory': str(args.output / 'inventory.json')}, ensure_ascii=False))
