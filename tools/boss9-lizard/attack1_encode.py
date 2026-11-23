"""Encode actual GLB captures at 50 FPS; no reference GIF pixels are used."""
import sys, json, hashlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root=Path(sys.argv[1]);out=root/'preview';out.mkdir(exist_ok=True)
report={'gifs':[],'captures':{}};font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
for folder,name in [('front','Attack1.gif'),('side','Attack1_Side.gif'),('top','Attack1_Top.gif')]:
    capture=json.loads((root/folder/'capture.json').read_text())
    assert not capture['errors'] and not capture['warnings'] and len(capture['frames'])==90
    assert abs(capture['duration']-1.8)<1e-6
    frames=[Image.open(root/folder/('%04d.png'%i)).convert('RGB') for i in range(90)]
    assert all(f.size==(900,600) for f in frames)
    bounds={k:(min if k.startswith('min') else max)(f['bounds'][k] for f in capture['frames']) for k in ['minX','maxX','minY','maxY']}
    assert bounds['minX']>=0 and bounds['maxX']<=900 and bounds['minY']>=0 and bounds['maxY']<=600
    report['captures'][folder]={'glbSHA256':capture['glbSHA256'],'bounds':bounds}
    sheet=Image.new('RGB',(1350,1200))
    for j in range(12):sheet.paste(frames[round(j*89/11)].resize((450,300)),((j%3)*450,(j//3)*300))
    palette=sheet.quantize(colors=256,method=Image.Quantize.MEDIANCUT)
    indexed=[f.quantize(palette=palette,dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
    target=out/name
    indexed[0].save(target,save_all=True,append_images=indexed[1:],duration=20,loop=0,optimize=False,disposal=1)
    with Image.open(target) as gif:
        total=0
        for i in range(gif.n_frames):gif.seek(i);gif.load();total+=gif.info['duration']
        assert gif.n_frames==90 and total==1800 and gif.size==(900,600) and gif.info.get('loop')==0
        report['gifs'].append({'file':name,'frames':gif.n_frames,'durationMs':total,'size':list(gif.size),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
    contact=Image.new('RGB',(1500,1320),'#1e2a32');draw=ImageDraw.Draw(contact)
    for j,i in enumerate(range(0,90,3)):
        x=(j%5)*300;y=(j//5)*220;draw.text((x+5,y+3),'%s / %.2f s'%(folder,i/50),font=font,fill='white');contact.paste(frames[i].resize((300,200)),(x,y+20))
    contact.save(out/(folder+'-contact.jpg'),quality=92)
assert len({c['glbSHA256'] for c in report['captures'].values()})==1
(out/'encoding.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('ATTACK1_GIF_PASS',json.dumps(report),flush=True)
