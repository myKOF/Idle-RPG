"""Encode the one-second attack at 50 FPS and its complete four-times slow view."""
import sys, json, hashlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root=Path(sys.argv[1]);out=root/'preview';out.mkdir(exist_ok=True)
report={'gifs':[],'captures':{}};font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
for folder,name in [('front','BOSS9_Attack1.gif'),('side','BOSS9_Attack1_Side.gif'),('combat','BOSS9_Attack1_Hitbox.gif'),('blocked','BOSS9_Attack1_Capsule.gif'),('path','BOSS9_Attack1_Path.gif')]:
    capture=json.loads((root/folder/'capture.json').read_text())
    assert not capture['errors'] and not capture['warnings'] and len(capture['frames'])==120
    assert abs(capture['duration']-1)<1e-6
    frames=[Image.open(root/folder/('%04d.png'%i)).convert('RGB') for i in range(120)]
    assert all(f.size==(900,600) for f in frames)
    bounds={k:(min if k.startswith('min') else max)(f['bounds'][k] for f in capture['frames']) for k in ['minX','maxX','minY','maxY']}
    assert bounds['minX']>=0 and bounds['maxX']<=900 and bounds['minY']>=0 and bounds['maxY']<=600
    report['captures'][folder]={'glbSHA256':capture['glbSHA256'],'bounds':bounds}
    sheet=Image.new('RGB',(1350,1200))
    for j in range(12):sheet.paste(frames[round(j*119/11)].resize((450,300)),((j%3)*450,(j//3)*300))
    palette=sheet.quantize(colors=256,method=Image.Quantize.MEDIANCUT)
    indexed=[f.quantize(palette=palette,dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
    # GIF delays use 10 ms units; keep 20 ms frames for reliable playback.
    selected_indices=[round(i*len(indexed)/50) for i in range(50)]
    normal=[indexed[i] for i in selected_indices]
    target=out/name
    normal[0].save(target,save_all=True,append_images=normal[1:],duration=20,loop=0,optimize=False,disposal=1)
    with Image.open(target) as gif:
        total=0
        for i in range(gif.n_frames):gif.seek(i);gif.load();total+=gif.info['duration']
        assert gif.n_frames==50 and total==1000 and gif.size==(900,600) and gif.info.get('loop')==0
        report['gifs'].append({'file':name,'frames':gif.n_frames,'durationMs':total,'size':list(gif.size),'sourceFrameIndices':selected_indices,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
    contact=Image.new('RGB',(1500,1320),'#1e2a32');draw=ImageDraw.Draw(contact)
    for j in range(30):
        i=round(j*119/29)
        x=(j%5)*300;y=(j//5)*220;draw.text((x+5,y+3),'%s / %.3f s'%(folder,capture['frames'][i]['time']),font=font,fill='white');contact.paste(frames[i].resize((300,200)),(x,y+20))
    contact.save(out/(folder+'-contact.jpg'),quality=92)
assert len({c['glbSHA256'] for c in report['captures'].values()})==1
slow=out/'BOSS9_Attack1_Arc_Slow.gif'
slow_durations=[10*(round((i+1)*400/120)-round(i*400/120)) for i in range(120)]
indexed[0].save(slow,save_all=True,append_images=indexed[1:],duration=slow_durations,loop=0,optimize=False,disposal=1)
with Image.open(slow) as gif:
    durations=[]
    for i in range(gif.n_frames):gif.seek(i);gif.load();durations.append(gif.info['duration'])
    assert gif.n_frames==120 and sum(durations)==4000 and gif.size==(900,600)
    report['gifs'].append({'file':slow.name,'frames':120,'durationMs':4000,'size':[900,600],'speed':.25,'sourceStart':0,'sourceEnd':1,'sha256':hashlib.sha256(slow.read_bytes()).hexdigest()})
(out/'encoding.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('ATTACK1_GIF_PASS',json.dumps(report),flush=True)
