// 经纬度坐标数学（共享）：北纬为正、东经为正，北极 +Y，本初子午线 -Z；
// 保持 Three.js 自身引擎轴（右手系 Y 向上）：从球外看东在右（罗盘方位自然），
// 与场景坐标技术决策一致。

export function latLngToVector3(latDeg, lonDeg, radius = 1) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  return {
    x: -radius * cosLat * Math.sin(lon),
    y: radius * Math.sin(lat),
    z: -radius * cosLat * Math.cos(lon),
  };
}

export function vector3ToLatLng(v) {
  const r = Math.hypot(v.x, v.y, v.z) || 1;
  const lat = (Math.asin(Math.max(-1, Math.min(1, v.y / r))) * 180) / Math.PI;
  const lon = (Math.atan2(-v.x, -v.z) * 180) / Math.PI;
  return [lon, lat];
}

export function latLngToXYZ(latDeg, lonDeg, radius = 1) {
  const v = latLngToVector3(latDeg, lonDeg, radius);
  return [v.x, v.y, v.z];
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// 经度差归一到 (-180, 180]：动画与指向计算走最短路径
export function wrapDelta(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
