"""Layered, tapered water sheets with depth-sorted rotating crescent crests."""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np
from pathlib import Path
import math

OUT=Path(__file__).parent
S=640
COUNT=80
TAU=math.tau
y,x=np.mgrid[0:S,0:S].astype(np.float32)
qgrid=(y-8)/578
rng=np.random.default_rng(114)
SHEETS=[]
for j in range(22):
    SHEETS.append((.015+j/22*.985+rng.uniform(-.019,.019),
                   rng.uniform(-.65,.65),rng.uniform(1.7,3.8),
                   rng.uniform(.032,.067),rng.uniform(.6,1.2),rng.uniform(0,TAU)))

def shape(q,p):
    q=np.asarray(q)
    c=320+13*np.sin(q*7+p)*np.sin(np.pi*np.clip(q,0,1))+9*np.sin(q*12-p)
    r=70+70*(2*q-1)**2
    r=r*(1+.026*np.sin(q*29-p*2))
    return c,r

def body(p):
    q=np.clip(qgrid,0,1)
    c,r=shape(q,p)
    # The continuous water volume extends underneath the projecting sheets,
    # including the regions that previously exposed black between their edges.
    u=(x-c)/(r*1.11)
    a=np.arcsin(np.clip(u,-1,1))
    flow=q*29+a*2+p*2+.23*np.sin(q*69+a*6+p*3)
    surf=np.clip((np.sin(flow)+.3)/1.3,0,1)**2
    fine=np.clip(np.sin(flow*3+.7*np.sin(q*93+a*8-p*2)),0,1)**7
    mask=np.clip((1-np.abs(u))/.16,0,1)*np.clip((1.035-qgrid)/.085,0,1)*np.clip((qgrid+.045)/.06,0,1)
    crossflow=np.clip((np.sin(q*19+a*3.2+p*2+.4*np.sin(q*43+p))+.35)/1.35,0,1)**1.4
    shade=.82+.18*np.cos(a*1.7)
    # Saturated blue, rather than near-black, is the lowest interior value.
    # Two moving blue strata preserve depth without a flat cyan flood fill.
    rgb=np.stack([(5+surf*7+crossflow*9)*mask,
                  (40+surf*72+crossflow*29+fine*8)*mask*shade,
                  (133+surf*77+crossflow*26+fine*12)*mask*shade],axis=-1)
    alpha=mask*(.90+.08*surf)
    # Fill the bottom pool as a water surface, including the gaps in its arcs.
    dx=(x-320)/150
    dy=(y-595)/36
    radial=np.sqrt(dx*dx+dy*dy)
    poolmask=np.clip((1-radial)/.19,0,1)
    angle=np.arctan2(dy,dx)
    swirl=np.clip(np.sin(radial*13-angle*2-p*2),0,1)**2
    pool=np.stack([(4+swirl*4)*poolmask,(33+swirl*34)*poolmask,(112+swirl*66)*poolmask],axis=-1)
    rgb=np.maximum(rgb,pool)
    alpha=np.maximum(alpha,poolmask*.96)
    return rgb,alpha

def sheet(spec,p):
    q0,off,arc,width,gain,seed=spec
    s=np.linspace(0,1,96)
    angle=-q0*21+off-p*2+(s-.5)*arc
    rising=((q0-p/TAU)%1)*1.20-.10
    fade=float(np.clip((rising+.10)/.12,0,1)*np.clip((1.10-rising)/.12,0,1))
    q=rising+(s-.5)*arc*.057
    q+=.003*np.sin(s*16+seed+p*2)
    c,r=shape(q,p)
    flare=1+.065*np.sin(s*np.pi)**2+.06*(s**5)
    xx=c+r*flare*np.cos(angle)
    yy=8+q*578+r*.13*np.sin(angle)
    front=np.sin(angle)
    taper=np.sin(np.pi*s)**1.3
    # Unequal edges produce long pointed leaves rather than round light patches.
    tear=.79+.19*np.sin(s*23+seed)+.12*np.sin(s*61+seed*2)
    thick=578*width*taper*tear*(.8+.3*np.cos(angle))*(1+.35*np.sin(np.pi*np.clip(q,0,1)))
    return s,xx,yy,front,thick,gain,seed,fade

