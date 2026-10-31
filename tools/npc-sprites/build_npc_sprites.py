# -*- coding: utf-8 -*-
"""NPC 序列幀打包工具（2026-10-31）。

來源：素材庫 D:\\MyGame\\Asset 的 GandalfHardcore Hell Asset Pack 32x32 與
Monsters Creatures Fantasy 2（授權與取得方式見素材庫 PROVENANCE.md）。
產出：images/sprites/npc/<角色>_<動作>.png（橫向單列序列幀）與 npc.json。

NPC 配置表的「站立／移動／攻擊／死亡圖像」填的就是這裡的檔名（不含 .png）。
換正式圖時：把新的序列幀放進 images/sprites/npc/、必要時改下面的 CHARS 重跑本工具，
再把配置表對應格子的檔名與「圖像備註」改成新版。

用法：python tools/npc-sprites/build_npc_sprites.py [素材庫路徑]
"""
import json, os, shutil, statistics, sys
from PIL import Image

ASSET = sys.argv[1] if len(sys.argv) > 1 else r'D:\MyGame\Asset'
G = os.path.join(ASSET, 'GandalfHardcore Hell Asset Pack 32x32', 'GandalfHardcore The Damned Enemies and NPCs')
M = os.path.join(ASSET, 'Monsters Creatures Fantasy 2')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'images', 'sprites', 'npc')


def row(r, n):
    return [(r, c) for c in range(n)]


def damned(file):
    d = {'idle': row(0, 5), 'walk': row(1, 8), 'attack': row(2, 6), 'die': row(3, 7)}
    return dict(src=os.path.join(G, file), cw=64, ch=64, anims=d, h=54, facing=-1)


def g(file, cw, ch, h, anims, facing=1, **kw):
    d = dict(src=os.path.join(G, file), cw=cw, ch=ch, h=h, facing=facing, anims=anims)
    d.update(kw)
    return d


def m(files, cw, h, facing):
    return dict(files=files, cw=cw, ch=cw, h=h, facing=facing or 1, base=M)


# h＝普通階級的可見身高（像素）；facing＝原圖朝向（1 朝右、-1 朝左）；正面或左右對稱的角色填 1，一律面向玩家翻轉。
# 動作：{名稱: [(列, 欄)…]}，單檔多列拼成一組；素材沒有的動作就不寫，配置表標為缺圖。
CHARS = {
    'male_damned': damned('Male Damned covered.png'),
    'female_damned': damned('Female Damned covered.png'),
    'twisted_damned': damned('Twisted Damned.png'),
    'burning_damned': damned('Burning Damned.png'),
    'burning_damned_blue': damned('Burning Damned blue.png'),
    'bloated_damned': g('Bloated Damned.png', 64, 64, 58, {'idle': row(0, 5), 'walk': row(1, 8), 'die': row(2, 6)}, facing=-1),
    'burning_skull': g('Burning Skull.png', 64, 64, 50, {'idle': row(0, 5), 'die': row(1, 7)}),
    'burning_skull_blue': g('Burning Skull blue.png', 64, 64, 50, {'idle': row(0, 5), 'die': row(1, 7)}),
    'skull_candle': g('Skull with candle.png', 64, 64, 52, {'idle': row(0, 6), 'die': row(1, 7)}),
    'demon_mine': g('Demon Mine.png', 64, 64, 40, {'idle': row(0, 6), 'die': row(1, 7)}),
    'demon_eye': g('Demon eye.png', 64, 64, 50, {'idle': row(0, 7), 'die': row(1, 6)}),
    'flying_demon_head': g('Flying Demon Head.png', 64, 64, 40, {'idle': row(0, 5), 'die': row(1, 6)}),
    'plague_flies': g('Plague Flies.png', 32, 32, 22, {'idle': row(0, 4), 'die': row(1, 5)}, idle_fps=14),
    'cheeky_devil': g('Cheeky Devil.png', 64, 64, 54, {'idle': row(0, 10)}),
    'hell_giant': g('Female Hell Giant covered.png', 112, 128, 92, {'idle': row(0, 10)}),
    'old_demon': g('Old Demon covered.png', 80, 64, 58, {'idle': row(0, 7)}, facing=-1),
    'memento_skeleton': g('Memento Mori Skeleton.png', 128, 64, 58,
                          {'idle': [(r, c) for r in range(6) for c in range(4)]}),
    'the_devil': g('The Devil.png', 112, 112, 80, {'idle': [(r, c) for r in range(4) for c in range(6)]}),
    'large_skull': g('Large Skull.png', 128, 128, 82, {'idle': row(0, 10), 'attack': row(1, 10), 'die': row(3, 10)}),
    'imp': g('Imp.png', 64, 64, 46, {'idle': row(0, 10), 'attack': row(1, 5), 'walk': row(2, 8), 'die': row(4, 6)}),
    'tree_damned': g('Tree Damned.png', 64, 64, 62, {'idle': [(0, 0)], 'die': row(0, 7)}),
    # Monsters Creatures Fantasy 2：每個動作一個檔，整檔當成一組
    'bat': m({'idle': 'Bat/fly.png', 'attack': 'Bat/attack.png', 'die': 'Bat/death.png'}, 87, 40, 0),
    'rat': m({'idle': 'Rat/idle.png', 'walk': 'Rat/run.png', 'attack': 'Rat/attack_bite.png', 'die': 'Rat/rat-death.png'}, 70, 30, 1),
    'slime': m({'idle': 'Slime/idle.png', 'walk': 'Slime/walk.png', 'attack': 'Slime/attack.png', 'die': 'Slime/death.png'}, 156, 40, 1),
    'mimic': m({'idle': 'Mimic/idle_transformed.png', 'walk': 'Mimic/walk.png', 'attack': 'Mimic/attack_1.png', 'die': 'Mimic/death.png'}, 146, 56, 1),
}


