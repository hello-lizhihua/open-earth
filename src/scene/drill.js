// 地图下钻：国 → 省 → 市 → 区县（数据源阿里 DataV GeoAtlas，区县为公开数据边界）。
// 钻栈保存各级 children（上级返回不重取）；活动行政区层 = 本级 children 描边，
// 点选行政区高亮 = earcut 填充（按跨度抬高，避免大区弦高沉入球面）+ 窄带描边。

import * as THREE from "three";
import { Earcut } from "three/src/extras/Earcut.js";
import { buildRibbonGeometry } from "./meshes.js";
import { latLngToXYZ } from "../geo.js";
import { GLOBE_RADIUS, TERRAIN_MAX_DISPLACE } from "./constants.js";

export function unwrapRing(ring) {
  if (!ring.length) return ring;
  const out = [[ring[0][0], ring[0][1]]];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const lon = ring[i][0];
    const prev = ring[i - 1][0];
    if (lon - prev > 180) offset -= 360;
    else if (lon - prev < -180) offset += 360;
    offset = Math.max(-360, Math.min(360, offset));
    out.push([lon + offset, ring[i][1]]);
  }
  return out;
}

function pointInRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat)) {
      const xi = ring[i][0], xj = ring[j][0];
      if (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// DataV FeatureCollection → 可拾取行政区数组
export function parseAdminRegions(featureCollection) {
  const regions = [];
  for (const feature of featureCollection.features ?? []) {
    const props = feature.properties ?? {};
    if (props.adchar === "JD") continue; // 十段线不是行政区
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    if (!polygons.length) continue;
    const unwrapped = polygons.map((polygon) => polygon.map(unwrapRing));
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    let areaKm2ish = 0;
    for (const polygon of unwrapped) {
      for (const ring of polygon) {
        for (const [lon, lat] of ring) {
          if (lon < box[0]) box[0] = lon;
          if (lat < box[1]) box[1] = lat;
          if (lon > box[2]) box[2] = lon;
          if (lat > box[3]) box[3] = lat;
        }
      }
    }
    const dlon = (box[2] - box[0]) * Math.cos((((box[1] + box[3]) / 2) * Math.PI) / 180);
    const dlat = box[3] - box[1];
    const span = ((Math.sqrt(dlon * dlon + dlat * dlat) * 0.5) * Math.PI) / 180;
    const center = props.center ?? props.centroid ?? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    regions.push({
      name: props.name ?? "",
      adcode: String(props.adcode ?? props.id ?? ""),
      level: props.level ?? "",
      polygons: unwrapped,
      bbox: box,
      span,
      center,
    });
  }
  return regions;
}

export function pickAdminRegion(regions, latDeg, lonDeg) {
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    for (const shift of [0, 360, -360]) {
      const lon = lonDeg + shift;
      const box = region.bbox;
      if (lon < box[0] || lon > box[2] || latDeg < box[1] || latDeg > box[3]) continue;
      let inside = false;
      for (const polygon of region.polygons) {
        for (const ring of polygon) {
          if (pointInRing(ring, lon, latDeg)) inside = !inside;
        }
      }
      if (inside) return i;
      break;
    }
  }
  return -1;
}

// 行政区填充：earcut 外环三角化，顶点按跨度抬高（大区弦高下沉补偿），
// 再叠加高程位移随地形。区级小环弦高可忽略，省级大区按几何抬高。
export function buildRegionFillGeometry(region, terrain, radius) {
  const positions = [];
  // 跨度角一半的弦高相对量 = 1 - cos(span/2)，抬高 1.3 倍留裕量
  const sagLift = Math.max(0.0008, (1 - Math.cos(region.span / 2)) * 1.3);
  for (const polygon of region.polygons) {
    const outer = polygon[0];
    if (!outer || outer.length < 3) continue;
    const flat = new Float64Array(outer.length * 2);
    for (let i = 0; i < outer.length; i++) {
      flat[i * 2] = outer[i][0];
      flat[i * 2 + 1] = outer[i][1];
    }
    const triangles = Earcut.triangulate(flat, [], 2);
    for (const t of triangles) {
      const [lon, lat] = outer[t];
      const lift = sagLift + (terrain ? terrain.elevationNorm(lat, lon) * TERRAIN_MAX_DISPLACE : 0);
      const [x, y, z] = latLngToXYZ(lat, lon, radius * (1 + lift));
      positions.push(x, y, z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

// 相机级别适配：按行政区跨度选缩放级别（10 贴地 → 6 大区）
export function levelForSpan(span) {
  if (span < 0.02) return 10;
  if (span < 0.06) return 9;
  if (span < 0.15) return 8;
  if (span < 0.35) return 7;
  return 6;
}

export const ACTIVE_ADMIN = {
  radius: GLOBE_RADIUS * 1.0025,
  width: 0.9,
  color: 0xf7f3e8,
  opacity: 0.95,
};
