# -*- coding: utf-8 -*-
"""
storybook-paper.py — 繪本式序章的舊書頁紙張（原創程序生成，無外部素材）

輸出到 images/intro-storybook/：
  paper.webp       1920×1080 起的泛黃羊皮紙底（多層低頻斑駁＋纖維＋水漬圈），留邊給鏡頭移動
  paper-edge.webp  同尺寸的焦邊／暗角疊層（透明 webp），獨立一層方便和紙張分開控制

只依賴 Pillow（不需要 numpy）。固定亂數種子，重跑結果相同。
用法：python tools/intro/storybook-paper.py
"""
import os
import random
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'images', 'intro-storybook')
W, H = 2040, 1160          # 比 1920×1080 舞台四周多 60／40 px，鏡頭推移時不露邊
BASE = (222, 199, 152)     # 泛黃紙色
random.seed(20261111)


def noise_layer(cell, sigma, blur):
    """低解析雜訊放大＝大片斑駁。cell 越大斑塊越大。"""
    small = Image.effect_noise((max(2, W // cell), max(2, H // cell)), sigma)
    return small.resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(blur))


def tint(gray, dark, light):
    """灰階 → 兩色之間的漸層。"""
    return Image.merge('RGB', [gray.point(lambda v, a=a, b=b: int(a + (b - a) * v / 255)) for a, b in zip(dark, light)])


def paper():
    img = Image.new('RGB', (W, H), BASE)
    # 三層不同尺度的斑駁，互相疊乘出不均勻的泛黃
    for cell, sigma, blur, dark, light, alpha in (
        (160, 60, 40, (170, 138, 92), (238, 220, 178), 0.55),
        (48, 70, 10, (186, 154, 106), (236, 216, 172), 0.35),
        (10, 80, 1.2, (196, 168, 120), (232, 212, 168), 0.25),
    ):
        layer = tint(noise_layer(cell, sigma, blur).convert('L'), dark, light)
        img = Image.blend(img, layer, alpha)
    # 細纖維：短而淡的斜線
    fib = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(fib)
    for _ in range(2600):
        x, y = random.uniform(0, W), random.uniform(0, H)
        ang = random.uniform(-0.6, 0.6)
        ln = random.uniform(8, 34)
        d.line((x, y, x + ln, y + ln * ang), fill=random.randint(30, 80), width=1)
    fib = fib.filter(ImageFilter.GaussianBlur(0.6))
    img = Image.composite(Image.new('RGB', (W, H), (150, 118, 72)), img, fib.point(lambda v: v // 3))
    # 水漬圈：外緣深、內部稍淡
    stains = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(stains)
    for _ in range(9):
        cx, cy = random.uniform(0, W), random.uniform(0, H)
        r = random.uniform(60, 220)
        d.ellipse((cx - r, cy - r * 0.8, cx + r, cy + r * 0.8), outline=70, width=random.randint(3, 7))
        d.ellipse((cx - r * 0.9, cy - r * 0.7, cx + r * 0.9, cy + r * 0.7), fill=14)
    stains = stains.filter(ImageFilter.GaussianBlur(5))
    img = Image.composite(Image.new('RGB', (W, H), (140, 104, 60)), img, stains)
    # 極細顆粒
    grain = Image.effect_noise((W, H), 28).convert('L')
    img = ImageChops.multiply(img, tint(grain, (225, 220, 210), (255, 255, 255)))
    return img


def edge():
    """焦邊與暗角：中間全透明，往四邊漸深，邊緣再加不規則焦痕。"""
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    steps = 46
    for i in range(steps):
        t = i / steps
        inset_x, inset_y = int(W * 0.5 * t * 0.92), int(H * 0.5 * t * 0.9)
        d.rectangle((inset_x, inset_y, W - inset_x, H - inset_y), fill=int(235 * (1 - t) ** 2.4))
    mask = mask.filter(ImageFilter.GaussianBlur(60))
    burn = noise_layer(14, 90, 3).convert('L').point(lambda v: 255 if v > 150 else 0).filter(ImageFilter.GaussianBlur(4))
    border = Image.new('L', (W, H), 0)
    ImageDraw.Draw(border).rectangle((0, 0, W, H), outline=255, width=70)
    border = border.filter(ImageFilter.GaussianBlur(26))
    burn = ImageChops.multiply(burn, border)
    alpha = ImageChops.lighter(mask, burn)
    out = Image.new('RGBA', (W, H), (52, 30, 12, 0))
    out.putalpha(alpha)
    return out


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    paper().save(os.path.join(OUT, 'paper.webp'), 'WEBP', quality=82, method=6)
    edge().save(os.path.join(OUT, 'paper-edge.webp'), 'WEBP', quality=80, method=6)
    print('ok', OUT)
