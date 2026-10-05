// 选中高亮层：填充 = 预生成遮罩贴图（白色=范围内，alpha 通道）经 shader 上屏，
// 像素级贴合国界；描边 = 球面窄带网格。国家选中与编组多选互斥；多编组按选中
// 顺序取色叠加。遮罩 shader 顶点按高程贴图同步抬升（地形与填充、描边同起同落）。

import * as THREE from "three";
import { buildParamSphere, buildRibbonGeometry } from "./meshes.js";
import {
  GROUP_COLORS, HIGHLIGHT_OVERLAY_RADIUS, SELECT_FILL_COLOR, SELECT_STROKE_COLOR,
  SELECT_STROKE_RADIUS, SELECT_STROKE_WIDTH, TERRAIN_MAX_DISPLACE,
} from "./constants.js";

const OVERLAY_VERTEX = /* glsl */ `
  uniform sampler2D height;
  uniform float maxDisplace;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec2 h = texture2D(height, uv).rg;
    float elevation = (h.r * 65280.0 + h.g * 255.0) / 65535.0;
    vec3 pos = position * (1.0 + elevation * maxDisplace + 0.0008);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const OVERLAY_FRAGMENT = /* glsl */ `
  uniform sampler2D mask;
  uniform vec4 tint;
  varying vec2 vUv;
  void main() {
    float m = texture2D(mask, vUv).a;
    gl_FragColor = vec4(tint.rgb, m * tint.a);
  }
`;

function emptyMaskTexture() {
  const data = new Uint8Array([0, 0, 0, 0]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function emptyHeightTexture() {
  const data = new Uint8Array([0, 0, 0, 255]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export class HighlightLayer {
  constructor(scene, { heightTexture = null, terrain = null } = {}) {
    this._scene = scene;
    this._maskLoader = new THREE.TextureLoader();
    this._maskCache = new Map();
    this._selectionVersion = 0;
    this._terrain = terrain;

    this._heightTexture = heightTexture || emptyHeightTexture();
    // 参数球与位移球体同分辨率同 UV 约定：填充贴住每一道山脊
    //（网格粗于球体会被细位移地形刺穿，高亮盖不住高山）
    this._fillSphereGeometry = buildParamSphere(HIGHLIGHT_OVERLAY_RADIUS, 512, 256);

    // 国家选中：单遮罩填充 overlay
    this._countryMaterial = this._makeMaterial(SELECT_FILL_COLOR.r, SELECT_FILL_COLOR.g, SELECT_FILL_COLOR.b, SELECT_FILL_COLOR.a);
    this._countryFill = new THREE.Mesh(this._fillSphereGeometry, this._countryMaterial);
    this._countryFill.renderOrder = 2;
    this._countryFill.castShadow = false;
    scene.add(this._countryFill);

    // 编组多选：每编组独立填充 overlay（遮罩 shader 逐实例 tint）
    this._groupOverlays = new Map();

    // 描边网格：国家选中一条，编组各一条
    this._strokes = [];
  }

  _makeMaterial(r, g, b, a) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        mask: { value: emptyMaskTexture() },
        height: { value: this._heightTexture },
        tint: { value: new THREE.Vector4(r, g, b, a) },
        maxDisplace: { value: TERRAIN_MAX_DISPLACE },
      },
      vertexShader: OVERLAY_VERTEX,
      fragmentShader: OVERLAY_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return material;
  }

  maskTexture(kind, index) {
    const key = `${kind}_${index}`;
    if (!this._maskCache.has(key)) {
      const pending = new Promise((resolve, reject) => {
        this._maskLoader.load(`./data/masks/${kind}_${index}.png`, resolve, undefined, reject);
      });
      this._maskCache.set(key, pending);
    }
    return this._maskCache.get(key);
  }

  // 选中高亮重建：国家 = 单遮罩 + 描边（中国时十段线随描边）；编组多选 = 每编组
  // 独立填充 + 描边，按序取色。同版本号守卫异步遮罩加载的竞态。
  apply(selection, countries, groups, chinaLines, chinaIndex) {
    const version = ++this._selectionVersion;
    this._clearStrokes();
    for (const [, overlay] of this._groupOverlays) {
      this._scene.remove(overlay.mesh);
      overlay.mesh.material.dispose();
    }
    this._groupOverlays.clear();

    if (selection.kind === "country" && selection.index >= 0) {
      const index = selection.index;
      this._fillMember("country", index, SELECT_FILL_COLOR, version);
      const rings = countries.rings[index].flat();
      if (index === chinaIndex) rings.push(...chinaLines);
      this._addStroke(rings, SELECT_STROKE_COLOR);
    } else {
      this._countryMaterial.uniforms.mask.value = emptyMaskTexture();
    }

    // Shift 多选国家：每国一块遮罩填充（琥珀）+ 成员合并描边，上限内逐国一球
    if (selection.kind === "countries") {
      for (const index of selection.countries) {
        this._fillMember("country", index, SELECT_FILL_COLOR, version);
      }
      const memberRings = [];
      for (const index of selection.countries) memberRings.push(...countries.rings[index].flat());
      this._addStroke(memberRings, SELECT_STROKE_COLOR);
    }

    if (selection.kind === "group") {
      selection.groups.forEach((groupIndex, order) => {
        const base = GROUP_COLORS[order % GROUP_COLORS.length];
        this._fillMember("group", groupIndex, { ...base, a: SELECT_FILL_COLOR.a }, version);
        const memberRings = [];
        for (const i of groups.members[groupIndex]) memberRings.push(...countries.rings[i].flat());
        this._addStroke(memberRings, { r: base.r, g: base.g, b: base.b, a: SELECT_STROKE_COLOR.a });
      });
    }
  }

  // 单个成员的遮罩填充 overlay（国家 / 编组共用），异步遮罩按版本号守卫
  _fillMember(kind, index, tint, version) {
    const material = this._makeMaterial(tint.r, tint.g, tint.b, tint.a);
    const mesh = new THREE.Mesh(this._fillSphereGeometry, material);
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    this._scene.add(mesh);
    this._groupOverlays.set(`${kind}_${index}`, { mesh, material });
    this.maskTexture(kind, index)
      .then((texture) => {
        if (version !== this._selectionVersion) return;
        material.uniforms.mask.value = texture;
      })
      .catch(() => {});
  }

  _addStroke(rings, color) {
    const terrainOpts = this._terrain
      ? { displace: (lat, lon) => this._terrain.elevationNorm(lat, lon), maxDisplace: TERRAIN_MAX_DISPLACE }
      : {};
    const geometry = buildRibbonGeometry(rings, SELECT_STROKE_WIDTH, SELECT_STROKE_RADIUS, { ...terrainOpts, simplify: 0.05 });
    const mesh = new THREE.Mesh(geometry, makeRibbonMaterial(
      new THREE.Color(color.r, color.g, color.b).getHex(), color.a));
    mesh.renderOrder = 3;
    mesh.castShadow = false;
    this._scene.add(mesh);
    this._strokes.push(mesh);
  }

  _clearStrokes() {
    for (const mesh of this._strokes) {
      this._scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._strokes = [];
  }
}
