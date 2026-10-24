"""Honest, size-matched static comparisons and validation of the delivered GLB."""
import argparse
import hashlib
import json
import math
import struct
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

p=argparse.ArgumentParser()
p.add_argument('--preview',required=True)
p.add_argument('--asset',default='assets/characters/knight3d/makehuman-r6')
a=p.parse_args();root=Path(a.preview).resolve();asset=Path(a.asset)
metrics=json.loads((root/'static-validation.json').read_text())
definition=json.loads(Path('images/sprites/knight/knight.json').read_text())
tr=definition['anims']['idle']['trim']
sheet=Image.open('images/sprites/knight/idle.png').convert('RGBA')
original=Image.new('RGBA',(128,128))
original.paste(sheet.crop((0,tr['h'],tr['w'],2*tr['h'])),(tr['x'],tr['y']))
ob=original.getchannel('A').point(lambda v:255 if v>245 else 0).getbbox()
mb=metrics['views']['reference']['bounds']
height=500;rs=height/(ob[3]-ob[1]);ms=height/(mb[3]-mb[1])
bg=(32,39,41)
font=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',24)
small=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',17)

def model(view,size,baseline,scale=ms):
    im=Image.open(root/(view+'.png')).convert('RGBA')
    bounds=im.getchannel('A').point(lambda v:255 if v>8 else 0).getbbox()
    assert bounds and bounds[0]>0 and bounds[1]>0 and bounds[2]<900 and bounds[3]<900
    # Only the comparison sheet gets these soft grounding shadows.
    shadow=Image.new('RGBA',im.size);d=ImageDraw.Draw(shadow)
    pts=metrics['views'][view]['contacts']
    cx=sum(q[0] for q in pts)/2;cy=sum(q[1] for q in pts)/2
    radius=max(30,abs(pts[0][0]-pts[1][0])/2+20)
    d.ellipse((cx-radius,cy-14,cx+radius,cy+14),fill=(0,0,0,70))
    for x,y in pts:d.ellipse((x-16,y-5,x+16,y+5),fill=(0,0,0,90))
    im=Image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(3)),im)
    bottom=metrics['views'][view]['bounds'][3]
    return im.transform(size,Image.Transform.AFFINE,
        (1/scale,0,450-size[0]/2/scale,0,1/scale,bottom-baseline/scale),
        resample=Image.Resampling.BICUBIC)

board=Image.new('RGB',(1200,800),bg);d=ImageDraw.Draw(board)
d.text((24,15),'MakeHuman＋Blender · 重新製作的第一版靜態造型',font=font,fill=(233,238,239))
d.text((24,51),'原版圖集對照｜同頭腳高度500px｜保留頭盔｜先確認造型，再製作動作',font=small,fill=(181,198,202))
d.line((600,95,600,750),fill=(61,76,80))
d.text((30,97),'原版 SE 待機 · 原始像素放大',font=small,fill=(193,203,204))
d.text((625,97),'新版 · 實際 Blender 成品渲染',font=small,fill=(193,211,216))
ref=original.transform((600,630),Image.Transform.AFFINE,
    (1/rs,0,64-300/rs,0,1/rs,ob[3]-550/rs),resample=Image.Resampling.NEAREST)
board.paste(ref,(0,130),ref)
im=model('reference',(600,630),550);board.paste(im,(600,130),im)
d.text((24,766),'原圖的盾牌／陰影保留供參考；新版無盾牌、無刀光。本圖為靜態造型審查，尚未替換遊戲主角。',font=small,fill=(161,180,184))
board.save(root/'knight_makehuman_original_compare.png')
detail=Image.new('RGB',(1200,490),bg);detail.paste(board.crop((0,145,1200,565)),(0,55))
ImageDraw.Draw(detail).text((24,15),'胸肩／手臂／腰胯 · 同一比例的局部對照',font=font,fill=(233,238,239))
detail.save(root/'knight_makehuman_upperbody.png')
views=Image.new('RGB',(1500,850),bg);d=ImageDraw.Draw(views)
d.text((24,15),'同一模型與姿勢 · 正面／側面／背面',font=font,fill=(233,238,239))
for i,(view,label) in enumerate([('front','正面'),('side','側面'),('back','背面')]):
    d.text((500*i+25,56),label,font=small,fill=(188,205,211))
    im=model(view,(500,740),650,ms*1.08);views.paste(im,(500*i,90),im)
