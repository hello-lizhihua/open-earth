// 编组数据底座：6 大洲组（自动聚合，跳过南极洲）+ groups.json 组织组。
// 组质心 = 成员质心的面积加权球面平均；跨度 = 成员包围盒并集对角角半径
// （大跨度编组对准时切全球机位距离）。

import { latLngToVector3, vector3ToLatLng } from "../geo.js";

// 大洲英文名 → 中文组名（从国家数据自动聚合，跳过南极洲；面板列表保留南极洲分组）
export const CONTINENT_GROUPS = {
  Asia: "亚洲",
  Europe: "欧洲",
  Africa: "非洲",
  "North America": "北美洲",
  "South America": "南美洲",
  Oceania: "大洋洲",
};

export function buildGroups(groupJson, countries) {
  const isoIndex = new Map();
  countries.isos.forEach((iso, i) => {
    if (iso) isoIndex.set(iso, i);
  });

  const groups = { names: [], members: [], areaSums: [], popSums: [], centroids: [], spans: [] };

  function appendGroup(name, memberIndices) {
    let areaSum = 0;
    let popSum = 0;
    let vx = 0, vy = 0, vz = 0;
    for (const i of memberIndices) {
      areaSum += countries.areas[i];
      popSum += countries.pops[i];
      const [lon, lat] = countries.centroids[i];
      const w = countries.areas[i];
      const v = latLngToVector3(lat, lon);
      vx += v.x * w; vy += v.y * w; vz += v.z * w;
    }
    const len = Math.hypot(vx, vy, vz);
    const centroid = len > 0.001
      ? vector3ToLatLng({ x: vx / len, y: vy / len, z: vz / len })
      : vector3ToLatLng(latLngToVector3(35, 105));
    groups.names.push(name);
    groups.members.push(memberIndices);
    groups.areaSums.push(areaSum);
    groups.popSums.push(popSum);
    groups.centroids.push(centroid);
    groups.spans.push(spanOf(memberIndices, countries));
  }

  for (const [continentEn, nameZh] of Object.entries(CONTINENT_GROUPS)) {
    const members = [];
    for (let i = 0; i < countries.count; i++) {
      if (countries.continents[i] === continentEn) members.push(i);
    }
    if (members.length) appendGroup(nameZh, members);
  }
  for (const group of groupJson.groups) {
    const members = [];
    for (const iso of group.iso ?? []) {
      if (isoIndex.has(iso)) members.push(isoIndex.get(iso));
      else console.warn(`编组 ${group.name ?? "?"}：未知 ISO 代码 ${iso}，已跳过`);
    }
    if (members.length) appendGroup(group.name ?? "", members);
  }
  return groups;
}

// 区域角半径（弧度）：成员包围盒并集（各成员 ±360 就近对齐）的对角，
// 与成员自身角半径取大，保证小联盟也有可用下限
function spanOf(memberIndices, countries) {
  let union = null;
  for (const i of memberIndices) {
    const box = countries.bboxes[i];
    const center = (box[0] + box[2]) * 0.5;
    if (!union) {
      union = [...box];
      continue;
    }
    const unionCenter = (union[0] + union[2]) * 0.5;
    let shift = 0;
    let best = Math.abs(center - unionCenter);
    for (const candidate of [360, -360]) {
      if (Math.abs(center + candidate - unionCenter) < best) {
        best = Math.abs(center + candidate - unionCenter);
        shift = candidate;
      }
    }
    union[0] = Math.min(union[0], box[0] + shift);
    union[1] = Math.min(union[1], box[1]);
    union[2] = Math.max(union[2], box[2] + shift);
    union[3] = Math.max(union[3], box[3]);
  }
  const dlon = union[2] - union[0];
  const dlat = union[3] - union[1];
  const midLat = ((union[1] + union[3]) * 0.5 * Math.PI) / 180;
  const diagDeg = Math.sqrt((dlon * Math.cos(midLat)) ** 2 + dlat * dlat);
  let ang = ((diagDeg * 0.5) * Math.PI) / 180;
  for (const i of memberIndices) ang = Math.max(ang, countries.angRadii[i]);
  return ang;
}
