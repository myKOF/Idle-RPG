"""Encode the 3D-only flight GIF and a clearly labelled reference comparison."""
import sys,json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
base,reference=map(Path,sys.argv[1:3]);out=base/'preview';out.mkdir(exist_ok=True)
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
def encode(frames,path):
 sample=Image.new('RGB',(frames[0].width*4,frames[0].height*3))
 for i in range(12):sample.paste(frames[i*5],((i%4)*frames[0].width,(i//4)*frames[0].height))
 palette=sample.quantize(colors=256,method=Image.Quantize.MEDIANCUT)
 indexed=[f.quantize(palette=palette,dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
 indexed[0].save(path,save_all=True,append_images=indexed[1:],duration=[30,30,40]*20,loop=0,optimize=False,disposal=1)
 with Image.open(path) as gif:
  duration=0
  for i in range(gif.n_frames):gif.seek(i);gif.load();duration+=gif.info.get('duration',0)
  assert duration==2000 and gif.info.get('loop')==0
  return {'file':path.name,'frames':gif.n_frames,'durationMs':duration,'size':list(gif.size),'bytes':path.stat().st_size}
full=[Image.open(base/'full'/('%04d.png'%i)).convert('RGB') for i in range(60)]
close=[Image.open(base/'frames'/('%04d.png'%i)).convert('RGB') for i in range(60)]
with Image.open(reference) as gif:
 refs=[]
 for i in range(20):gif.seek(i);refs.append(gif.convert('RGB').copy())
comparison=[]
for i in range(60):
 canvas=Image.new('RGB',(1280,384),'#151d23');draw=ImageDraw.Draw(canvas)
 draw.text((12,3),'Reference (user GIF)',font=font,fill='white');draw.text((652,3),'BOSS9 - authored 3D flight',font=font,fill='white')
 canvas.paste(refs[i//3],(0,24));canvas.paste(close[i],(640,24));comparison.append(canvas)
report=[encode(full,out/'Walk.gif'),encode(comparison,out/'Reference-comparison.gif')]
contact=Image.new('RGB',(1280,384*7),'#151d23')
for j,i in enumerate([0,9,18,27,36,45,54]):contact.paste(comparison[i],(0,j*384))
contact.save(out/'Reference-contact.jpg',quality=92)
for folder in ['frames','full']:
 report_capture=json.loads((base/folder/'capture.json').read_text())
 assert not report_capture['errors'] and not report_capture['warnings']
 if folder=='full':
  bounds=[f['bounds'] for f in report_capture['frames']]
  framing={'minX':min(b['minX'] for b in bounds),'maxX':max(b['maxX'] for b in bounds),'minY':min(b['minY'] for b in bounds),'maxY':max(b['maxY'] for b in bounds)}
  assert framing['minX']>=0 and framing['maxX']<=full[0].width and framing['minY']>=0 and framing['maxY']<=full[0].height,framing
(out/'encoding.json').write_text(json.dumps({'gifs':report,'fullViewBounds':framing},indent=2)+'\n')
print('FLIGHT_GIF_PASS',json.dumps(report),json.dumps(framing))
