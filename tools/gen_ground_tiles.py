# -*- coding: utf-8 -*-
"""可無縫拼接的地板貼圖產生器。

輸出 images/ground/*.png，由 js/battle-renderer.js 以 TilingSprite 平鋪。
正式美術圖到位後直接替換同名檔案即可（維持可四方連續、建議 128×128 或其倍數）。

刻意做得「淡」：地板只是襯底，對比太高會蓋過敵人與傷害數字。
所有花紋以模數運算繞回，保證上下左右接縫連續。

用法：python tools/gen_ground_tiles.py
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'images', 'ground')
SIZE = 128


def blend(base, over, a):
    return tuple(int(base[i] * (1 - a) + over[i] * a) for i in range(3))


def seamless_noise(size, seed, scale, low, high):
    """以正弦疊加做出可繞回的柔和雜訊（值域 0~1）。"""
    rnd = random.Random(seed)
    waves = []
    for _ in range(5):
        fx = rnd.choice([1, 2, 3, 4]) * scale
        fy = rnd.choice([1, 2, 3, 4]) * scale
        ph = rnd.random() * math.tau
        amp = rnd.uniform(0.5, 1.0)
        waves.append((fx, fy, ph, amp))
    total_amp = sum(w[3] for w in waves)
    grid = [[0.0] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            v = 0.0
            for fx, fy, ph, amp in waves:
                v += amp * math.sin(math.tau * fx * x / size + ph) * math.cos(math.tau * fy * y / size + ph)
            v = (v / total_amp + 1) / 2
            grid[y][x] = low + (high - low) * v
    return grid


def make_tile(name, base_rgb, speckle_rgb, seed, grout=True, crack=True):
    img = Image.new('RGB', (SIZE, SIZE), base_rgb)
    px = img.load()
    rnd = random.Random(seed)

    # 大面積明暗起伏：避免整片死板的純色
    noise = seamless_noise(SIZE, seed, 1, -0.05, 0.05)
    for y in range(SIZE):
        for x in range(SIZE):
            k = 1 + noise[y][x]
            px[x, y] = tuple(max(0, min(255, int(c * k))) for c in base_rgb)

    d = ImageDraw.Draw(img)

    # 接縫線（磚縫）：位置固定在邊界上，四方連續必定接得起來
    if grout:
        line = blend(base_rgb, (0, 0, 0), 0.28)
        d.line([(0, SIZE // 2), (SIZE, SIZE // 2)], fill=line, width=1)
        d.line([(SIZE // 2, 0), (SIZE // 2, SIZE // 2)], fill=line, width=1)
        d.line([(0, 0), (SIZE, 0)], fill=line, width=1)
        d.line([(0, 0), (0, SIZE)], fill=line, width=1)

    # 細裂紋：用模數包裝，跨邊界時自動接回另一側
    if crack:
        crack_col = blend(base_rgb, (0, 0, 0), 0.18)
        for _ in range(6):
            cx, cy = rnd.randrange(SIZE), rnd.randrange(SIZE)
            ang = rnd.random() * math.tau
            for _ in range(rnd.randint(12, 26)):
                ang += rnd.uniform(-0.5, 0.5)
                cx = (cx + math.cos(ang) * 3) % SIZE
                cy = (cy + math.sin(ang) * 3) % SIZE
                px[int(cx), int(cy)] = crack_col

    # 砂點：兩種亮度，讓平鋪時不會一眼看出重複
    for _ in range(SIZE * 6):
        x, y = rnd.randrange(SIZE), rnd.randrange(SIZE)
        a = rnd.uniform(0.05, 0.20)
        px[x, y] = blend(px[x, y], speckle_rgb, a)
    for _ in range(SIZE * 2):
        x, y = rnd.randrange(SIZE), rnd.randrange(SIZE)
        px[x, y] = blend(px[x, y], (0, 0, 0), rnd.uniform(0.05, 0.18))

    img = img.filter(ImageFilter.SMOOTH)
    os.makedirs(os.path.abspath(OUT_DIR), exist_ok=True)
    path = os.path.join(os.path.abspath(OUT_DIR), name + '.png')
    img.save(path)
    print('wrote', path, img.size)


def main():
    # 一張通用底圖 + 各地圖色調。渲染器找不到地圖專屬圖時退回 ground_default。
    make_tile('ground_default', (58, 58, 66), (150, 152, 165), 20260812)
    make_tile('ground_desert', (86, 72, 48), (198, 176, 128), 1001)
    make_tile('ground_Icefield', (60, 76, 92), (176, 206, 228), 1002)
    make_tile('ground_swamp', (54, 70, 54), (150, 184, 140), 1003)
    make_tile('ground_undead_mountains', (64, 56, 72), (168, 152, 186), 1004)
    make_tile('ground_god_battlefield', (74, 58, 78), (200, 168, 206), 1005)
    make_tile('ground_god_chaos', (66, 52, 84), (186, 158, 214), 1006)
    make_tile('ground_god_sanctuary', (58, 66, 84), (170, 186, 216), 1007)


if __name__ == '__main__':
    main()