def paint_sheet(canvas,data,front_pass):
    s,xx,yy,front,thick,gain,seed,fade=data
    slab=Image.new('RGBA',(S,S),(0,0,0,0))
    d=ImageDraw.Draw(slab)
    for k in range(len(s)-1):
        z=float((front[k]+front[k+1])*.5)
        if (z>0)!=front_pass: continue
        vis=max(0,min(1,(z+.16)/1.16))
        face=(.35+.65*vis)*gain
        # A broad cobalt/cyan sheet, then a swept-back, sharp white crest.
        polygon=[(xx[k],yy[k]-thick[k]*.23),(xx[k+1],yy[k+1]-thick[k+1]*.23),
                 (xx[k+1]+thick[k+1]*.19,yy[k+1]+thick[k+1]),
                 (xx[k]+thick[k]*.19,yy[k]+thick[k])]
        d.polygon(polygon,fill=(3,int(55+125*face),int(145+100*min(1,face)),int((155+90*vis if front_pass else 50)*fade)))
        # Each sheet has its own crest length. Narrow streamers run off its tips.
        env=max(0,math.sin(math.pi*float(s[k])))
        peak=(.55+.45*math.sin(seed+float(s[k])*4))
        specular=max(0,min(1,(z-.06)*1.7))*peak
        w=thick[k]*(.16+.68*specular)*env
        wn=thick[k+1]*(.16+.68*specular)*env
        if front_pass:
            bright=max(0,min(1,specular*1.7))
            color=(int(20+235*bright),int(160+95*bright),255,int((130+125*bright)*fade))
            d.polygon([(xx[k],yy[k]),(xx[k+1],yy[k+1]),
                       (xx[k+1]+wn*.55,yy[k+1]+wn),(xx[k]+w*.55,yy[k]+w)],fill=color)
            if env>.2 and specular>.25:
                d.line([(xx[k],yy[k]-.6),(xx[k+1],yy[k+1]-.6)],
                       fill=(185,241,255,int((90+130*specular)*fade)),width=1)
    canvas.paste(Image.alpha_composite(canvas.convert('RGBA'),slab).convert('RGB'))

def outer_ribbons(canvas,p,front_pass):
    veil=Image.new('RGBA',(S,S),(0,0,0,0))
    d=ImageDraw.Draw(veil)
    for j in range(17):
        h=((j/17-p/TAU)%1)*1.20-.10
        fade=float(np.clip((h+.1)/.12,0,1)*np.clip((1.1-h)/.12,0,1))
        s=np.linspace(0,1,130)
        a=-j*2.39-p*2+(s-.5)*(3.3+(j%3)*.3)
        q=h+(s-.5)*.17
        c,r=shape(q,p)
        rr=r*(1.21+.23*np.sin(s*np.pi)**2)+10+(s**3)*(13+j%4*5)
        xx=c+rr*np.cos(a)
        yy=8+q*578+rr*.15*np.sin(a)
        width=(4+j%3*2.5)*np.sin(s*np.pi)**1.5
        for k in range(len(s)-1):
            z=float(np.sin((a[k]+a[k+1])*.5))
            if (z>0)!=front_pass: continue
            taper=float(np.sin(np.pi*s[k])**.6)
            alpha=int((60+76*max(0,z))*fade*taper)
            if not front_pass: alpha=int(alpha*.48)
            d.polygon([(xx[k],yy[k]),(xx[k+1],yy[k+1]),
                       (xx[k+1]+width[k+1]*.4,yy[k+1]+width[k+1]),
                       (xx[k]+width[k]*.4,yy[k]+width[k])],fill=(131,216,255,alpha))
            if front_pass and j%3==0:
                d.line([(xx[k],yy[k]),(xx[k+1],yy[k+1])],fill=(193,235,255,int(alpha*.68)),width=1)
    canvas.paste(Image.alpha_composite(canvas.convert('RGBA'),veil.filter(ImageFilter.GaussianBlur(.45))).convert('RGB'))

def outer_halo(p):
    q=np.clip(qgrid,0,1)
    c,r=shape(q,p)
    distance=np.abs(x-c)-r*1.01
    band=np.exp(-np.maximum(distance,0)/28)
    band*=np.clip((distance+17)/20,0,1)
    band*=np.clip((1.05-qgrid)/.09,0,1)*np.clip((qgrid+.06)/.08,0,1)
    band*=.82+.18*np.sin(q*17+p*2)
    # A broad blue atmospheric veil surrounds the tighter cyan edge light.
    wide=np.exp(-np.maximum(distance,0)/49)*np.clip((distance+6)/19,0,1)
    wide*=np.clip((1.05-qgrid)/.09,0,1)*np.clip((qgrid+.06)/.08,0,1)
    rgb=np.stack([band*12+wide*2,band*46+wide*10,band*78+wide*29],axis=-1)
    return Image.fromarray(np.uint8(np.clip(rgb,0,255)))

