"""Encode only the browser-rendered review frames; no app/runtime dependencies."""
from pathlib import Path
from PIL import Image, ImageChops, ImageStat, ImageDraw
import json

base = Path(__file__).resolve().parent
capture = base / 'captures'
after = [Image.open(p).convert('RGB') for p in sorted((capture / 'frames').glob('*.png'))]
before = [Image.open(p).convert('RGB') for p in sorted((capture / 'before-frames').glob('*.png'))]
assert len(after) == len(before) == 103
duration = [round((i + 1) * 680 / 103) * 10 - round(i * 680 / 103) * 10 for i in range(103)]

def encode(frames, target):
    width, height = frames[0].size
    sheet = Image.new('RGB', (width * 4, height), '#F5F0E8')
    for i, frame in enumerate([frames[0], frames[21], frames[51], frames[-1]]):
        sheet.paste(frame, (width * i, 0))
    palette = sheet.quantize(colors=192)
    quantized = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    # No loop extension: the review image plays once and retains its last frame.
    quantized[0].save(target, save_all=True, append_images=quantized[1:], duration=duration, disposal=2, optimize=False)

encode(after, base / 'hero-motion-once.gif')
paired = []
for old, new in zip(before, after):
    image = Image.new('RGB', (1080, 472), '#F5F0E8')
    image.paste(old, (0, 32)); image.paste(new, (540, 32))
    draw = ImageDraw.Draw(image)
    draw.text((24, 8), 'BEFORE', fill='#1B4332')
    draw.text((564, 8), 'HERO V2', fill='#1B4332')
    paired.append(image)
encode(paired, base / 'before-after-once.gif')

gif = Image.open(base / 'hero-motion-once.gif')
decoded = []; total = 0
for n in range(gif.n_frames):
    gif.seek(n); total += gif.info.get('duration', 0); decoded.append(gif.convert('RGB').copy())
changes = [sum(ImageStat.Stat(ImageChops.difference(a,b)).mean) / 3 for a,b in zip(decoded, decoded[1:])]
report = {
    'scope': 'Review GIF decoded from real Chrome frame captures; not upstream look.py certification',
    'frames': gif.n_frames, 'durationMs': total, 'loopExtension': gif.info.get('loop'),
    'pictureVarianceMin': min(sum(ImageStat.Stat(frame).var) / 3 for frame in decoded),
    'changedTransitions': sum(v > .001 for v in changes),
    'meanPixelDifference': sum(changes) / max(1, len(changes)),
    'bytes': {p.name:p.stat().st_size for p in [base/'hero-motion-once.gif',base/'before-after-once.gif']},
    'audio': 'none planned', 'professionalDesignAcceptance': 'pending user evaluation'
}
assert total == 6800 and report['loopExtension'] is None and report['changedTransitions'] > 20
(base/'render-results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