views.save(root/'knight_makehuman_views.png')
mini=Image.new('RGB',(470,215),bg);d=ImageDraw.Draw(mini)
d.text((16,12),'遊戲尺寸檢查 · 頭腳高度約56px',font=small,fill=(220,229,232))
s=56/(ob[3]-ob[1]);m=56/(mb[3]-mb[1])
ref=original.transform((160,140),Image.Transform.AFFINE,
    (1/s,0,64-80/s,0,1/s,ob[3]-106/s),resample=Image.Resampling.NEAREST)
mini.paste(ref,(45,50),ref)
im=model('reference',(160,140),106,m);mini.paste(im,(265,50),im)
d.text((100,185),'原版',font=small,fill=(188,205,211))
d.text((320,185),'新版',font=small,fill=(188,205,211))
mini.save(root/'knight_makehuman_game_size.png')

# Validate the actual file; do not infer runtime structure from Blender counts.
data=(asset/'knight_makehuman.glb').read_bytes()
magic,version,total=struct.unpack_from('<III',data)
assert magic==0x46546c67 and version==2 and total==len(data)
jl,jtype=struct.unpack_from('<II',data,12);j=json.loads(data[20:20+jl])
assert jtype==0x4e4f534a
bl,btype=struct.unpack_from('<II',data,20+jl);binary=data[28+jl:28+jl+bl]
assert btype==0x004e4942
assert len(j['meshes'])==len(j['materials'])==1
assert not j.get('animations') and not j.get('skins')
assert len(j['meshes'][0]['primitives'])==1
primitive=j['meshes'][0]['primitives'][0]
accessors=j['accessors'];triangles=accessors[primitive['indices']]['count']//3
assert triangles<=12000,('Budget exceeded',triangles)
assert len(j['textures'])==2 and all('bufferView' in x for x in j['images'])
assert all(j['samplers'][t['sampler']]['magFilter']==9728 for t in j['textures'])
pa=accessors[primitive['attributes']['POSITION']];pv=j['bufferViews'][pa['bufferView']]
posoffset=pv.get('byteOffset',0)+pa.get('byteOffset',0)
stride=pv.get('byteStride',12)
for i in range(pa['count']):
    assert all(math.isfinite(v) for v in struct.unpack_from('<fff',binary,posoffset+i*stride))
ia=accessors[primitive['indices']];iv=j['bufferViews'][ia['bufferView']]
fmt={5121:'B',5123:'H',5125:'I'}[ia['componentType']];width=struct.calcsize(fmt)
offset=iv.get('byteOffset',0)+ia.get('byteOffset',0)
for i in range(ia['count']):assert struct.unpack_from('<'+fmt,binary,offset+i*width)[0]<pa['count']
frozen={}
for folder,names in [('', ['knight_batch1.blend','knight_batch1.glb','manifest.json']),
                     ('lookdev-r5/', ['knight_lookdev.blend','knight_lookdev.glb','manifest.json'])]:
    for name in names:
        rel='assets/characters/knight3d/'+folder+name
        expected=subprocess.check_output(['git','show','HEAD:'+rel]);actual=Path(rel).read_bytes()
        assert json.loads(expected)==json.loads(actual) if name.endswith('.json') else expected==actual,rel
        frozen[rel]=hashlib.sha256(actual).hexdigest()
for rel in ['tools/knight3d/silver_knight_geometry.py','tools/knight3d/silver_knight_motion.py']:
    assert subprocess.check_output(['git','show','HEAD:'+rel]).replace(b'\r\n',b'\n')==Path(rel).read_bytes().replace(b'\r\n',b'\n'),rel
manifest=json.loads((asset/'manifest.json').read_text(encoding='utf-8'))
assert manifest['triangles']==triangles and manifest['actions']==0 and manifest['editableBones']==53
report={'result':'PASS','triangles':triangles,'glbBytes':len(data),'mesh':1,'primitive':1,'material':1,
    'textures':2,'skins':0,'animations':0,'staticReviewOnly':True,
    'referenceOpaqueBounds':ob,'matchedHeadToFootPx':height,'gameSizeHeadToFootPx':56,
    'originalPixelsNotRedrawn':True,'frozenCandidates':frozen,
    'limits':'Shape similarity is a visual/user judgment. No game replacement, animation or GPU-FPS validation.'}
(root/'package-validation.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