def frames_of(c, anim):
    if 'files' in c:
        im = Image.open(os.path.join(c['base'], c['files'][anim])).convert('RGBA')
        return [im.crop((i * c['cw'], 0, (i + 1) * c['cw'], c['ch'])) for i in range(im.width // c['cw'])]
    im = Image.open(c['src']).convert('RGBA')
    return [im.crop((col * c['cw'], r * c['ch'], (col + 1) * c['cw'], (r + 1) * c['ch'])) for r, col in c['anims'][anim]]


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    manifest = {'chars': {}, 'stems': {}}
    for key, c in CHARS.items():
        names = list(c['files'].keys()) if 'files' in c else list(c['anims'].keys())
        sets = {a: frames_of(c, a) for a in names}
        boxes = [f.getbbox() for f in sets['idle'] if f.getbbox()]
        ref_h = statistics.median([b[3] - b[1] for b in boxes])
        anchor_y = statistics.median([b[3] for b in boxes]) / c['ch']
        ux0 = min(b[0] for b in boxes)
        ux1 = max(b[2] for b in boxes)
        manifest['chars'][key] = {
            'cellW': c['cw'], 'cellH': c['ch'],
            'anchorX': round((ux0 + ux1) / 2 / c['cw'], 4), 'anchorY': round(anchor_y, 4),
            'scale': round(c['h'] / ref_h, 4), 'facing': c['facing'], 'height': c['h']
        }
        for a, fr in sets.items():
            n = len(fr)
            strip = Image.new('RGBA', (n * c['cw'], c['ch']), (0, 0, 0, 0))
            for i, f in enumerate(fr):
                strip.paste(f, (i * c['cw'], 0))
            stem = key + '_' + a
            strip.save(os.path.join(OUT, stem + '.png'), optimize=True)
            if a == 'idle':
                fps, loop, hold = c.get('idle_fps', 8), True, False
            elif a == 'walk':
                fps, loop, hold = 12, True, False
            elif a == 'attack':
                fps, loop, hold = max(10, min(30, round(n / 0.5))), False, False
            else:
                fps, loop, hold = max(8, min(16, round(n / 0.7))), False, True
            manifest['stems'][stem] = {'char': key, 'frames': n, 'fps': fps, 'loop': loop, 'hold': hold}
    with open(os.path.join(OUT, 'npc.json'), 'w', encoding='utf-8') as fp:
        json.dump(manifest, fp, ensure_ascii=False, indent=1)
    print(len(manifest['chars']), 'chars,', len(manifest['stems']), 'stems')
    for k, v in manifest['chars'].items():
        print(k, v)


main()
