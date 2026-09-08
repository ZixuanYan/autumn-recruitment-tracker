#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 icons/app-icon-512.png 与 icons/apple-touch-icon.png（180）

为什么是纯 Python 而不是调用现成工具：**实测本机没有 rsvg-convert / imagemagick /
chromium，也不允许联网下载**，所以自己写一个超采样光栅化器。几何与 icons/app-icon.svg
一一对应（改 SVG 就要同步改这里的 SHAPE 常量，两处不一致会让 PNG 与 SVG 长得不一样）。

算法（对应实施方案 §6.2）：
  1. 超采样 S=4：在 4×size 的画布上光栅化，再 4×4 box 降采样 → 约等于 4×4 子像素抗锯齿
  2. 圆角矩形用 SDF + 0.5px 解析羽化；折线描边用「到线段的最短距离」+ 半宽羽化
  3. 合成按 SVG 绘制顺序 src-over：bg → 日历卡 → 挂环 → 分隔线 → 对勾
  4. 每个形状只在自身 bbox（外扩 2px）内光栅化，避免全画布重复计算
  5. 写 PNG 只用 zlib + struct（8bit RGBA 非隔行，与旧图完全同规格）
  6. 生成后**读回自校验**：签名 / 每个 chunk 的 CRC / IHDR / IDAT 解压长度 / 像素抽查

用法：python3 scripts/gen-icons.py        （在仓库根目录执行）
耗时：512 档约 5-20 秒（纯 Python），属正常，不要中途判失败。
"""
import math
import os
import struct
import sys
import zlib

S = 4                       # 超采样倍数
BASE = 512                  # SVG 的 viewBox 边长（几何坐标系）
OUT = [(512, 'icons/app-icon-512.png'), (180, 'icons/apple-touch-icon.png')]

# ---- 几何（512 坐标系，与 app-icon.svg 逐项对应）----
BLUE = (0x00, 0x71, 0xe3)
WHITE = (0xff, 0xff, 0xff)
GREEN = (0x34, 0xc7, 0x59)

BG = dict(box=(0, 0, 512, 512), r=116, color=BLUE)                 # <rect rx="116">
CARD = dict(box=(100, 151, 412, 410), r=30, color=WHITE)           # M130 151h252a30…的包围盒
RINGS = [dict(box=(170, 105, 198, 206), r=14, color=WHITE),        # stroke28 圆帽 @x=184, y119→192
         dict(box=(314, 105, 342, 206), r=14, color=WHITE)]        # 同上 @x=328
DIVIDER = dict(box=(101, 212, 411, 236), r=0, color=BLUE)          # stroke24 @y=224 的包围盒
CHECK = dict(pts=[(178, 315), (228, 362), (338, 246)], w=35, color=GREEN)   # m178 315 50 47 110-116


def clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def rrect_alpha(px, py, x0, y0, x1, y1, r):
    """圆角矩形的覆盖率。快速路径：完全在内部/外部的像素不算 SDF（bg 占满画布，这条很关键）。"""
    if px < x0 - 0.5 or px > x1 + 0.5 or py < y0 - 0.5 or py > y1 + 0.5:
        return 0.0
    if r <= 0:
        return clamp01(min(px - (x0 - 0.5), (x1 + 0.5) - px, py - (y0 - 0.5), (y1 + 0.5) - py))
    if x0 + r <= px <= x1 - r and y0 + r <= py <= y1 - r:
        return 1.0
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    hx, hy = (x1 - x0) / 2.0 - r, (y1 - y0) / 2.0 - r
    qx, qy = abs(px - cx) - hx, abs(py - cy) - hy
    if qx > 0 and qy > 0:
        sd = math.hypot(qx, qy) - r
    else:
        sd = min(max(qx, qy), 0.0) - r
    return clamp01(0.5 - sd)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / L2
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def poly_alpha(px, py, pts, half):
    """圆帽圆角折线的覆盖率 = 到任一线段的距离 ≤ half（圆角连接由"取最小距离"自然得到）。"""
    d = min(seg_dist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
            for i in range(len(pts) - 1))
    return clamp01(half + 0.5 - d)


def paint(buf, W, shape, kind, scale):
    """把一个形状合成进超采样缓冲（src-over）。只在 bbox 内循环。"""
    r, g, b = shape['color']
    pad = 2 * S
    if kind == 'poly':
        pts = [(x * scale, y * scale) for x, y in shape['pts']]
        half = shape['w'] / 2.0 * scale
        x0 = min(p[0] for p in pts) - half - pad
        x1 = max(p[0] for p in pts) + half + pad
        y0 = min(p[1] for p in pts) - half - pad
        y1 = max(p[1] for p in pts) + half + pad
        alpha_fn = lambda px, py: poly_alpha(px, py, pts, half)
    else:
        bx0, by0, bx1, by1 = [v * scale for v in shape['box']]
        rr = shape['r'] * scale
        x0, y0, x1, y1 = bx0 - pad, by0 - pad, bx1 + pad, by1 + pad
        alpha_fn = lambda px, py: rrect_alpha(px, py, bx0, by0, bx1, by1, rr)

    ix0, iy0 = max(0, int(x0)), max(0, int(y0))
    ix1, iy1 = min(W, int(math.ceil(x1)) + 1), min(W, int(math.ceil(y1)) + 1)
    for y in range(iy0, iy1):
        py = y + 0.5
        row = y * W * 4
        for x in range(ix0, ix1):
            a = alpha_fn(x + 0.5, py)
            if a <= 0:
                continue
            i = row + x * 4
            if a >= 1.0:
                buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255
                continue
            da = buf[i + 3] / 255.0
            out_a = a + da * (1 - a)
            if out_a <= 0:
                continue
            # src-over：先按 alpha 混合颜色通道，再写回（buf 存的是非预乘的 0-255）
            buf[i] = int(round((r * a + buf[i] * da * (1 - a)) / out_a))
            buf[i + 1] = int(round((g * a + buf[i + 1] * da * (1 - a)) / out_a))
            buf[i + 2] = int(round((b * a + buf[i + 2] * da * (1 - a)) / out_a))
            buf[i + 3] = int(round(out_a * 255))


def downsample(buf, W, size):
    """4×4 box 均值（整数累加后 //16），得到 size×size 的 RGBA8。"""
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            sr = sg = sb = sa = 0
            for dy in range(S):
                base = ((y * S + dy) * W + x * S) * 4
                for dx in range(S):
                    i = base + dx * 4
                    sr += buf[i]; sg += buf[i + 1]; sb += buf[i + 2]; sa += buf[i + 3]
            o = (y * size + x) * 4
            out[o] = sr // 16; out[o + 1] = sg // 16; out[o + 2] = sb // 16; out[o + 3] = sa // 16
    return out


