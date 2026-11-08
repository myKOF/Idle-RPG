"""Package native Blender frames as five HD GIFs and a 1920px action board.

python package_tower_boss1.py PREVIEW_DIRECTORY
"""
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

LABELS = {'Walk': '走路', 'Attack1': '攻擊 1', 'Attack2': '攻擊 2',
          'Attack3': '攻擊 3', 'Die': '死亡'}
FONT = 'C:/Windows/Fonts/msjh.ttc'


def font(size):
    return ImageFont.truetype(FONT, size) if Path(FONT).exists() else ImageFont.load_default(size=size)


def palette_for(frames):
    sample = Image.new('RGB', (256 * 8, 256))
    for i in range(8):
        sample.paste(frames[round(i * (len(frames) - 1) / 7)].resize((256, 256)), (i * 256, 0))
    return sample.quantize(colors=256, method=Image.Quantize.MEDIANCUT)


def write_gif(frames, destination, durations):
    palette = palette_for(frames)
    indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    indexed[0].save(destination, save_all=True, append_images=indexed[1:], duration=durations,
                    loop=0, disposal=1, optimize=False)


def package(root):
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    thumbnails, output = {}, {}
    for name, clip in manifest['clips'].items():
        frames, thumbnails[name] = [], []
        for i in range(clip['frames']):
            with Image.open(root / name / f'{i:04d}.png') as file:
                source = file.convert('RGB')
            board = Image.new('RGB', (1080, 1144), (14, 19, 27))
            board.paste(source, (0, 64))
            draw = ImageDraw.Draw(board)
            draw.text((28, 15), f'封魔塔 BOSS  ·  {LABELS[name]}', font=font(28), fill=(235, 223, 197))
            draw.text((800, 21), f'{clip["clip"]}  /  25 FPS', font=font(20), fill=(154, 173, 193))
            frames.append(board)
            thumbnail = Image.new('RGB', (612, 450), (13, 18, 26))
            thumbnail.paste(source.resize((450, 450), Image.Resampling.LANCZOS), (81, 0))
            thumbnails[name].append(thumbnail)
        durations = [40] * len(frames)
        durations[-1] += 0 if clip['loop'] else (850 if name == 'Die' else 300)
        file = root / f'BOSS1_{name}_HD.gif'
        write_gif(frames, file, durations)
        output[name] = {'file': file.name, 'sizeBytes': file.stat().st_size,
                        'width': 1080, 'height': 1144, 'frames': len(frames)}
        print('GIF_WRITTEN', name, file.stat().st_size, flush=True)
    # Each motion loops at its own original speed; the full walk is visible.
    duration = max(c['duration'] for c in manifest['clips'].values())
    board_frames = []
    grip = Image.open(root / 'grip-detail.png').convert('RGB').resize((450, 450), Image.Resampling.LANCZOS)
    for frame in range(round(duration * 25)):
        t = frame / 25
        board = Image.new('RGB', (1920, 1200), (13, 18, 26))
        draw = ImageDraw.Draw(board)
        draw.text((32, 20), '封魔塔 BOSS  /  3D 五動作預覽', font=font(36), fill=(235, 224, 199))
        draw.text((34, 75), '原速播放  ·  獨立右手劍骨骼  ·  Blender 實際成品渲染', font=font(22), fill=(152, 174, 194))
        for i, (name, clip) in enumerate(manifest['clips'].items()):
            hold = 0 if clip['loop'] else (.85 if name == 'Die' else .30)
            local = min(t % (clip['duration'] + hold), clip['duration'])
            index = min(len(thumbnails[name]) - 1, int(local * 25))
            x, y = 14 + (i % 3) * 640, 132 + (i // 3) * 530
            draw.text((x + 12, y), f'{LABELS[name]}  /  {clip["clip"]}', font=font(24), fill=(225, 213, 187))
            board.paste(thumbnails[name][index], (x, y + 43))
        x, y = 1294, 662
        draw.text((x + 12, y), '握劍細節  /  Sword_R', font=font(24), fill=(225, 213, 187))
        board.paste(grip, (x + 81, y + 43))
        board_frames.append(board)
    destination = root / 'BOSS1_actions_HD.gif'
    write_gif(board_frames, destination, [40] * len(board_frames))
    board_frames[0].save(root / 'BOSS1_cover.png')
    output['overview'] = {'file': destination.name, 'sizeBytes': destination.stat().st_size,
                          'width': 1920, 'height': 1200, 'frames': len(board_frames)}
    (root / 'gif-report.json').write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print('OVERVIEW_WRITTEN', destination.stat().st_size, flush=True)


if __name__ == '__main__':
    package(Path(sys.argv[1]).resolve())
