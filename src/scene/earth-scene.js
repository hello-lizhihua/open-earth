// 地球场景编排：globe.gl 承载场景与渲染循环（WebGL2 渲染器、大气辉光），自建
// 高程位移球体 + 国界描边 + 选中高亮 + 丝绸幕布 + 国家名标签；呈现模式就地切换
// （换底图贴图，场景不重载）。

import * as THREE from "three";
import Globe from "globe.gl";
import { buildParamSphere, buildRibbonGeometry, buildFlatFillGeometry, makeRibbonMaterial } from "./meshes.js";
import { loadTerrain } from "./terrain.js";
import { CameraRig, zoomLevelDistance, levelOfDistance } from "./camera-rig.js";
import { attachControls } from "./controls.js";
import { HighlightLayer } from "./highlight.js";
import { CountryLabels } from "./labels.js";
import { vector3ToLatLng } from "../geo.js";
import {
  parseAdminRegions, pickAdminRegion, buildRegionFillGeometry, levelForSpan, ACTIVE_ADMIN,
} from "./drill.js";
import {
  GLOBE_RADIUS, TERRAIN_MAX_DISPLACE, BORDER_RADIUS, BORDER_WIDTH, BORDER_COLOR, BORDER_OPACITY,
  PROVINCE_RADIUS, PROVINCE_WIDTH, PROVINCE_COLOR, PROVINCE_OPACITY, PROVINCE_DASH,
  RIVER_RADIUS, RIVER_WIDTH, RIVER_COLOR, RIVER_OPACITY,
  START_LAT, START_LON, START_LEVEL, GLOBAL_LEVEL, GROUP_GLOBAL_SPAN,
  CHINA_ISO, ZOOM_LEVELS, MULTI_SELECT_LIMIT,
} from "./constants.js";

const TEXTURES = {
  stylized: "textures/earth/stylized_map_hillshade.png",
  satellite: "textures/earth/blue_marble.jpg",
  political: "textures/earth/political_map.png",
  population: "textures/earth/population_map.png",
  gdp: "textures/earth/gdp_map.png",
};

const BACKDROP_COLOR = { r: 0.952, g: 0.937, b: 0.912 };

