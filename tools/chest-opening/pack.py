"""Pack Blender renders without altering their pixels; emit lossless WebP sheets."""
import json
import sys
from pathlib import Path
from PIL import Image

root = Path(sys.argv[1]).resolve()
names = ('bronze', 'fine', 'epic', 'legendary', 'mythic')
web = root/'web'
web.mkdir(exist_ok=True)
for name in names:
    sheet = Image.new('RGBA',(1600,1600))
    frames = []
    for i in range(25):
        image = Image.open(root/'bake'/name/(str(i).zfill(2)+'.png')).convert('RGBA')
        assert image.size == (320,320)
        assert image.getchannel('A').getextrema()[0] == 0
        sheet.paste(image,((i%5)*320,(i//5)*320))
        frames.append(image)
    file = web/(name+'.webp')
    sheet.save(file,lossless=True,method=6,exact=True)
    with Image.open(file) as packed:
        for i,image in enumerate(frames):
            tile=packed.crop(((i%5)*320,(i//5)*320,(i%5+1)*320,(i//5+1)*320)).convert('RGBA')
            assert tile.tobytes() == image.tobytes(),name+' frame '+str(i)
    print(name, '25 lossless frames',file.stat().st_size,'bytes')