def render(i):
    p=TAU*i/COUNT
    layers=[sheet(spec,p) for spec in SHEETS]
    back=outer_halo(p)
    outer_ribbons(back,p,False)
    for layer in layers: paint_sheet(back,layer,False)
    rgb,alpha=body(p)
    rgb=np.asarray(back).astype(float)*(1-alpha[:,:,None])+rgb
    water=Image.fromarray(np.uint8(np.clip(rgb,0,255)))
    for layer in sorted(layers,key=lambda a:float(np.mean(a[3]))): paint_sheet(water,layer,True)
    outer_ribbons(water,p,True)
    # A low, irregular fan of water replaces the concentric target-like base.
    base=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(base)
    for j in range(6):
        s=np.linspace(0,1,110)
        a=s*3.9-p*2+j*1.31
        rr=(58+j*16)*(1+.075*np.sin(a*4+p))
        xx=320+rr*np.cos(a); yy=599+rr*.145*np.sin(a)
        w=np.sin(s*np.pi)**1.5*(11+j*.8)*(1+.3*np.sin(s*17+j))
        coords=list(zip(xx,yy))+list(zip((xx+w*.7)[::-1],(yy+w)[::-1]))
        d.polygon(coords,fill=(4,75+j*8,170+j*7,95+j*8))
        if j%3==0:
            d.line(list(zip(xx[25:80],yy[25:80])),fill=(90,210,255,170),width=2)
    water=Image.alpha_composite(water.convert('RGBA'),base).convert('RGB')
    # Bloom is derived from the bright surface; deep-blue water keeps its value.
    raw=np.asarray(water).astype(float)
    hot=Image.fromarray(np.uint8(np.clip((raw-90)*1.6,0,255)))
    water=water.filter(ImageFilter.GaussianBlur(.35))
    water=ImageChops.add(water,hot.filter(ImageFilter.GaussianBlur(5)).point(lambda v:int(v*.48)))
    water=ImageChops.add(water,hot.filter(ImageFilter.GaussianBlur(17)).point(lambda v:int(v*.26)))
    dust=Image.new('RGBA',(S,S),(0,0,0,0))
    rng=np.random.default_rng(208)
    for j in range(46):
        life=(i/COUNT+rng.random())%1
        side=-1 if rng.random()<.5 else 1
        xx=320+side*(42+life*rng.uniform(45,105))+rng.uniform(-18,18)
        yy=594-life*rng.uniform(25,65)
        radius=8+life*rng.uniform(16,30)
        puff=Image.new('RGBA',(S,S),(0,0,0,0)); pd=ImageDraw.Draw(puff)
        pd.ellipse((xx-radius,yy-radius*.5,xx+radius,yy+radius*.5),fill=(108,134,154,int(22*math.sin(math.pi*life)**1.3)))
        dust=Image.alpha_composite(dust,puff)
    water=Image.alpha_composite(water.convert('RGBA'),dust.filter(ImageFilter.GaussianBlur(5))).convert('RGB')
    spray=Image.new('RGB',(S,S)); d=ImageDraw.Draw(spray)
    for j in range(120):
        life=(i/COUNT*2+rng.random())%1
        h=rng.uniform(.1,.97); side=-1 if rng.random()<.5 else 1
        c,r=shape(h,p)
        xx=c+side*(r*.86+life*rng.uniform(12,80))
        yy=8+h*578-life*rng.uniform(10,45)+life*life*30
        strength=math.sin(math.pi*life)**1.5*rng.uniform(.25,.7)
        length=rng.uniform(2,8)
        d.line((xx,yy,xx-side*length,yy+length*.4),fill=(int(105*strength),int(210*strength),int(255*strength)),width=1)
    return ImageChops.add(water,spray)

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description='Render the approved original water tornado as a transparent flipbook. Requires Pillow and NumPy.')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    atlas=Image.new('RGBA',(320*8,320*10))
    for i in range(COUNT):
        rgb=np.asarray(render(i)).astype(float)/255
        # Unpremultiply our own black-composited procedural output. On black,
        # normal blending exactly reconstructs the approved color hierarchy.
        alpha=np.clip(np.max(rgb,axis=2)*1.6,0,1)
        color=np.divide(rgb,alpha[:,:,None],out=np.zeros_like(rgb),where=alpha[:,:,None]>0)
        rgba=np.dstack([np.clip(color,0,1),alpha])
        frame=Image.fromarray(np.uint8(rgba*255)).resize((320,320),Image.Resampling.LANCZOS)
        atlas.paste(frame,((i%8)*320,(i//8)*320))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    atlas.save(args.output)
    print('Saved transparent 8x10 atlas:',args.output)
