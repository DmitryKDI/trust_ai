"""Render opt-in diagnostics without a browser. Requires Pillow; no network access."""
import argparse
import json
import pathlib
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=pathlib.Path)
args = parser.parse_args()
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(font_path, 14)
small = ImageFont.truetype(font_path, 11)
colors = ['#e5484d', '#30a46c', '#3e63dd', '#f76b15', '#8e4ec6', '#12a594', '#ab6400', '#d6409f', '#0090ff']
cards = []
for file in sorted(args.directory.glob('*.json')):
    if file.name == 'summary.json':
        continue
    d = json.loads(file.read_text())
    width = 420
    height = round(width * d['h'] / d['w'])
    source = Image.open(args.directory / d['img']).convert('RGB').resize((width, height))
    clean = Image.new('RGB', source.size, '#fafafa')
    overlay = source.copy().convert('RGBA')
    shade = Image.new('RGBA', source.size, (255, 255, 255, 150))
    overlay = Image.alpha_composite(overlay, shade)
    layer = Image.new('RGBA', source.size)
    draw = ImageDraw.Draw(layer)
    clean_draw = ImageDraw.Draw(clean)
    factor = width / (d['w'] * d['k'])
    def point(p):
        return (round(p['x'] * factor), round(p['y'] * factor))
    for i, room in enumerate(d['rooms']):
        pts = [point(p) for p in room['polygon']]
        color = colors[i % len(colors)]
        rgb = tuple(int(color[j:j+2], 16) for j in (1, 3, 5))
        draw.polygon(pts, fill=rgb + (65,), outline=rgb + (255,), width=2)
        clean_draw.polygon(pts, fill=rgb + (255,), outline='#222', width=2)
        # Use the exported interior label point when available.
        p = room.get('labelPoint')
        xy = point(p) if p else (round(sum(x for x, _ in pts) / len(pts)), round(sum(y for _, y in pts) / len(pts)))
        poly = room['polygon']
        area = abs(sum(a['x'] * b['y'] - b['x'] * a['y'] for a, b in zip(poly, poly[1:] + poly[:1]))) / 2e6
        label = f'{i+1}: {area:.1f} м²'
        for target in (draw, clean_draw):
            target.text(xy, label, font=small, fill='#111', stroke_width=2, stroke_fill='white', anchor='mm')
    for opening in d['openings']:
        xy = [point(opening['a']), point(opening['b'])]
        color = '#111' if opening['type'] == 'door' else '#00b6df'
        draw.line(xy, fill=color, width=3)
        clean_draw.line(xy, fill=color, width=3)
    overlay = Image.alpha_composite(overlay, layer).convert('RGB')
    card = Image.new('RGB', (width * 3 + 40, height + 86), 'white')
    title = ImageDraw.Draw(card)
    version = d.get('recognitionVersion', d['sourceCommit'])
    title.text((10, 8), f"{d['id']} · {len(d['rooms'])} зон · версия {version}", font=font, fill='#111')
    title.text((10, 30), 'Площади рассчитаны по масштабу алгоритма; это не эталон и не обмер.', font=small, fill='#555')
    for i, (name, panel) in enumerate([('Оригинал', source), ('Контуры без подложки', clean), ('Наложение зон и проёмов', overlay)]):
        x = 10 + i * (width + 10)
        title.text((x, 54), name, font=font, fill='#111')
        card.paste(panel, (x, 78))
    target = args.directory / f"review-{d['id']}.png"
    card.save(target)
    cards.append((d['id'], target.name))
html = f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Диагностика зон</title><style>body{{font:16px sans-serif;margin:20px}}img{{width:100%;height:auto}}article{{margin:30px 0}}</style><h1>Исходная диагностика: {len(cards)} планов</h1><p>Цвета обозначают номера зон, а не типы помещений. Геометрические эталоны пока не согласованы.</p>'
html += ''.join(f'<article id="{id}"><h2>{id}</h2><a href="{name}"><img src="{name}" alt="{id}: оригинал, схема и наложение"></a></article>' for id, name in cards)
(args.directory / 'index.html').write_text(html, encoding='utf-8')
print(f'Rendered {len(cards)} plans')
