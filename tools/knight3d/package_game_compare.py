"""Six original/Blender pairs at configured game pixel scale, outside the game.

One SE idle calibration fixes all model scales and anchors. No pose is fitted
individually. The game camera's centre perspective is applied to both columns.
"""
import argparse
import csv
import json
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

p=argparse.ArgumentParser()
p.add_argument('--preview',required=True)
p.add_argument('--reference',default='images/sprites/knight')
p.add_argument('--battle-height',type=int,default=600,help='CSS pixels, normal battle panel')
a=p.parse_args()
root=Path(a.preview).resolve()
ref=Path(a.reference).resolve()
m=json.loads((root/'manifest.json').read_text())
definition=json.loads((ref/'knight.json').read_text(encoding='utf-8'))
projection=json.loads((root/'sprite-projection.json').read_text())
renderer=Path('js/battle-renderer.js').read_text(encoding='utf-8')
distance=float(re.search(r'var BATTLE_CAMERA_DISTANCE_PERCENT = ([\d.]+)',renderer)[1])
for row in csv.reader(Path('config/CSV/game_parameters.csv').read_text(encoding='utf-8-sig').splitlines()):
    if len(row)>6 and row[3]=='戰鬥鏡頭距離': distance=float(row[6])
zoom=100/distance
top_scale=float(re.search(r'var PERSPECTIVE_TOP_SCALE = ([\d.]+)',renderer)[1])
scale=definition['scale']*zoom
font_path='C:/Windows/Fonts/msjh.ttc'
font=ImageFont.truetype(font_path,18)
small=ImageFont.truetype(font_path,13)
labels={'idle':'待機','walk':'跑動','attack1':'攻擊 1','attack2':'攻擊 2','cast':'施法','die':'死亡'}
names=list(labels)
source={}
render={}
direction=definition['directions'].index('SE')
for name in names:
    tr=definition['anims'][name]['trim']
    sheet=Image.open(ref/(name+'.png')).convert('RGBA')
    source[name]=[]
    for f in range(definition['anims'][name]['frames']):
        cell=Image.new('RGBA',(128,128))
        cell.paste(sheet.crop((f*tr['w'],direction*tr['h'],(f+1)*tr['w'],(direction+1)*tr['h'])),
                   (tr['x'],tr['y']))
        source[name].append(cell)
    render[name]=[Image.open(root/name/('%03d.png'%f)).convert('RGBA') for f in m['clips'][name]['renderedFrames']]
    assert all(im.getextrema()[3][0]==0 for im in render[name]), 'Transparent renders required'

# Opaque idle bounds exclude the original's baked translucent shadow. Calibrate
# head-to-foot height once, then retain translation, crouch and sword excursions.
reference_bounds=source['idle'][0].getchannel('A').point(lambda v:255 if v>245 else 0).getbbox()
reference_height=reference_bounds[3]-reference_bounds[1]
model_scale=reference_height*scale/projection['standingBodyHeightPixels']
reference_anchor=(definition['frameWidth']*definition['anchorX'],
                  definition['frameHeight']*definition['anchorY'])
model_anchor=[projection['anchorPixels'][0],
    projection['headTopPixels']+projection['standingBodyHeightPixels']-
    (reference_bounds[3]-reference_anchor[1])*scale/model_scale]

CELL=160
anchor=(80,117)
beta=(1/top_scale-1)/(a.battle_height/2)
den=1-beta*anchor[1]
inverse_warp=(1/den,anchor[0]*beta/den,-anchor[0]*beta*anchor[1]/den,
              0,(1+anchor[1]*beta)/den,-beta*anchor[1]**2/den,0,beta/den)
def project_cell(im,k,origin):
    # Inverse affine keeps fractional 1.4*0.8 scale and anchor without rounding.
    cell=im.transform((CELL,CELL),Image.Transform.AFFINE,
        (1/k,0,origin[0]-anchor[0]/k,0,1/k,origin[1]-anchor[1]/k),
        resample=Image.Resampling.BICUBIC)
    return cell.transform((CELL,CELL),Image.Transform.PERSPECTIVE,inverse_warp,
                           resample=Image.Resampling.BICUBIC)
