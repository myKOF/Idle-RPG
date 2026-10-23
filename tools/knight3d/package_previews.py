"""Package Blender PNGs into GIFs at original gesture speed, with a six-up board."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

p=argparse.ArgumentParser()
p.add_argument('--preview',required=True)
p.add_argument('--reference',help='Original knight sprite directory, for side-by-side inspection only')
a=p.parse_args()
root=Path(a.preview).resolve()
m=json.loads((root/'manifest.json').read_text())
prefix=m.get('previewPrefix','knight_batch1')
fontpath=Path('C:/Windows/Fonts/msjh.ttc')
font=ImageFont.truetype(str(fontpath),20) if fontpath.exists() else ImageFont.load_default()
small=ImageFont.truetype(str(fontpath),15) if fontpath.exists() else ImageFont.load_default()
labels={'idle':'待機 · IDLE','walk':'跑動 · RUN','attack1':'攻擊 1 · 橫斬',
        'attack2':'攻擊 2 · 斜劈','cast':'施法 · CAST','die':'死亡 · FALL'}
cache={}
def gif_save(frames,path,durations):
    # A common color palette prevents per-frame palette changes and flicker.
    sampler=Image.new('RGB',(240*6,240))
    for i in range(6):
        sampler.paste(frames[int(i*(len(frames)-1)/5)].resize((240,240)),(i*240,0))
    palette=sampler.quantize(colors=240)
    indexed=[im.convert('RGB').quantize(palette=palette,dither=Image.Dither.NONE) for im in frames]
    indexed[0].save(path,save_all=True,append_images=indexed[1:],duration=durations,
                    loop=0,disposal=2,optimize=False)
for name,clip in m['clips'].items():
    indices=clip['renderedFrames']
    cache[name]=[Image.open(root/name/('%03d.png'%f)).convert('RGB') for f in indices]
    times=[(f-1)/clip['fps'] for f in indices]
    ends=times[1:]+[clip['duration']]
    # GIF supports 10ms increments; round cumulative time, avoiding accumulated drift.
    durations=[max(10,round(b*100)*10-round(s*100)*10) for s,b in zip(times,ends)]
    if not clip['loop']:
        durations[-1]+=750 if name=='die' else 300
    ims=[]
    for im in cache[name]:
        board=Image.new('RGB',(480,526),(15,22,30))
        board.paste(im,(0,46))
        d=ImageDraw.Draw(board)
        d.text((18,11),labels[name],font=font,fill=(225,233,239))
        ims.append(board)
    gif_save(ims,root/(name+'.gif'),durations)

W,H=360,390
boardframes=[]
names=list(m['clips'])
for f in range(75):
    t=f*.04
    board=Image.new('RGB',(W*3,H*2+86),(14,21,29))
    d=ImageDraw.Draw(board)
    d.text((22,12),'SILVER KNIGHT  /  修長白銀騎士 · 修正版',font=font,fill=(230,237,243))
    d.text((22,43),'無盾牌  ·  踏步／沉身／髖胸轉動  ·  Blender 實際渲染  ·  無刀光',font=small,fill=(150,170,187))
    for i,name in enumerate(names):
        clip=m['clips'][name]
        hold=0 if clip['loop'] else (.75 if name=='die' else .30)
        local=min(t%(clip['duration']+hold),clip['duration']-.0001)
        desired=1+local*clip['fps']
        index=min(range(len(clip['renderedFrames'])),key=lambda j:abs(clip['renderedFrames'][j]-desired))
        x,y=(i%3)*W,86+(i//3)*H
        board.paste(cache[name][index].resize((W,W),Image.Resampling.LANCZOS),(x,y+30))
        d.text((x+16,y+3),labels[name],font=font,fill=(215,225,235))
    boardframes.append(board)
gif_save(boardframes,root/(prefix+'_actions.gif'),[40]*len(boardframes))
boardframes[0].save(root/(prefix+'_cover.png'))
tiny=[]
for f in range(75):
    t=f*.04
    board=Image.new('RGB',(540,464),(14,21,29))
    d=ImageDraw.Draw(board)
    d.text((16,12),'遊戲尺寸檢視 · 站姿身高約 70 px',font=font,fill=(220,231,239))
    for i,name in enumerate(names):
        clip=m['clips'][name]
        hold=0 if clip['loop'] else (.75 if name=='die' else .30)
        local=min(t%(clip['duration']+hold),clip['duration']-.0001)
        desired=1+local*clip['fps']
        index=min(range(len(clip['renderedFrames'])),key=lambda j:abs(clip['renderedFrames'][j]-desired))
        x,y=(i%3)*180,56+(i//3)*204
        board.paste(cache[name][index].resize((160,160),Image.Resampling.LANCZOS),(x+10,y+29))
        d.text((x+20,y+5),labels[name],font=small,fill=(190,207,222))
    tiny.append(board)
gif_save(tiny,root/(prefix+'_game_size.gif'),[40]*len(tiny))
if m.get('offHand'):
    focus=[]
    for f in range(60):
        t=f*.04
        im=Image.new('RGB',(800,462),(15,22,30))
        d=ImageDraw.Draw(im)
        d.text((18,10),'左手修正 · 拳面朝前／左肘收放／前臂與手腕銜接',font=font,fill=(225,233,240))
        for col,name in enumerate(['attack1','attack2']):
            local=min(t%.8,.499999)
            index=min(range(len(m['clips'][name]['renderedFrames'])),
                key=lambda j:abs((m['clips'][name]['renderedFrames'][j]-1)/30-local))
            crop=cache[name][index].crop((85,45,405,365)).resize((400,400),Image.Resampling.LANCZOS)
            im.paste(crop,(col*400,62))
            d.text((col*400+18,39),labels[name],font=small,fill=(180,200,217))
        focus.append(im)
    gif_save(focus,root/(prefix+'_offhand_focus.gif'),[40]*len(focus))
turns=[Image.open(f).convert('RGB') for f in sorted((root/'turntable').glob('*.png'))]
if turns:
    gif_save(turns,root/(prefix+'_turntable.gif'),[90]*len(turns))
if a.reference:
    ref=Path(a.reference).resolve()
    definition=json.loads((ref/'knight.json').read_text(encoding='utf-8'))
    source={}
    for name in ['idle','walk','attack1','attack2','cast','die']:
        trim=definition['anims'][name]['trim']
        sheet=Image.open(ref/(name+'.png')).convert('RGBA')
        source[name]=[]
        for f in range(15):
            cell=Image.new('RGBA',(128,128))
            cell.paste(sheet.crop((f*trim['w'],trim['h'],(f+1)*trim['w'],2*trim['h'])),
                       (trim['x'],trim['y']))
            source[name].append(cell)
    compare=[]
    for f in range(60):
        t=f*.04
        im=Image.new('RGB',(768,916),(22,27,33))
        d=ImageDraw.Draw(im)
        d.text((18,12),'原圖逐格對照 · 正常速度',font=font,fill=(230,235,240))
        d.text((18,45),'左：原圖參考（盾與刀光保留原樣）',font=small,fill=(180,193,205))
        d.text((400,45),'右：Blender 修正版（無盾／無刀光）',font=small,fill=(180,193,205))
        for row,name in enumerate(['attack1','attack2']):
            local=min(t%.8,.499999)
            sf=min(14,int(local*30))
            frame=min(range(len(m['clips'][name]['renderedFrames'])),
                key=lambda j:abs((m['clips'][name]['renderedFrames'][j]-1)/30-local))
            backdrop=Image.new('RGBA',(128,128),(44,47,51,255))
            original=Image.alpha_composite(backdrop,source[name][sf]).convert('RGB')
            y=104+row*400
            im.paste(original.resize((384,384),Image.Resampling.NEAREST),(0,y))
            im.paste(cache[name][frame].resize((384,384),Image.Resampling.LANCZOS),(384,y))
            d.text((16,y-24),labels[name]+'  /  '+str(sf+1)+' of 15',font=small,fill=(200,211,222))
        compare.append(im)
    gif_save(compare,root/(prefix+'_reference_compare.gif'),[40]*len(compare))
print(json.dumps({'gifs':[{ 'name':f.name,'bytes':f.stat().st_size } for f in root.glob('*.gif')]},indent=2))
