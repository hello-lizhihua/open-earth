// 注视点相机：机位与拖动都以「注视点经纬度 + 距离」表达——相机始终位于
// dir(facing) × distance 处看向球心；拖动即改注视点，画面与指针同向。
// 跳转动画为命令式缓动（非惯性），手动输入随时打断。

import * as THREE from "three";
import { latLngToXYZ, clamp, wrapDelta } from "../geo.js";
import {
  FOV_DEG, MAX_LAT, ZOOM_LEVELS, ZOOM_MIN_DISTANCE, ZOOM_MAX_DISTANCE, JUMP_DURATION,
} from "./constants.js";

export function zoomLevelDistance(level) {
  const t = clamp((level - 1) / (ZOOM_LEVELS - 1), 0, 1);
  return ZOOM_MAX_DISTANCE + (ZOOM_MIN_DISTANCE - ZOOM_MAX_DISTANCE) * t;
}

export function levelOfDistance(distance) {
  let best = 1;
  let bestErr = Infinity;
  for (let level = 1; level <= ZOOM_LEVELS; level++) {
    const err = Math.abs(zoomLevelDistance(level) - distance);
    if (err < bestErr) {
      bestErr = err;
      best = level;
    }
  }
  return best;
}

export class CameraRig {
  constructor(lat, lon, distance) {
    this.lat = lat;
    this.lon = lon;
    this.distance = distance;
    this._animation = null;
  }

  place(lat, lon, dist) {
    this.cancel();
    this.lat = lat;
    this.lon = lon;
    this.distance = dist;
  }

  // 注视点与距离缓动（机位跳转与国家定位共用）；经度走最短路径
  animateTo(lat, lon, dist, duration = JUMP_DURATION) {
    lon = this.lon + wrapDelta(lon - this.lon);
    this._animation = {
      fromLat: this.lat, fromLon: this.lon, fromDist: this.distance,
      toLat: lat, toLon: lon, toDist: dist,
      start: performance.now(), duration,
    };
  }

  cancel() {
    this._animation = null;
  }

  isAnimating() {
    return this._animation !== null;
  }

  setLevel(level) {
    this.cancel();
    this.distance = zoomLevelDistance(clamp(level, 1, ZOOM_LEVELS));
  }

  level() {
    return levelOfDistance(this.distance);
  }

  // 每帧推进；返回是否处于动画中
  update() {
    const anim = this._animation;
    if (!anim) return false;
    const t = Math.min(1, (performance.now() - anim.start) / anim.duration);
    const ease = 1 - Math.pow(1 - t, 3);
    this.lat = lerp(anim.fromLat, anim.toLat, ease);
    this.lon = lerp(anim.fromLon, anim.toLon, ease);
    this.distance = lerp(anim.fromDist, anim.toDist, ease);
    if (t >= 1) this._animation = null;
    return true;
  }

  applyTo(camera) {
    const [x, y, z] = latLngToXYZ(this.lat, this.lon, this.distance);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  }
}

// 跟手旋转换算：每像素转角 = 视场角 / 视口高，注视点在屏幕中心处表面严格跟随指针
export function degPerPixel(viewportHeight) {
  return FOV_DEG / viewportHeight;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
