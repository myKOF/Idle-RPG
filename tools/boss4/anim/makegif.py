import sys, glob, os
from PIL import Image, ImageDraw, ImageFont
d, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
views = sys.argv[4].split(","); labels = sys.argv[5].split(",")
F = ImageFont.truetype(r"C:\Windows\Fonts\msjh.ttc", 20)
nums = sorted({int(os.path.basename(p).split("_")[-1][:3]) for p in glob.glob(f"{d}/{views[0]}_*.png")})
frames = []
for i, n in enumerate(nums):
    ims = [Image.open(f"{d}/{v}_{n:03d}.png").convert("RGB") for v in views]
    w, h = ims[0].size; top = 34
    S = Image.new("RGB", (w * len(ims), h + top), (18, 18, 22)); dr = ImageDraw.Draw(S)
    for j, im in enumerate(ims):
        S.paste(im, (j * w, top)); dr.text((j * w + 10, top + 6), labels[j], font=F, fill=(200, 220, 255))
    dr.text((10, 6), title, font=F, fill=(255, 214, 140)); dr.text((S.size[0] - 70, 6), f"f{n:02d}", font=F, fill=(150, 150, 150))
    frames.append(S.quantize(colors=96))
frames[0].save(out, save_all=True, append_images=frames[1:], duration=42, loop=0, optimize=True)
print(out, len(frames), os.path.getsize(out))
