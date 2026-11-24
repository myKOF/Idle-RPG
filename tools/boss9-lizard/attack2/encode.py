"""Encode the real 1.5-second model capture and a full four-times slow view."""
import sys,json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(sys.argv[1]);out=root/'preview';out.mkdir(exist_ok=True)
report={'gifs':[],'captures':{}};font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
for folder,name in [('front','BOSS9_Attack2.gif'),('side','BOSS9_Attack2_Side.gif'),('path','BOSS9_Attack2_Path.gif')]:
    capture=json.loads((root/folder/'capture.json').read_text())
    assert len(capture['frames'])==150 and capture['duration']==1.5 and not capture['errors'] and not capture['warnings']
    frames=[Image.open(root/folder/('%04d.png'%i)).convert('RGB') for i in range(150)]
    sheet=Image.new('RGB',(1350,1200))
    for j in range(12):sheet.paste(frames[round(j*149/11)].resize((450,300)),((j%3)*450,(j//3)*300))
    palette=sheet.quantize(colors=256,method=Image.Quantize.MEDIANCUT)
    indexed=[f.quantize(palette=palette,dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
    selected=list(range(0,150,2));normal=[indexed[i] for i in selected];target=out/name
    normal[0].save(target,save_all=True,append_images=normal[1:],duration=20,loop=0,optimize=False,disposal=1)
    with Image.open(target) as gif:
        total=0
        for i in range(gif.n_frames):gif.seek(i);gif.load();total+=gif.info['duration']
        assert gif.n_frames==75 and total==1500 and gif.size==(900,600) and gif.info['loop']==0
        report['gifs'].append({'file':name,'frames':75,'durationMs':total,'size':[900,600],'sourceFrameIndices':selected,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
    contact=Image.new('RGB',(1500,1320),'#1e2a32');draw=ImageDraw.Draw(contact)
    for j in range(30):
        i=round(j*149/29);x=j%5*300;y=j//5*220;draw.text((x+5,y+3),'%s / %.2f s'%(folder,i/100),font=font,fill='white');contact.paste(frames[i].resize((300,200)),(x,y+20))
    contact.save(out/(folder+'-contact.jpg'),quality=92)
    bounds={k:(min if k.startswith('min') else max)(f['bounds'][k] for f in capture['frames']) for k in ['minX','maxX','minY','maxY']}
    report['captures'][folder]={'glbSHA256':capture['glbSHA256'],'bounds':bounds}
assert len({v['glbSHA256'] for v in report['captures'].values()})==1
slow=out/'BOSS9_Attack2_Slow.gif';indexed[0].save(slow,save_all=True,append_images=indexed[1:],duration=40,loop=0,optimize=False,disposal=1)
with Image.open(slow) as gif:
    total=0
    for i in range(gif.n_frames):gif.seek(i);gif.load();total+=gif.info['duration']
    assert gif.n_frames==150 and total==6000 and gif.size==(900,600)
report['gifs'].append({'file':slow.name,'frames':150,'durationMs':6000,'size':[900,600],'speed':.25,'sha256':hashlib.sha256(slow.read_bytes()).hexdigest()})
(out/'encoding.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('ATTACK2_GIF_PASS 4 GIFs; 1.5 seconds / 6-second slow view')
