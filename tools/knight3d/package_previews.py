"""Package Blender PNGs into GIFs at original gesture speed, with a six-up board."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

p=argparse.ArgumentParser()
p.add_argument('--preview',required=True)
a=p.parse_args()
root=Path(a.preview).resolve()
m=json.loads((root/'manifest.json').read_text())
fontpath=Path('C:/Windows/Fonts/msjh.ttc')
font=ImageFont.truetype(str(fontpath),20) if fontpath.exists() else ImageFont.load_default()
small=ImageFont.truetype(str(fontpath),15) if fontpath.exists() else ImageFont.load_default()
labels={'idle':'待機 · IDLE','walk':'跑動 · RUN','attack1':'攻擊 1 · 橫斬',
        'attack2':'攻擊 2 · 上挑斬','cast':'施法 · CAST','die':'死亡 · FALL'}
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
    d.text((22,12),'KNIGHT  /  3D 動作首批預覽',font=font,fill=(230,237,243))
    d.text((22,43),'銀甲劍盾騎士  ·  Blender 實際渲染  ·  無刀光  ·  原動作速度',font=small,fill=(150,170,187))
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
gif_save(boardframes,root/'knight_batch1_actions.gif',[40]*len(boardframes))
boardframes[0].save(root/'knight_batch1_cover.png')
tiny=[]
for f in range(75):
    t=f*.04
    board=Image.new('RGB',(540,408),(14,21,29))
    d=ImageDraw.Draw(board)
    d.text((16,12),'遊戲尺寸檢視 · 站姿身高約 80 px',font=font,fill=(220,231,239))
    for i,name in enumerate(names):
        clip=m['clips'][name]
        hold=0 if clip['loop'] else (.75 if name=='die' else .30)
        local=min(t%(clip['duration']+hold),clip['duration']-.0001)
        desired=1+local*clip['fps']
        index=min(range(len(clip['renderedFrames'])),key=lambda j:abs(clip['renderedFrames'][j]-desired))
        x,y=(i%3)*180,56+(i//3)*176
        board.paste(cache[name][index].resize((128,128),Image.Resampling.LANCZOS),(x+26,y+29))
        d.text((x+20,y+5),labels[name],font=small,fill=(190,207,222))
    tiny.append(board)
gif_save(tiny,root/'knight_batch1_game_size.gif',[40]*len(tiny))
turns=[Image.open(f).convert('RGB') for f in sorted((root/'turntable').glob('*.png'))]
if turns:
    gif_save(turns,root/'knight_batch1_turntable.gif',[90]*len(turns))
print(json.dumps({'gifs':[{ 'name':f.name,'bytes':f.stat().st_size } for f in root.glob('*.gif')]},indent=2))