export async function createEarthScene({ container, countries, chinaLines, groups, provinces, rivers }) {
  const terrain = await loadTerrain("textures/earth/terrain_height.png").catch((error) => {
    console.warn("高程贴图加载失败，以无位移球体运行", error);
    return null;
  });

  const chinaIndex = countries.isos.indexOf(CHINA_ISO);

  // globe.gl：场景与渲染循环 + 大气辉光；默认球体不用（自建位移球体）
  const world = new Globe(container, { rendererConfig: { alpha: true, antialias: true } })
    .width(container.clientWidth)
    .height(container.clientHeight)
    .backgroundColor("rgba(0,0,0,0)")
    .showGlobe(false)
    .showGraticules(false)
    .showAtmosphere(true)
    .atmosphereColor("#9db8d2")
    .atmosphereAltitude(0.12);

  const scene = world.scene();
  const camera = world.camera();
  camera.fov = 50;
  camera.near = 1;
  camera.far = 15000;
  camera.updateProjectionMatrix();
  world.controls().enabled = false; // 自有注视点相机驱动，禁用环绕控制器

  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map();

  function loadTexture(url, { srgb = true } = {}) {
    const key = `${url}|${srgb}`;
    if (!textureCache.has(key)) {
      const pending = new Promise((resolve, reject) => {
        textureLoader.load(url, (texture) => {
          if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(8, world.renderer().capabilities.getMaxAnisotropy());
          resolve(texture);
        }, undefined, reject);
      });
      textureCache.set(key, pending);
    }
    return textureCache.get(key);
  }

  // ── 丝绸幕布背景：程序化丝绸贴图置天球内侧，任意机位角度背后都是幕布 ──
  const backdropTexture = await loadTexture("textures/earth/silk_backdrop.png");
  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(6000, 48, 24),
    new THREE.MeshBasicMaterial({ map: backdropTexture, side: THREE.BackSide, depthWrite: false }),
  );
  backdrop.renderOrder = -1;
  scene.add(backdrop);

  // ── 位移球体：512×256 经纬参数网格，每顶点按高程贴图 CPU 抬升（0.2 倍温和夸张）──
  const globeGeometry = buildParamSphere(GLOBE_RADIUS, 512, 256, terrain
    ? { displace: (lat, lon) => terrain.elevationNorm(lat, lon), maxDisplace: TERRAIN_MAX_DISPLACE }
    : undefined);
  const globeMaterial = new THREE.MeshBasicMaterial({});
  const globeMesh = new THREE.Mesh(globeGeometry, globeMaterial);
  scene.add(globeMesh);

  let provinceMaterial = null; // 省界材质（渲染循环按相机高度淡出）
  let borderMaterial = null; // 国界材质
  let adminFadeMaterials = []; // 下钻活动层 + 选中描边材质（同省界淡出）
  // ── 国界描边（琥珀色，随地形起伏）：全部国家全部环按球面窄带成网格；
  //    十段线细带三角化填充。描边不随地形会被高海拔山体埋住 ──
  const terrainDisplace = terrain
    ? (lat, lon) => terrain.elevationNorm(lat, lon)
    : null;
  const terrainOpts = { displace: terrainDisplace, maxDisplace: TERRAIN_MAX_DISPLACE };
  {
    const allRings = [];
    for (let i = 0; i < countries.count; i++) {
      for (const polygon of countries.rings[i]) allRings.push(...polygon);
    }
    const bordersGeometry = buildRibbonGeometry(allRings, BORDER_WIDTH, BORDER_RADIUS, { ...terrainOpts, dedupe: true, simplify: 0.05 });
    const bordersMaterial = makeRibbonMaterial(BORDER_COLOR, BORDER_OPACITY);
    borderMaterial = bordersMaterial;
    const bordersMesh = new THREE.Mesh(bordersGeometry, bordersMaterial);
    bordersMesh.renderOrder = 1;
    scene.add(bordersMesh);

    const linesGeometry = buildFlatFillGeometry(chinaLines, BORDER_RADIUS);
    const linesMesh = new THREE.Mesh(linesGeometry, bordersMaterial);
    linesMesh.renderOrder = 1;
    scene.add(linesMesh);
  }

  // ── 省界细描边：比国界细一档（暗色），独立于国界表达，随地形起伏 ──
  {
    const provinceRings = [];
    for (const feature of provinces.features) {
      const geometry = feature.geometry;
      const polygons = geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.coordinates;
      for (const polygon of polygons) provinceRings.push(...polygon);
    }
    const provinceGeometry = buildRibbonGeometry(provinceRings, PROVINCE_WIDTH, PROVINCE_RADIUS, {
      ...terrainOpts,
      dash: PROVINCE_DASH,
      dedupe: true,
      simplify: 0.08,
    });
    // 省界只在较大范围显示：按相机离地高淡出（级 9-10 隐去），微段抽稀防柴堆
    const provinceMesh = new THREE.Mesh(provinceGeometry, makeRibbonMaterial(PROVINCE_COLOR, PROVINCE_OPACITY));
    provinceMesh.renderOrder = 1;
    scene.add(provinceMesh);
    provinceMaterial = provinceMesh.material;
  }

  // ── 河流水线：开放折线窄带（Natural Earth 50m 河流与湖心线），随地形起伏 ──
  {
    const riverLines = [];
    for (const feature of rivers.features) {
      const geometry = feature.geometry;
      if (!geometry) continue;
      const lines = geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString" ? geometry.coordinates : [];
      for (const line of lines) {
        if (line.length >= 2) riverLines.push(line);
      }
    }
    const riverGeometry = buildRibbonGeometry(riverLines, RIVER_WIDTH, RIVER_RADIUS, { ...terrainOpts, closed: false, simplify: 0.02 });
    const riverMesh = new THREE.Mesh(riverGeometry, makeRibbonMaterial(RIVER_COLOR, RIVER_OPACITY));
    riverMesh.renderOrder = 1;
    scene.add(riverMesh);
  }

  const highlight = new HighlightLayer(scene, {
    heightTexture: terrain ? await loadTexture("textures/earth/terrain_height.png", { srgb: false }) : null,
    terrain,
  });

  const labels = new CountryLabels(scene, countries, terrain);
  labels.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(labels.domElement);

  // ── 选中状态（国家单选 / Shift 多选 / 编组多选三者互斥）──
  const selection = { kind: "", index: -1, countries: [], groups: [] };
  const listeners = { selectionChanged: [], levelChanged: [], presentationChanged: [] };

  function emitSelectionChanged() {
    for (const fn of listeners.selectionChanged) {
      fn({ ...selection, countries: [...selection.countries], groups: [...selection.groups] });
    }
  }

  function rebuildHighlight() {
    highlight.apply(selection, countries, groups, chinaLines, chinaIndex);
  }

  function selectCountry(index) {
    // 选中国家：-1 取消；不改缩放（对准由调用方驱动）；与多选、编组互斥
    selection.kind = index >= 0 ? "country" : "";
    selection.index = index;
    selection.countries = [];
    selection.groups = [];
    rebuildHighlight();
    emitSelectionChanged();
  }

  function toggleCountry(index) {
    // Shift 多选 toggle：当前单选并入多选集；多选与编组互斥
    if (index < 0) return;
    selection.groups = [];
    if (selection.kind === "country" && selection.index >= 0) {
      selection.countries = [selection.index];
      selection.index = -1;
    }
    if (selection.countries.includes(index)) {
      selection.countries = selection.countries.filter((i) => i !== index);
    } else if (selection.countries.length < MULTI_SELECT_LIMIT) {
      selection.countries.push(index);
    }
    selection.kind = selection.countries.length ? "countries" : "";
    rebuildHighlight();
    emitSelectionChanged();
  }

  function toggleGroup(index) {
    // 编组多选 toggle：已在列表则移除，否则追加；-1 清除全部
    if (index < 0) {
      selection.groups = [];
    } else if (selection.groups.includes(index)) {
      selection.groups = selection.groups.filter((i) => i !== index);
    } else {
      selection.groups = [...selection.groups, index];
    }
    selection.kind = selection.groups.length ? "group" : "";
    selection.index = -1;
    rebuildHighlight();
    emitSelectionChanged();
  }

  // ── 相机与输入 ──
  const rig = new CameraRig(START_LAT, START_LON, zoomLevelDistance(START_LEVEL));

  function faceCountry(index) {
    // 旋转对准国家：注视点缓动到质心，缩放保持当前级别
    if (index < 0 || index >= countries.count) return;
    const [lon, lat] = countries.centroids[index];
    rig.animateTo(lat, lon, rig.distance);
  }

  function faceGroup(index) {
    // 旋转对准编组：注视点缓动到成员质心；大跨度编组切全球机位距离
    if (index < 0 || index >= groups.names.length) return;
    const [lon, lat] = groups.centroids[index];
    const dist = groups.spans[index] > GROUP_GLOBAL_SPAN
      ? zoomLevelDistance(GLOBAL_LEVEL)
      : rig.distance;
    rig.animateTo(lat, lon, dist);
  }

  // 点击拾取：射线与单位球求交 → 交点经纬度 → 点在多边形判定（山顶附近允许偏差）
  const raycaster = new THREE.Raycaster();
  const pickSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), GLOBE_RADIUS);

  function pickCountry(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectSphere(pickSphere, hit)) return -1;
    const [lon, lat] = vector3ToLatLng(hit);
    return countries.findCountry(lat, lon);
  }

  attachControls({
    container,
    rig,
    onTap(x, y, shiftKey) {
      // 下钻态：点选行政区；正常态：Shift 多选 toggle / 普通单选
      if (drill.active) {
        drill.selectAt(x, y);
        return;
      }
      const index = pickCountry(x, y);
      if (shiftKey) toggleCountry(index);
      else selectCountry(index);
    },
    onDoubleTap(x, y) {
      // 双击国家：旋转到正前方，缩放保持当前级别
      const index = pickCountry(x, y);
      if (index >= 0) {
        selectCountry(index);
        faceCountry(index);
      }
    },
    onZoomDelta(step) {
      const level = Math.min(ZOOM_LEVELS, Math.max(1, rig.level() + step));
      rig.setLevel(level);
      emitLevelChanged();
    },
    onZoomReset() {
      // Cmd+0 回默认级别
      rig.setLevel(START_LEVEL);
      emitLevelChanged();
    },
  });

  function emitLevelChanged() {
    for (const fn of listeners.levelChanged) fn(rig.level());
  }

  // ── 呈现模式：切换即换 globe 贴图，场景不重载 ──
  let presentationMode = "stylized";

  async function setPresentation(mode) {
    if (!TEXTURES[mode]) return;
    presentationMode = mode;
    const texture = await loadTexture(TEXTURES[mode]);
    globeMaterial.map = texture;
    globeMaterial.needsUpdate = true;
    for (const fn of listeners.presentationChanged) fn(mode);
  }
  await setPresentation("stylized");
  presentationMode = "stylized";


  // ── 地图下钻：国 → 省 → 市 → 区县（client 动态加载，见 data/admin.js）──
  const drill = {
    stack: [],            // [{adcode, name, level, regions, centerLat, centerLon, span}]
    lastError: "",
    active: false,
    selectedIndex: -1,
    meshes: [],           // 活动层 + 选中高亮网格
    listeners: { drillChanged: [] },
    loadRegion: null,     // main.js 注入 loadRegion
  };

  function drillClearMeshes() {
    for (const mesh of drill.meshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose?.();
    }
    drill.meshes = [];
  }

  function drillEmit() {
    const crumbs = drill.stack.map((entry) => ({ adcode: entry.adcode, name: entry.name }));
    const current = drill.stack[drill.stack.length - 1];
    const selectedRegion = current?.regions[drill.selectedIndex];
    // 栈深即层级：0=省级 1=市级 2=区级；区级（栈深 3）不可再下
    for (const fn of drill.listeners.drillChanged) {
      fn({
        active: drill.active,
        crumbs,
        selected: selectedRegion?.name ?? "",
        canDrill: !!selectedRegion && drill.stack.length < 3,
      });
    }
  }

  drill.selectedName = () => {
    if (drill.selectedIndex < 0) return "";
    const regions = drill.stack[drill.stack.length - 1]?.regions;
    return regions?.[drill.selectedIndex]?.name ?? "";
  };

  // 重建活动层：本级 children 描边（醒目）+ 选中行政区填充与描边
  function drillRebuildLayer() {
    drillClearMeshes();
    if (!drill.active) return;
    const current = drill.stack[drill.stack.length - 1];
    const rings = [];
    for (const region of current.regions) {
      for (const polygon of region.polygons) rings.push(...polygon);
    }
    const boundary = buildRibbonGeometry(rings, ACTIVE_ADMIN.width, ACTIVE_ADMIN.radius, { ...terrainOpts, dedupe: true, simplify: 0.08 });
    const boundaryMaterial = makeRibbonMaterial(ACTIVE_ADMIN.color, ACTIVE_ADMIN.opacity);
    boundaryMaterial.userData.baseOpacity = ACTIVE_ADMIN.opacity;
    adminFadeMaterials = [boundaryMaterial];
    const boundaryMesh = new THREE.Mesh(boundary, boundaryMaterial);
    boundaryMesh.renderOrder = 1;
    scene.add(boundaryMesh);
    drill.meshes.push(boundaryMesh);

    if (drill.selectedIndex >= 0 && current.regions[drill.selectedIndex]) {
      const region = current.regions[drill.selectedIndex];
      const fillGeometry = buildRegionFillGeometry(region, terrain, GLOBE_RADIUS);
      const fillMesh = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
        color: 0xffcc33,
        opacity: 0.45,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }));
      fillMesh.renderOrder = 2;
      scene.add(fillMesh);
      drill.meshes.push(fillMesh);

      const strokeRings = [];
      for (const polygon of region.polygons) strokeRings.push(...polygon);
      const strokeGeometry = buildRibbonGeometry(strokeRings, 1.2, GLOBE_RADIUS * 1.004, { ...terrainOpts, simplify: 0.08 });
      const strokeMaterial = makeRibbonMaterial(0xffd75e, 0.95);
      strokeMaterial.userData.baseOpacity = 0.95;
      adminFadeMaterials.push(strokeMaterial);
      const strokeMesh = new THREE.Mesh(strokeGeometry, strokeMaterial);
      strokeMesh.renderOrder = 3;
      scene.add(strokeMesh);
      drill.meshes.push(strokeMesh);
    }
  }

  // 进入某行政区：加载其 children，压栈，相机适配跨度
  async function drillInto(region) {
    if (!drill.loadRegion || !region.adcode) return;
    if (drill.stack.length >= 3) return; // 区级已是公开数据最细层级
    try {
      const fc = await drill.loadRegion(region.adcode);
      const regions = parseAdminRegions(fc);
      drill.stack.push({
        adcode: region.adcode,
        name: region.name,
        level: region.level,
        regions,
        centerLat: region.center[1],
        centerLon: region.center[0],
        span: region.span,
      });
      drill.active = true;
      drill.selectedIndex = -1;
      drillRebuildLayer();
      rig.animateTo(region.center[1], region.center[0], zoomLevelDistance(levelForSpan(region.span)));
      drillEmit();
    } catch (error) {
      drill.lastError = String(error && error.message || error);
      drillEmit();
      throw error;
    }
  }

  // 返回上级：弹栈并回到上级视角
  function drillUp() {
    if (!drill.active || drill.stack.length <= 1) return;
    drill.stack.pop();
    drill.selectedIndex = -1;
    drillRebuildLayer();
    const current = drill.stack[drill.stack.length - 1];
    const span = Math.max(...current.regions.map((r) => r.span), 0.05);
    rig.animateTo(current.centerLat, current.centerLon, zoomLevelDistance(levelForSpan(span)));
    drillEmit();
  }

  // 回跳到面包屑某级：弹栈至该级并重建层与视角
  function drillUpTo(index) {
    if (!drill.active) return;
    const target = index + 1;
    if (target < 1 || drill.stack.length <= target) return;
    while (drill.stack.length > target) drill.stack.pop();
    drill.selectedIndex = -1;
    drillRebuildLayer();
    const current = drill.stack[drill.stack.length - 1];
    const span = Math.max(...current.regions.map((r) => r.span), 0.05);
    rig.animateTo(current.centerLat, current.centerLon, zoomLevelDistance(levelForSpan(span)));
    drillEmit();
  }

  // 退出下钻：清栈清层
  function drillExit() {
    drill.active = false;
    drill.stack = [];
    drill.selectedIndex = -1;
    drillClearMeshes();
    drillEmit();
  }

  drill.selectedRegion = () => {
    const current = drill.stack[drill.stack.length - 1];
    const region = current?.regions[drill.selectedIndex];
    if (!region) return null;
    return { adcode: region.adcode, name: region.name, level: region.level, center: region.center, span: region.span };
  };

  drill.intoSelected = () => {
    const region = drill.selectedRegion();
    if (region) return drillInto(region);
    return Promise.resolve();
  };

  drill.selectAt = (x, y) => {
    if (!drill.active) return;
    const current = drill.stack[drill.stack.length - 1];
    const hit = screenLatLng(x, y);
    drill.selectedIndex = hit ? pickAdminRegion(current.regions, hit[1], hit[0]) : -1;
    drillRebuildLayer();
    drillEmit();
  };

  drill.up = drillUp;
  drill.upTo = drillUpTo;
  drill.exit = drillExit;
  drill.into = drillInto;

  // 屏幕点 → 经纬（下钻拾取用）
  const adminRaycaster = new THREE.Raycaster();
  function screenLatLng(x, y) {
    const rect = container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    );
    adminRaycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!adminRaycaster.ray.intersectSphere(pickSphere, hit)) return null;
    return vector3ToLatLng(hit);
  }

  // ── 渲染循环：globe.gl 自带 tick 负责渲染，这里推进相机与标签 LOD ──
  const tick = () => {
    rig.update();
    rig.applyTo(camera);
    labels.update(camera, rig.distance, container.clientHeight);
    // 描边按相机离地高淡出：省界级 8（高 86）全显、级 9-10 隐去；
    // 国界贴地降到 0.25（微段折叠在最近视角不可见性兜底）；下钻活动层随省界
    const height = rig.distance - GLOBE_RADIUS;
    if (provinceMaterial) {
      provinceMaterial.opacity = PROVINCE_OPACITY * Math.max(0, Math.min(1, (height - 30) / 40));
    }
    if (borderMaterial) {
      borderMaterial.opacity = BORDER_OPACITY * Math.max(0.25, Math.min(1, (height - 8) / 30));
    }
    for (const material of adminFadeMaterials) {
      material.opacity = Math.max(0, Math.min(1, (height - 14) / 30)) * (material.userData.baseOpacity ?? 0.95);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  function resize() {
    world.width(container.clientWidth);
    world.height(container.clientHeight);
    labels.setSize(container.clientWidth, container.clientHeight);
  }
  window.addEventListener("resize", resize);

  return {
    world,
    rig,
    selection,
    countries,
    groups,
    chinaIndex,
    selectCountry,
    toggleCountry,
    toggleGroup,
    faceCountry,
    faceGroup,
    pickCountry,
    setPresentation,
    levelOfDistance,
    zoomLevelDistance,
    get presentationMode() {
      return presentationMode;
    },
    drill,
    setDrillLoader(fn) {
      drill.loadRegion = fn;
    },
    onDrillChanged(fn) {
      drill.listeners.drillChanged.push(fn);
    },
    onSelectionChanged(fn) {
      listeners.selectionChanged.push(fn);
    },
    onLevelChanged(fn) {
      listeners.levelChanged.push(fn);
    },
    onPresentationChanged(fn) {
      listeners.presentationChanged.push(fn);
    },
  };
}