def write_png(path, img, size):
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    raw = b''.join(b'\x00' + bytes(img[y * size * 4:(y + 1) * size * 4]) for y in range(size))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def verify(path, size):
    """读回自校验：签名 / 每个 chunk 的 CRC / IHDR / IDAT 解压长度 / 像素抽查。"""
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', f'{path}: PNG 签名不对'
    pos, idat, ihdr = 8, b'', None
    while pos < len(d):
        (ln,) = struct.unpack('>I', d[pos:pos + 4])
        tag, data = d[pos + 4:pos + 8], d[pos + 8:pos + 8 + ln]
        (crc,) = struct.unpack('>I', d[pos + 8 + ln:pos + 12 + ln])
        assert zlib.crc32(tag + data) & 0xffffffff == crc, f'{path}: chunk {tag} 的 CRC 不匹配'
        if tag == b'IHDR':
            ihdr = struct.unpack('>IIBBBBB', data)
        elif tag == b'IDAT':
            idat += data
        pos += 12 + ln
    assert ihdr == (size, size, 8, 6, 0, 0, 0), f'{path}: IHDR={ihdr}，应为 {(size, size, 8, 6, 0, 0, 0)}'
    px = zlib.decompress(idat)
    assert len(px) == size * (1 + size * 4), f'{path}: IDAT 解压长度 {len(px)}，应为 {size * (1 + size * 4)}'

    def at(x, y):
        row = y * (1 + size * 4) + 1 + x * 4
        return tuple(px[row:row + 4])

    k = size / 512.0
    checks = [
        ('左上角圆角外应透明', at(0, 0)[3], 0),
        ('顶边中部应是 Apple 蓝底', at(size // 2, int(60 * k))[:3], BLUE),
        ('画面中心应是白色日历卡', at(size // 2, size // 2)[:3], WHITE),
    ]
    for name, got, want in checks:
        assert got == want, f'{path}: {name}，实得 {got}，期望 {want}'
    # 对勾中点附近必须存在绿色系像素（段1 (178,315)-(228,362) 的中点）
    gx, gy = int(203 * k), int(338 * k)
    found = any(at(gx + dx, gy + dy)[0] < 120 and at(gx + dx, gy + dy)[1] > 140
                for dx in range(-3, 4) for dy in range(-3, 4))
    assert found, f'{path}: 对勾中点 ({gx},{gy}) 附近找不到 Apple 绿像素'
    return len(d)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    for size, path in OUT:
        W = size * S
        scale = (size / BASE) * S
        buf = bytearray(W * W * 4)                      # 全透明起底
        paint(buf, W, BG, 'rrect', scale)
        paint(buf, W, CARD, 'rrect', scale)
        for ring in RINGS:
            paint(buf, W, ring, 'rrect', scale)
        paint(buf, W, DIVIDER, 'rrect', scale)
        paint(buf, W, CHECK, 'poly', scale)
        img = downsample(buf, W, size)
        n = write_png(path, img, size)
        verify(path, size)
        print(f'  ✓ {path}: {size}×{size}，{n} B，自校验通过（签名/CRC/IHDR/IDAT 长度/像素抽查）')
    print('✓ 两个 PNG 已生成并校验')


if __name__ == '__main__':
    sys.exit(main())
