// 国家名标签：地图上显示国家名称，白色文本 + 暗描边，置于质心上方（随地形抬升）。
// DOM 标签（CSS2D）显隐每帧计算：屏幕角半径不足阈值时隐藏（拉近渐次显现小国），
// 注视点边缘透视压缩渐隐（0.42→0.62 点积窗口），远侧球体遮挡由同窗口覆盖。

import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { latLngToXYZ } from "../geo.js";
import { LABEL_RADIUS, LABEL_MIN_PX, FOV_DEG, TERRAIN_MAX_ELEV, TERRAIN_MAX_DISPLACE } from "./constants.js";

// 长国名地图简称（面板仍全名）
const LABEL_SHORT_NAMES = {
  中华人民共和国: "中国",
  朝鲜民主主义人民共和国: "朝鲜",
  大韩民国: "韩国",
  老挝人民民主共和国: "老挝",
};

const SHORT_SUFFIXES = ["民主主义人民共和国", "人民共和国", "联邦共和国", "伊斯兰共和国", "共和国"];

function labelName(fullName) {
  if (LABEL_SHORT_NAMES[fullName]) return LABEL_SHORT_NAMES[fullName];
  for (const suffix of SHORT_SUFFIXES) {
    if (fullName.endsWith(suffix) && fullName.length > suffix.length + 1) {
      return fullName.slice(0, -suffix.length);
    }
  }
  return fullName;
}

export class CountryLabels {
  constructor(scene, countries, terrain) {
    this._scene = scene;
    this._countries = countries;
    this._renderer = new CSS2DRenderer();
    this._renderer.domElement.style.position = "absolute";
    this._renderer.domElement.style.inset = "0";
    this._renderer.domElement.style.pointerEvents = "none";

    this._entries = [];
    for (let i = 0; i < countries.count; i++) {
      const [lon, lat] = countries.centroids[i];
      const lift = terrain ? (terrain.metersAt(lat, lon) / TERRAIN_MAX_ELEV) * TERRAIN_MAX_DISPLACE : 0;
      const [x, y, z] = latLngToXYZ(lat, lon, LABEL_RADIUS + lift);
      const element = document.createElement("span");
      element.className = "clabel";
      element.textContent = labelName(countries.namesZh[i]);
      const object = new CSS2DObject(element);
      object.position.set(x, y, z);
      scene.add(object);
      this._entries.push({
        object, element,
        dir: [x, y, z],
        mag: Math.hypot(x, y, z),
        angRadius: countries.angRadii[i],
      });
    }
  }

  get domElement() {
    return this._renderer.domElement;
  }

  setSize(width, height) {
    this._renderer.setSize(width, height);
  }

  // 每帧显隐与透明度：pxPerRad = 视口高 / 视场角弧度；surfaceDist 为单位球尺度离地高
  // （(distance−半径)/半径），与标签屏幕角半径阈值同一量纲
  update(camera, distance, viewportHeight) {
    const pxPerRad = viewportHeight / ((FOV_DEG * Math.PI) / 180);
    const surfaceDist = Math.max((distance - 100) / 100, 0.12);
    const camDir = camera.position.clone().normalize();
    for (const entry of this._entries) {
      const dot = (camDir.x * entry.dir[0] + camDir.y * entry.dir[1] + camDir.z * entry.dir[2]) / entry.mag;
      const fade = Math.max(0, Math.min(1, (dot - 0.42) / 0.20));
      const sizeOk = (entry.angRadius * pxPerRad) / surfaceDist >= LABEL_MIN_PX;
      entry.object.visible = sizeOk && fade > 0;
      entry.element.style.opacity = fade.toFixed(2);
    }
    this._renderer.render(this._scene, camera);
  }
}
