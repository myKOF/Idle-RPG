"""Encode the actual GLB loop three times (2 s) for easy review."""
import sys,json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
base=Path(sys.argv[1]);out=base/'preview';out.mkdir(exist_ok=True);report={'gifs':[],'captures':{}}
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
for folder,name in [('side','Run.gif'),('front','Front.gif'),('top','Top.gif')]:
 capture=json.loads((base/folder/'capture.json').read_text());assert not capture['errors'] and not capture['warnings'] and len(capture['frames'])==20
 assert abs(capture['duration']-2/3)<1e-6
 frames=[Image.open(base/folder/('%04d.png'%i)).convert('RGB') for i in range(20)];assert all(f.size==(900,600) for f in frames)
 bounds={'minX':min(f['bounds']['minX'] for f in capture['frames']),'maxX':max(f['bounds']['maxX'] for f in capture['frames']),'minY':min(f['bounds']['minY'] for f in capture['frames']),'maxY':max(f['bounds']['maxY'] for f in capture['frames'])}
 assert bounds['minX']>=0 and bounds['maxX']<=900 and bounds['minY']>=0 and bounds['maxY']<=600,bounds
 report['captures'][folder]={'glbSHA256':capture['glbSHA256'],'bounds':bounds}
 palette_sheet=Image.new('RGB',(1800,1200))
 for i in range(12):palette_sheet.paste(frames[round(i*19/11)].resize((450,400)),((i%4)*450,(i//4)*400))
 palette=palette_sheet.quantize(colors=256,method=Image.Quantize.MEDIANCUT)
 indexed=[f.quantize(palette=palette,dither=Image.Dither.FLOYDSTEINBERG) for f in frames]*3
 durations=[(round((i+1)*100/30)-round(i*100/30))*10 for i in range(60)]
 target=out/name;indexed[0].save(target,save_all=True,append_images=indexed[1:],duration=durations,loop=0,optimize=False,disposal=1)
 with Image.open(target) as gif:
  ms=0
  for i in range(gif.n_frames):gif.seek(i);gif.load();ms+=gif.info.get('duration',0)
  assert gif.size==(900,600) and gif.n_frames==60 and ms==2000 and gif.info.get('loop')==0
  report['gifs'].append({'file':name,'frames':gif.n_frames,'durationMs':ms,'size':list(gif.size),'cycles':3,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
 contact=Image.new('RGB',(1500,880),'#1e2a32');draw=ImageDraw.Draw(contact)
 for i,f in enumerate(frames):
  x=(i%5)*300;y=(i//5)*220;draw.text((x+8,y+2),'%s / %.3f s'%(folder,i/30),font=font,fill='white');contact.paste(f.resize((300,200)),(x,y+20))
 contact.save(out/(folder+'-contact.jpg'),quality=92)
assert len({c['glbSHA256'] for c in report['captures'].values()})==1
(out/'encoding.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('LIZARD_GIF_PASS',json.dumps(report))
