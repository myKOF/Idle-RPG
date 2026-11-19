"""Create review GIFs from captured, unretouched GLB frames. python encode.py FRAME_ROOT OUTPUT"""
from pathlib import Path
import sys,json
from PIL import Image,ImageDraw,ImageFont
root,out=map(Path,sys.argv[1:3]);out.mkdir(parents=True,exist_ok=True)
for name in ['Walk','Attack1','Attack2','Attack3','Die']:
    files=sorted((root/name).glob('*.png'))
    frames=[Image.open(f).convert('RGB') for f in files]
    if name!='Die':frames=frames[:-1]
    # One palette per whole clip prevents palette shimmer, including the ignition colors.
    samples=frames[::max(1,len(frames)//20)]
    atlas=Image.new('RGB',(240*len(samples),150))
    for i,image in enumerate(samples):atlas.paste(image.resize((240,150)),(i*240,0))
    palette=atlas.quantize(colors=256,method=Image.Quantize.MEDIANCUT)
    quantized=[im.quantize(palette=palette,dither=Image.Dither.FLOYDSTEINBERG) for im in frames]
    # GIF stores centiseconds: 30/30/40ms, not 33ms rounded down on every frame.
    delays=[30 if i%3!=2 else 40 for i in range(len(frames))]
    # Hold the final side-lying frame for review; this does not alter the 2.5s animation.
    if name=='Die':delays[-1]=800
    quantized[0].save(out/(name+'.gif'),save_all=True,append_images=quantized[1:],duration=delays,loop=0,optimize=True,disposal=1)
    with Image.open(out/(name+'.gif')) as gif:
        duration=0
        for i in range(gif.n_frames):gif.seek(i);duration+=gif.info['duration']
        assert duration=={'Walk':1600,'Attack1':1500,'Attack2':1200,'Attack3':3000,'Die':3300}[name],(name,duration)
        assert gif.info['loop']==0
    print('GIF',name,len(frames),duration,(out/(name+'.gif')).stat().st_size,flush=True)
