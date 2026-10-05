// 高程数据：terrain_height.png（16 位灰度按 RGB 高低字节编码）解码为采样器。
// CPU 侧用于位移球体构建与标签抬升；GPU 侧（高亮遮罩 shader）直接采样同贴图。

import { loadImage } from "../data/loader.js";
import { TERRAIN_MAX_ELEV } from "./constants.js";

export async function loadTerrain(url) {
  const image = await loadImage(url);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height).data;

  // 双线性采样返回 0..1 归一高程（16 位 = R 高字节 × 256 + G 低字节）
  function elevationNorm(latDeg, lonDeg) {
    const x = (((lonDeg + 180) % 360 + 360) % 360) / 360 * width - 0.5;
    const y = ((90 - latDeg) / 180) * height - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const h00 = raw(x0, y0);
    const h10 = raw(x0 + 1, y0);
    const h01 = raw(x0, y0 + 1);
    const h11 = raw(x0 + 1, y0 + 1);
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fy);
  }

  function raw(x, y) {
    const xi = (((x % width) + width) % width);
    const yi = Math.max(0, Math.min(height - 1, y));
    const o = (yi * width + xi) * 4;
    return (pixels[o] * 256 + pixels[o + 1]) / 65535;
  }

  return {
    width,
    height,
    elevationNorm,
    metersAt(latDeg, lonDeg) {
      return elevationNorm(latDeg, lonDeg) * TERRAIN_MAX_ELEV;
    },
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
