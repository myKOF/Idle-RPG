"""Encode screenshots streamed in memory; keep only final previews and QA."""
import sys,json,base64,io,hashlib
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
pack=Path(sys.argv[1]);view=sys.argv[2];out=pack/'preview';qa=pack/'qa'
spec=json.loads(Path(__file__).with_name('spec.json').read_text());count=int(sys.argv[3]);duration=spec['duration']
base='BOSS9_Attack3_v'+str(spec['version'])
out.mkdir(exist_ok=True);qa.mkdir(exist_ok=True);frames=[]
for line in sys.stdin:
    item=json.loads(line);assert item['frame']==len(frames)
    frame=Image.open(io.BytesIO(base64.b64decode(item['png']))).convert('RGB');assert frame.size==(900,600)
    for side,label in [('R','Right'),('L','Left')]:
        if view=='front' and item['frame']==round(spec['strokes'][side]['start']/duration*count):frame.save(out/(base+'_'+label+'.png'))
    frames.append(frame)
assert len(frames)==count
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
contact=Image.new('RGB',(1500,1320),'#1e2a32');draw=ImageDraw.Draw(contact)
for j in range(30):
    i=round(j*(count-1)/29);x=j%5*300;y=j//5*220;draw.text((x+5,y+3),'%s / %.2f s'%(view,i*duration/count),font=font,fill='white');contact.paste(frames[i].resize((300,200)),(x,y+20))
contact.save(qa/(view+'-contact.jpg'),quality=92)
palette=contact.quantize(colors=256,method=Image.Quantize.MEDIANCUT)
indexed=[f.quantize(palette=palette,dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
normal=base+{'front':'','side':'_Side','path':'_Path'}[view]+'.gif'
step=1 if count==30 else 2
settings=[(normal,list(range(0,count,step)),round(duration/count*step*1000))]
if view=='front':settings.append((base+'_Slow.gif',list(range(count)),round(duration/count*4000)))
report={'view':view,'gifs':[],'streamedFrames':count}
for name,ids,ms in settings:
    selected=[indexed[i] for i in ids];target=out/name;selected[0].save(target,save_all=True,append_images=selected[1:],duration=ms,loop=0,optimize=False,disposal=1)
    with Image.open(target) as gif:
        total=0
        for i in range(gif.n_frames):gif.seek(i);gif.load();total+=gif.info['duration']
        assert gif.n_frames==len(ids) and total==len(ids)*ms and gif.size==(900,600)
    report['gifs'].append({'file':name,'frames':len(ids),'durationMs':total,'size':[900,600],'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
(qa/(view+'-encoding.json')).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('ATTACK3_ENCODE_PASS',view,flush=True)
