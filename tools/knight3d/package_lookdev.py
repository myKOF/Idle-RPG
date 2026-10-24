"""Large, static original/new armor comparison from real Blender renders."""
import argparse,json,struct,hashlib,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter

p=argparse.ArgumentParser();p.add_argument('--preview',required=True)
p.add_argument('--asset',default='assets/characters/knight3d/lookdev-r5')
a=p.parse_args();root=Path(a.preview).resolve();asset=Path(a.asset)
metrics=json.loads((root/'static-validation.json').read_text())
definition=json.loads(Path('images/sprites/knight/knight.json').read_text())
tr=definition['anims']['idle']['trim'];sheet=Image.open('images/sprites/knight/idle.png').convert('RGBA')
original=Image.new('RGBA',(128,128));original.paste(sheet.crop((0,tr['h'],tr['w'],tr['h']*2)),(tr['x'],tr['y']))
bounds=original.getchannel('A').point(lambda v:255 if v>245 else 0).getbbox()
target=500;reference_scale=target/(bounds[3]-bounds[1])
groups=metrics['views']['reference']['groups']
top=groups['head'][1];bottom=max(groups[n][3] for n in ['foot.R','foot.L'])
model_scale=target/(bottom-top)
font=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',24)
small=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',17)
bg=(32,39,41)

def draw_model(view,size=(550,650),height=560):
    im=Image.open(root/(view+'.png')).convert('RGBA')
    mask=im.getchannel('A').point(lambda v:255 if v>8 else 0).getbbox()
    assert mask and mask[0]>0 and mask[1]>0 and mask[2]<im.width and mask[3]<im.height
    # A subtle presentation shadow uses the actual static foot projections.
    shadow=Image.new('RGBA',im.size);sd=ImageDraw.Draw(shadow)
    pts=metrics['views'][view]['contacts'];cx=sum(q[0] for q in pts)/2;cy=sum(q[1] for q in pts)/2
    radius=max(50,abs(pts[0][0]-pts[1][0])/2+18)
    sd.ellipse((cx-radius,cy-16,cx+radius,cy+16),fill=(0,0,0,80))
    for x,y in pts:sd.ellipse((x-15,y-5,x+15,y+5),fill=(0,0,0,105))
    shadow=shadow.filter(ImageFilter.GaussianBlur(2))
    im=Image.alpha_composite(shadow,im)
    view_groups=metrics['views'][view]['groups']
    view_bottom=max(view_groups[n][3] for n in ['foot.R','foot.L'])
    return im.transform(size,Image.Transform.AFFINE,(1/model_scale,0,360-size[0]/2/model_scale,
        0,1/model_scale,view_bottom-height/model_scale),resample=Image.Resampling.BICUBIC)

board=Image.new('RGB',(1100,760),bg);d=ImageDraw.Draw(board)
d.text((22,13),'造型靜態審查 · 原圖／新版銀甲',font=font,fill=(234,237,238))
d.text((22,48),'同頭腳高度放大｜保留頭盔｜本輪不調整六組動作',font=small,fill=(174,193,196))
d.text((30,94),'原圖 SE · 原始像素放大，沒有補畫細節',font=small,fill=(188,200,201))
d.text((580,94),'新版 · Blender 實際模型渲染',font=small,fill=(188,205,215))
d.line((550,90,550,732),fill=(61,75,77))
source=original.transform((550,640),Image.Transform.AFFINE,
    (1/reference_scale,0,64-275/reference_scale,0,1/reference_scale,bounds[3]-550/reference_scale),
    resample=Image.Resampling.NEAREST)
board.paste(source,(0,120),source)
model=draw_model('reference',(550,640),550);board.paste(model,(550,120),model)
board.save(root/'knight_r5_original_static_compare.png')
detail=board.crop((0,120,1100,510))
canvas=Image.new('RGB',(1100,445),bg);canvas.paste(detail,(0,55));d=ImageDraw.Draw(canvas)
d.text((20,13),'胸肩／手臂／腰胯 · 靜態細節對照',font=font,fill=(231,237,239))
canvas.save(root/'knight_r5_upperbody_compare.png')
views=Image.new('RGB',(1500,840),bg);d=ImageDraw.Draw(views)
d.text((22,12),'新版銀甲 · 正／側／背面 · 同一靜態姿勢與固定模型比例',font=font,fill=(231,237,239))
for i,(name,label) in enumerate([('front','正面'),('side','側面'),('back','背面')]):
    im=draw_model(name,(500,760),670);views.paste(im,(i*500,75),im)
    d.text((i*500+22,55),label,font=small,fill=(185,200,209))
views.save(root/'knight_r5_static_views.png')

# Inspect the delivered GLB itself: static baked geometry, no accidental clips.
data=(asset/'knight_lookdev.glb').read_bytes()
assert data[:4]==b'glTF'
length,kind=struct.unpack_from('<II',data,12);j=json.loads(data[20:20+length])
assert len(j['meshes'])==1 and len(j['materials'])==1
assert not j.get('animations') and not j.get('skins')
assert len(j['meshes'][0]['primitives'])==1
primitive=j['meshes'][0]['primitives'][0]
triangles=j['accessors'][primitive['indices']]['count']//3
assert triangles<=12000,('Static candidate budget exceeded',triangles)
frozen={}
for name in ['knight_batch1.blend','knight_batch1.glb','manifest.json']:
    rel='assets/characters/knight3d/'+name
    expected=subprocess.check_output(['git','show','HEAD:'+rel]);actual=Path(rel).read_bytes()
    if name.endswith('.json'):
        assert json.loads(actual)==json.loads(expected),('Frozen animation metadata changed',rel)
    else:
        assert actual==expected,('Frozen animation candidate changed',rel)
    frozen[rel]=hashlib.sha256(actual).hexdigest()
for rel in ['tools/knight3d/silver_knight_geometry.py','tools/knight3d/silver_knight_motion.py']:
    expected=subprocess.check_output(['git','show','HEAD:'+rel]).replace(b'\r\n',b'\n')
    assert Path(rel).read_bytes().replace(b'\r\n',b'\n')==expected,rel
report={'result':'PASS','staticOnly':True,'originalDirection':'SE','originalFrame':0,
    'originalOpaqueBounds':bounds,'matchedHeadToFootPixels':target,
    'modelScale':model_scale,'noPerPartScaling':True,
    'geometry':{'triangles':triangles,'mesh':1,'primitive':1,'material':1,
                'textures':len(j.get('textures',[])),'glbBytes':len(data),'skins':0,'animations':0},
    'frozenAnimationCandidateSha256':frozen,
    'limitations':'Original pixels enlarged without invented detail; static model review, no animation/fps integration. Soft grounding shadows are presentation-only.'}
(root/'static-package-validation.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report,indent=2))
