"""Encode Chrome screenshots only. GIFs are review media, never runtime assets."""
from pathlib import Path
from PIL import Image, ImageDraw
import json
base = Path(__file__).resolve().parent
capture = base / 'captures'
new = [Image.open(p).convert('RGB') for p in sorted((capture/'frames').glob('*.png'))]
old = [Image.open(p).convert('RGB') for p in sorted((capture/'before-frames').glob('*.png'))]
assert len(new) == len(old) == 103
def encode(frames, target, milliseconds):
    width, height = frames[0].size
    sheet = Image.new('RGB', (width*4, height), '#F5F0E8')
    for i, n in enumerate([0,21,51,len(frames)-1]): sheet.paste(frames[n], (i*width,0))
    palette = sheet.quantize(colors=192)
    pictures = [f.quantize(palette=palette,dither=Image.Dither.NONE) for f in frames]
    durations = [round((i+1)*milliseconds/len(frames)/10)*10-round(i*milliseconds/len(frames)/10)*10 for i in range(len(frames))]
    pictures[0].save(target,save_all=True,append_images=pictures[1:],duration=durations,disposal=2,optimize=False)
    gif = Image.open(target)
    total = 0
    for n in range(gif.n_frames):
        gif.seek(n); total += gif.info.get('duration',0)
    assert total == milliseconds and gif.info.get('loop') is None
    return {'file':target.name,'frames':gif.n_frames,'durationMs':total,'loop':None,'bytes':target.stat().st_size}
paired=[]
for a,b in zip(old,new):
    image=Image.new('RGB',(1080,472),'#F5F0E8');image.paste(a,(0,32));image.paste(b,(540,32))
    draw=ImageDraw.Draw(image);draw.text((24,8),'V2 / 6.8s',fill='#1B4332');draw.text((564,8),'V2.1 / 5.2s',fill='#1B4332');paired.append(image)
reports=[encode(paired,base/'v2-v21-once.gif',6800),encode(new[:79],base/'hero-motion-once.gif',5200)]
(base/'render-results.json').write_text(json.dumps({'scope':'Chrome frame review media, not professional quality certification','media':reports,'acceptance':'pending user evaluation'},indent=2),encoding='utf-8')
print(json.dumps(reports))