source_cells={n:[project_cell(im,scale,reference_anchor) for im in source[n]] for n in names}
model_cells={n:[project_cell(im,model_scale,model_anchor) for im in render[n]] for n in names}

frames=[]
for f in range(150):
    t=f*.04
    board=Image.new('RGB',(640,688),(20,29,30))
    d=ImageDraw.Draw(board)
    d.text((14,9),'六組動作 · 原圖／銀盔 3D · 遊戲一般視窗大小',font=font,fill=(231,236,236))
    d.text((14,36),'請以 100% 檢視｜一般鏡頭 0.8×｜SE 方向｜固定身高及腳點',font=small,fill=(175,193,193))
    d.text((14,56),'完整起手與收招，依原速重播；非循環動作末幀停留方便比較',font=small,fill=(151,172,173))
    for i,name in enumerate(names):
        x=(i%2)*320; y=86+(i//2)*200
        d.rounded_rectangle((x+3,y+2,x+317,y+196),radius=6,fill=(27,38,38),outline=(55,72,72))
        d.text((x+12,y+8),labels[name],font=font,fill=(222,231,229))
        d.text((x+73,y+13),'原圖',font=small,fill=(164,183,182))
        d.text((x+226,y+13),'銀盔 3D',font=small,fill=(178,201,215))
        clip=m['clips'][name]
        duration=clip['duration']
        hold=0 if clip['loop'] else (.75 if name=='die' else .3)
        local=min(t%(duration+hold),duration-.000001)
        sf=min(len(source[name])-1,int(local*definition['anims'][name]['fps']))
        nf=min(range(len(clip['renderedFrames'])),
               key=lambda j:abs((clip['renderedFrames'][j]-1)/clip['fps']-local))
        d.line((x+160,y+37,x+160,y+187),fill=(46,62,62))
        # Shared ground-marker and frame geometry, no resizing after composition.
        for col,im in enumerate([source_cells[name][sf],model_cells[name][nf]]):
            xx=x+col*160; yy=y+34
            d.line((xx+70,yy+117,xx+90,yy+117),fill=(58,80,75))
            board.paste(im,(xx,yy),im)
    frames.append(board)

# A palette drawn from full-size frames preserves tiny silver/skin silhouettes.
sampler=Image.new('RGB',(640*6,688))
for i in range(6):sampler.paste(frames[i*23],(640*i,0))
palette=sampler.quantize(colors=256)
indexed=[im.quantize(palette=palette,dither=Image.Dither.NONE) for im in frames]
prefix=m['previewPrefix']
gif=root/(prefix+'_six_game_compare.gif')
indexed[0].save(gif,save_all=True,append_images=indexed[1:],duration=40,loop=0,disposal=2,optimize=False)
frames[0].save(root/(prefix+'_six_game_compare.png'))
# Optional readable enlargement, explicitly separate from the 1x comparison.
frames[0].resize((1280,1376),Image.Resampling.NEAREST).save(root/(prefix+'_compare_2x.png'))
report={'result':'PASS','direction':'SE','originalScale':definition['scale'],
    'cameraDistancePercent':distance,'cameraZoom':zoom,'effectiveSpriteScale':scale,
    'battlePanelHeightCssPx':a.battle_height,'perspectiveTopScale':top_scale,
    'referenceOpaqueIdleBounds':reference_bounds,'referenceIdleHeightBeforePerspectivePx':reference_height*scale,
    'modelStandingProjectionPixels':projection['standingBodyHeightPixels'],
    'modelScalePixelsPerRenderedPixel':model_scale,'modelAnchorPixels':model_anchor,
    'fixedScaleAndAnchorAcrossSixActions':True,'sourcePixelAssetsInModel':False,
    'timing':'Full 15 reference frames at source fps; first-frame game skip intentionally not applied',
    'limitations':'Reconstructed ordinary panel at player centre, CSS/browser zoom 100%; fullscreen adds 1.3x, panel height changes mild perspective. No live-game integration.',
    'gif':gif.name,'size':[640,688],'frames':150,'durationMs':6000}
with Image.open(gif) as check:
    assert check.size==(640,688) and check.n_frames==150
    duration=0
    for j in range(check.n_frames):check.seek(j);duration+=check.info['duration']
    assert duration==6000
(root/'game-comparison-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
