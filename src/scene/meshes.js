// 球面网格构建：经纬参数网格（经纬由构造已知，UV 手动对齐底图，无接缝歧义）
// 与国界描边窄带（ribbon）网格，自 Godot 版移植。

import * as THREE from "three";
import { Earcut } from "three/src/extras/Earcut.js";
import { latLngToXYZ } from "../geo.js";
import { RIBBON_STEP_RAD } from "./constants.js";

/**
 * 经纬参数球：cols×rows 细分，uv.x = (经度+180)/360，uv.y = 1 - 纬度行比
 * （flipY 纹理下 v=1 采样图像顶行 = 北极）。
 * opts.displace(latDeg, lonDeg) → 0..1 归一高程，顶点沿方向按 maxDisplace 抬升。
 */
export function buildParamSphere(radius, cols, rows, opts = {}) {
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const normals = new Float32Array((cols + 1) * (rows + 1) * 3);
  const uvs = new Float32Array((cols + 1) * (rows + 1) * 2);
  let p = 0;
  let u = 0;
  for (let r = 0; r <= rows; r++) {
    const lat = 90 - (r / rows) * 180;
    for (let c = 0; c <= cols; c++) {
      const lon = -180 + (c / cols) * 360;
      const [x, y, z] = latLngToXYZ(lat, lon, 1);
      const scale = opts.displace
        ? radius * (1 + opts.displace(lat, lon) * (opts.maxDisplace || 0))
        : radius;
      positions[p] = x * scale;
      positions[p + 1] = y * scale;
      positions[p + 2] = z * scale;
      normals[p] = x;
      normals[p + 1] = y;
      normals[p + 2] = z;
      uvs[u] = c / cols;
      uvs[u + 1] = 1 - r / rows;
      p += 3;
      u += 2;
    }
  }
  const indices = new Uint32Array(cols * rows * 6);
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      indices[k++] = a; indices[k++] = d; indices[k++] = e;
      indices[k++] = a; indices[k++] = e; indices[k++] = b;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

// 环/折线 → 球面窄带网格：长边按 2° 细分（弦高远小于抬升量，不陷入球面）。
// width 为球面世界尺寸，半宽换算为单位方向上的角偏移（width/radius）；
// closed = false 时按开放折线处理（河流水线），不补首尾闭合边；
// displace + maxDisplace 使窄带随地形起伏（否则高海拔山体会埋住描边）；
// dash = { on, off } 按累计线长断续出段（省界虚线）；
// simplify = 度数阈值：丢弃距上一保留点过近的微点（微段密度高于线宽时
// 窄带四边形反复折叠，贴地视角成「柴堆」）
export function buildRibbonGeometry(lines, width, radius, { closed = true, displace = null, maxDisplace = 0, dash = null, dedupe = false, simplify = 0 } = {}) {
  const positions = [];
  const half = width / (2 * radius);
  // 相邻行政区的共享边界会各描一份（顶点近重复），贴地视角下交错成「柴堆」；
  // 端点量化到 0.001°（约百米）后做无向边去重
  const seenEdges = dedupe ? new Set() : null;
  const edgeKey = (p, q) => {
    const a = `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
    const b = `${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const scaleOf = displace
    ? (v) => {
      const r = Math.hypot(v[0], v[1], v[2]) || 1;
      const lat = (Math.asin(Math.max(-1, Math.min(1, v[1] / r))) * 180) / Math.PI;
      const lon = (Math.atan2(-v[0], -v[2]) * 180) / Math.PI;
      return radius * (1 + displace(lat, lon) * maxDisplace + 0.0008);
    }
    : (v) => radius;
  for (const line of lines) {
    let active = line;
    if (simplify > 0 && line.length > 3) {
      active = [line[0]];
      for (let i = 1; i < line.length; i++) {
        const last = active[active.length - 1];
        if (Math.hypot(line[i][0] - last[0], line[i][1] - last[1]) >= simplify) active.push(line[i]);
      }
      if (active.length < 2) continue;
    }
    const n = active.length;
    if (n < (closed ? 3 : 2)) continue;
    const edgeCount = closed ? n : n - 1;
    let distance = 0; // 累计线长（度），虚线相位
    for (let i = 0; i < edgeCount; i++) {
      const p0 = active[i];
      const p1 = active[(i + 1) % n];
      distance += Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (seenEdges && i < edgeCount) {
        const key = edgeKey(p0, p1);
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
      }
      if (dash) {
        const period = dash.on + dash.off;
        if (distance % period > dash.on) continue;
      }
      const a = latLngToXYZ(p0[1], p0[0]);
      const b = latLngToXYZ(p1[1], p1[0]);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot3(a, b))));
      const steps = Math.max(1, Math.ceil(angle / RIBBON_STEP_RAD));
      let prev = a;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const nxt = normalize3([
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ]);
        ribbonSegment(positions, prev, nxt, half, radius, scaleOf);
        prev = nxt;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

// 单段窄带：中线切向侧移 ±half 抬升到球面，双三角形（双面材质不关心绕序）
function ribbonSegment(positions, a, b, half, radius, scaleOf) {
  const mid = normalize3([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  let side = cross3(ab, mid);
  const len = Math.hypot(side[0], side[1], side[2]);
  if (len < 1e-9) return;
  side = [side[0] / len, side[1] / len, side[2] / len];
  const push = (v) => {
    const scale = scaleOf(v);
    positions.push(v[0] * scale, v[1] * scale, v[2] * scale);
  };
  const off = (v, sign) =>
    normalize3([v[0] + side[0] * half * sign, v[1] + side[1] * half * sign, v[2] + side[2] * half * sign]);
  const aMinus = off(a, -1), aPlus = off(a, 1);
  const bMinus = off(b, -1), bPlus = off(b, 1);
  push(aMinus); push(bPlus); push(aPlus);
  push(aMinus); push(bMinus); push(bPlus);
}

// 小环平面三角化填充（顶点直接投影球面）：仅用于十段线细带这类小环
export function buildFlatFillGeometry(rings, radius) {
  const positions = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const flat = new Float64Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
      flat[i * 2] = ring[i][0];
      flat[i * 2 + 1] = ring[i][1];
    }
    const triangles = Earcut.triangulate(flat, [], 2);
    for (let t = 0; t < triangles.length; t++) {
      const [lon, lat] = ring[triangles[t]];
      const [x, y, z] = latLngToXYZ(lat, lon, radius);
      positions.push(x, y, z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// 描边材质：贴地时近处窄带四边形会被透视成横贯屏幕的巨刺（单段最长 2° 弧 ≈ 22 单位），
// 按片元到相机距离淡出（3 单位内隐去、14 单位外原样），远景国界不受影响
export function makeRibbonMaterial(color, opacity, fadeNear = 3.0, fadeFar = 14.0) {
  const material = new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vCamDist;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvCamDist = distance((modelMatrix * vec4(transformed, 1.0)).xyz, cameraPosition);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vCamDist;")
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>\ngl_FragColor.a *= smoothstep(${fadeNear.toFixed(1)}, ${fadeFar.toFixed(1)}, vCamDist);`,
      );
  };
  return material;
}
