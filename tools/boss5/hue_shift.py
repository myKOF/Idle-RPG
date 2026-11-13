"""Hue-shift a PNG (keeps alpha).   blender -b -P hue_shift.py -- in.png out.png <hue_degrees> [saturation_scale=1] [value_scale=1]
Used to recolour the green mini-skull sprite for the blue / purple mask variants."""
import bpy, sys, numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, deg = argv[0], argv[1], float(argv[2])
sat = float(argv[3]) if len(argv) > 3 else 1.0
val = float(argv[4]) if len(argv) > 4 else 1.0
img = bpy.data.images.load(src)
img.colorspace_settings.name = 'sRGB'
w, h = img.size
a = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(a)
a = a.reshape(-1, 4)
r, g, b = a[:, 0], a[:, 1], a[:, 2]
mx, mn = a[:, :3].max(1), a[:, :3].min(1)
d = mx - mn
hh = np.zeros_like(mx)
m = d > 1e-6
rc = m & (mx == r); gc = m & (mx == g) & ~rc; bc = m & ~rc & ~gc
hh[rc] = ((g - b)[rc] / d[rc]) % 6
hh[gc] = (b - r)[gc] / d[gc] + 2
hh[bc] = (r - g)[bc] / d[bc] + 4
hh = (hh * 60 + deg) % 360
s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0) * sat
v = mx * val
s = np.clip(s, 0, 1); v = np.clip(v, 0, 1)
c = v * s
x = c * (1 - np.abs((hh / 60) % 2 - 1))
mm = v - c
z = np.zeros_like(c)
sec = (hh // 60).astype(int)
R = np.select([sec == 0, sec == 1, sec == 2, sec == 3, sec == 4, sec == 5], [c, x, z, z, x, c])
G = np.select([sec == 0, sec == 1, sec == 2, sec == 3, sec == 4, sec == 5], [x, c, c, x, z, z])
B = np.select([sec == 0, sec == 1, sec == 2, sec == 3, sec == 4, sec == 5], [z, z, x, c, c, x])
a[:, 0] = R + mm; a[:, 1] = G + mm; a[:, 2] = B + mm
out = bpy.data.images.new('o', w, h, alpha=True)
out.colorspace_settings.name = 'sRGB'
out.pixels.foreach_set(a.ravel())
out.filepath_raw = dst
out.file_format = 'PNG'
out.save()
print('HUE', dst)
