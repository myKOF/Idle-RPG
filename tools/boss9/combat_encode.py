"""Encode actual GLB captures as four review GIFs and verify every frame."""
import sys,json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
base=Path(sys.argv[1]);out=base/'preview';out.mkdir(exist_ok=True)
capture=json.loads((base/'frames/capture.json').read_text())
assert not capture['errors'] and not capture['warnings']
durations={'Attack1':1500,'Attack2':1200,'Attack3':3000,'Die':2500}
report={'glbSHA256':capture['glbSHA256'],'gifs':[],'bounds':{}}
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
for name,duration in durations.items():
 n=round(duration*30/1000);records=capture['frames'][name]
 assert len(records)==n+1 and abs(capture['clips'][name]-duration/1000)<1e-6
 bounds={'minX':min(r['bounds']['minX'] for r in records),'maxX':max(r['bounds']['maxX'] for r in records),'minY':min(r['bounds']['minY'] for r in records),'maxY':max(r['bounds']['maxY'] for r in records)}
 assert bounds['minX']>=0 and bounds['maxX']<=900 and bounds['minY']>=0 and bounds['maxY']<=600,bounds
 report['bounds'][name]=bounds
 frames=[Image.open(base/'frames'/name/('%04d.png'%i)).convert('RGB') for i in range(n+(name=='Die'))]
 assert all(f.size==(900,600) for f in frames)
 sheet=Image.new('RGB',(1800,1200));indices=[round((len(frames)-1)*i/11) for i in range(12)]
 for i,j in enumerate(indices):sheet.paste(frames[j].resize((450,400)),((i%4)*450,(i//4)*400))
 palette=sheet.quantize(colors=256,method=Image.Quantize.MEDIANCUT)
 indexed=[f.quantize(palette=palette,dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
 ms=[(round((i+1)*100/30)-round(i*100/30))*10 for i in range(n)]
 if name=='Die':ms.append(800)
 file=out/(name+'.gif');indexed[0].save(file,save_all=True,append_images=indexed[1:],duration=ms,loop=0,optimize=False,disposal=1)
 with Image.open(file) as gif:
  total=0
  for i in range(gif.n_frames):gif.seek(i);gif.load();total+=gif.info.get('duration',0)
  assert gif.info.get('loop')==0 and total==duration+(800 if name=='Die' else 0)
  report['gifs'].append({'file':file.name,'frames':gif.n_frames,'durationMs':total,'animationMs':duration,'finalHoldMs':800 if name=='Die' else 0,'size':list(gif.size),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
 contact=Image.new('RGB',(1350,650),'#26313a');draw=ImageDraw.Draw(contact)
 for i,j in enumerate([round((len(frames)-1)*f) for f in [0,.22,.4,.55,.75,1]]):
  tile=frames[j].resize((450,300));x=(i%3)*450;y=(i//3)*325;contact.paste(tile,(x,y+25));draw.text((x+12,y+4),name+' / %.3f s'%(j/30),font=font,fill='white')
 contact.save(out/(name+'-contact.jpg'),quality=91)
particles=capture['particles'];maximum=max(p['maxDistance'] for p in particles)
assert 19.9<maximum<=20.00001 and particles[-1]['alive']==0
assert all(max(p['layers'].values())>0 for p in particles if 1.1<p['time']<2.1)
report['particles']={'maximumDistanceMeters':maximum,'clearAtEnd':True,'layers':list(particles[-1]['layers'])}
(out/'encoding.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('COMBAT_GIF_PASS',json.dumps(report))
