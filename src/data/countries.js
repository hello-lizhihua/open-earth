// 国家数据底座：countries.geojson 解析为并行数组 + 几何查询。
// 环经度已做反子午线解缠（连续化），点在多边形判定以点经度 ±360 三次试探兜底
// 跨线国家（斐济、俄罗斯东端）。

const EARTH_RADIUS_KM = 6371;

function unwrapRing(ring) {
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

function ringBBox(ring, box) {
  for (const [lon, lat] of ring) {
    if (lon < box[0]) box[0] = lon;
    if (lat < box[1]) box[1] = lat;
    if (lon > box[2]) box[2] = lon;
    if (lat > box[3]) box[3] = lat;
  }
}

function pointInRing(ring, lon, lat) {
  // 射线法（偶奇）：环顶点数少（50m 简化），直接遍历
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

export function buildCountries(featureCollection) {
  const features = featureCollection.features;
  const data = {
    count: features.length,
    names: [], namesZh: [], isos: [], continents: [], subregions: [],
    pops: [], gdps: [], areas: [], centroids: [], rings: [], bboxes: [], angRadii: [],
  };
  for (const feature of features) {
    const p = feature.properties;
    data.names.push(p.name);
    data.namesZh.push(p.name_zh);
    data.isos.push(p.iso ?? "");
    data.continents.push(p.continent);
    data.subregions.push(p.subregion);
    data.pops.push(p.pop | 0);
    data.gdps.push(p.gdp | 0);
    data.areas.push(p.area);
    data.centroids.push(p.centroid);
    const polygons = feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
    const unwrapped = polygons.map((polygon) => polygon.map(unwrapRing));
    data.rings.push(unwrapped);
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const polygon of unwrapped) for (const ring of polygon) ringBBox(ring, box);
    data.bboxes.push(box);
    // 角半径（弧度）= sqrt(面积/π)/地球半径，标签 LOD 与对准用
    data.angRadii.push(Math.sqrt(p.area / Math.PI) / EARTH_RADIUS_KM);
  }

  function findCountry(latDeg, lonDeg) {
    for (let i = 0; i < data.count; i++) {
      const box = data.bboxes[i];
      // 解缠环经度可能超出 ±180；包围盒跨度 < 360，±360 平移后至多一个落盒
      for (const shift of [0, 360, -360]) {
        const lon = lonDeg + shift;
        if (lon < box[0] || lon > box[2] || latDeg < box[1] || latDeg > box[3]) continue;
        let inside = false;
        for (const polygon of data.rings[i]) {
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

  return Object.assign(data, { findCountry });
}

export function buildChinaLines(featureCollection) {
  return featureCollection.features.map((f) => f.geometry.coordinates[0]);
}
