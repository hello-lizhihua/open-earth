#!/usr/bin/env python3
"""山体阴影烘焙：terrain_height.png 高程 → 山体阴影乘入风格化底图。

输出 textures/earth/stylized_map_hillshade.png（原图不动，加载路径指向阴影版）；
浮雕强度对应高程位移夸张系数（0.2 倍温和夸张），光源西北向 45 度高度角。
运行：python3 tools/make_hillshade.py（需 numpy，系统 Python 已有）
"""

import struct
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
TEX = ROOT.parent / "public" / "textures" / "earth"
HEIGHT = TEX / "terrain_height.png"
BASE = TEX / "stylized_map.png"
OUT = TEX / "stylized_map_hillshade.png"

STRENGTH = 0.35  # 阴影混合强度（0..1），对应 0.2 倍位移夸张的温和观感
AZIMUTH_DEG = 315.0  # 光源方位：西北
ALTITUDE_DEG = 45.0  # 光源高度角


def read_png_rgb(path):
    """手写 PNG 解码（RGB8）：返回 (width, height, rows numpy uint8)"""
    data = path.read_bytes()
    pos = 8
    idat = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if ctype == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", chunk[:10])
            assert depth == 8 and color in (2, 6), f"不支持的 PNG 格式 {depth}/{color}"
        elif ctype == b"IDAT":
            idat += chunk
        pos += 12 + length
    raw = zlib.decompress(idat)
    channels = 3 if color == 2 else 4
    stride = width * channels
    out = np.zeros((height, stride), dtype=np.uint8)
    prev = np.zeros(stride, dtype=np.int32)
    pos = 0
    for y in range(height):
        ft = raw[pos]
        pos += 1
        line = np.frombuffer(raw[pos:pos + stride], dtype=np.uint8).astype(np.int32).copy()
        pos += stride
        if ft == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ft == 2:
            line = (line + prev) & 0xFF
        elif ft == 3:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b, c = prev[i], prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y] = line.astype(np.uint8)
        prev = line
    return width, height, out.reshape(height, width, channels)


def write_png_rgb(path, rows):
    """手写 PNG 编码（RGB8，filter 0）"""
    height, width, _ = rows.shape
    stride = width * 3
    raw = b"".join(b"\x00" + rows[y].tobytes() for y in range(height))

    def chunk(ctype, payload):
        return (struct.pack(">I", len(payload)) + ctype + payload
                + struct.pack(">I", zlib.crc32(ctype + payload) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                     + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def main():
    w, h, height_px = read_png_rgb(HEIGHT)
    # 16 位高程：R 高字节 × 256 + G 低字节
    elev = (height_px[:, :, 0].astype(np.float64) * 256.0 + height_px[:, :, 1]) / 65535.0
    # 相邻格高程差（米/格）；5400 像素跨 360 度 ≈ 4.6 公里/格
    meters_per_norm = 8849.0
    cell_km = 6371.0 * np.pi / 180.0 / (w / 360.0)
    dzdx = (np.roll(elev, -1, axis=1) - np.roll(elev, 1, axis=1)) * 0.5 * meters_per_norm / cell_km
    dzdy = (np.roll(elev, -1, axis=0) - np.roll(elev, 1, axis=0)) * 0.5 * meters_per_norm / cell_km
    # 经度向格距按纬度收缩（cos 纬度），极区钳制
    lats = 90.0 - (np.arange(h) + 0.5) / h * 180.0
    coslat = np.clip(np.cos(np.deg2rad(lats)), 0.05, 1.0)[:, None]
    slope_x = dzdx / np.maximum(coslat, 0.05)
    slope_y = dzdy
    # 西北光：法线 (−sx, −sy, 1) 归一后与光源向量的点积
    az = np.deg2rad(AZIMUTH_DEG)
    lx, ly, lz = np.sin(az) * np.cos(np.deg2rad(ALTITUDE_DEG)), \
        -np.cos(az) * np.cos(np.deg2rad(ALTITUDE_DEG)), np.sin(np.deg2rad(ALTITUDE_DEG))
    norm = np.sqrt(slope_x ** 2 + slope_y ** 2 + 1.0)
    shade = (-slope_x * lx - slope_y * ly + 1.0 * lz) / norm
    shade = np.clip(shade, 0.0, 1.0)
    # 阴影混入：0.5（平地）→ 乘以强度后压暗/提亮
    factor = 1.0 + (shade - 0.5) * 2.0 * STRENGTH
    factor = np.clip(factor, 1.0 - STRENGTH, 1.0 + STRENGTH)[:, :, None]

    bw, bh, base = read_png_rgb(BASE)
    if (bw, bh) != (w, h):
        raise SystemExit(f"底图 {bw}x{bh} 与高程 {w}x{h} 尺寸不一致")
    shaded = np.clip(base.astype(np.float64) * factor, 0, 255).astype(np.uint8)
    write_png_rgb(OUT, shaded)
    print(f"stylized_map_hillshade.png: {bw}x{bh}，强度 {STRENGTH}，光源西北 {ALTITUDE_DEG}°")


if __name__ == "__main__":
    main()
