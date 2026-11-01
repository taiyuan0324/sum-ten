#!/usr/bin/env python3
"""生成 App 图标：深绿盘面 + 白块 + 黄色框选。输出 web 图标与 iOS 1024 源图。"""
from PIL import Image, ImageDraw

BASE = 1024


def make(size):
    s = 4  # 超采样
    W = size * s
    img = Image.new('RGB', (W, W), '#1f5c46')
    d = ImageDraw.Draw(img)

    # 竖向渐变背景
    for y in range(W):
        t = y / W
        r = int(0x1f + (0x0d - 0x1f) * t)
        g = int(0x5c + (0x24 - 0x5c) * t)
        b = int(0x46 + (0x19 - 0x46) * t)
        d.line([(0, y), (W, y)], fill=(r, g, b))

    # 3x3 白色块
    n = 3
    gap = int(W * 0.045)
    pad = int(W * 0.14)
    cell = (W - 2 * pad - gap * (n - 1)) // n
    radius = int(cell * 0.22)

    def block(i, j, fill):
        x = pad + j * (cell + gap)
        y = pad + i * (cell + gap)
        d.rounded_rectangle([x, y, x + cell, y + cell], radius=radius, fill=fill)
        return x, y, x + cell, y + cell

    for i in range(n):
        for j in range(n):
            block(i, j, '#fdfdfb')

    # 黄色框选：框住右下 2x2 区域
    x0 = pad + 1 * (cell + gap) - gap // 2
    y0 = pad + 1 * (cell + gap) - gap // 2
    x1 = pad + 2 * (cell + gap) + cell + gap // 2
    y1 = pad + 2 * (cell + gap) + cell + gap // 2
    lw = max(2, int(W * 0.016))
    d.rounded_rectangle([x0, y0, x1, y1], radius=int(cell * 0.3),
                        outline='#ffd54a', width=lw)

    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    targets = [
        (os.path.join(root, 'assets', 'icon-1024.png'), 1024),
        (os.path.join(root, 'www', 'icons', 'icon-512.png'), 512),
        (os.path.join(root, 'www', 'icons', 'icon-192.png'), 192),
    ]
    for path, size in targets:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        make(size).save(path, 'PNG', optimize=True)
        print('wrote', path)
