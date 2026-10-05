// 入口：数据加载 → 场景构建 → UI 装配与联动。

import "./ui/ui.css";
import { loadDataset } from "./data/loader.js";
import { buildCountries, buildChinaLines } from "./data/countries.js";
import { buildGroups } from "./data/groups.js";
import { createEarthScene } from "./scene/earth-scene.js";
import { createPanel } from "./ui/panel.js";
import { createBreadcrumb } from "./ui/breadcrumb.js";
import { loadRegion } from "./data/admin.js";
import { createZoomBar } from "./ui/zoombar.js";
import { createSettings, applyFullscreen } from "./ui/settings.js";
import { createLegend } from "./ui/legend.js";
import { START_LEVEL, CHINA_ISO } from "./scene/constants.js";

async function boot() {
  const [countriesFc, chinaLinesFc, groupsJson, provincesFc, riversFc] = await Promise.all([
    loadDataset("countries"),
    loadDataset("china_lines"),
    loadDataset("groups"),
    loadDataset("provinces"),
    loadDataset("rivers"),
  ]);
  const countries = buildCountries(countriesFc);
  const chinaLines = buildChinaLines(chinaLinesFc);
  const groups = buildGroups(groupsJson, countries);

  const container = document.getElementById("canvas-container");
  const overlayRoot = document.getElementById("ui-overlay");

  const scene = await createEarthScene({
    container, countries, chinaLines, groups, provinces: provincesFc, rivers: riversFc,
  });
  scene.setDrillLoader(loadRegion);
  document.getElementById("loading").remove();
  window.__earth = scene; // 调试句柄：浏览器自检用

  // ── 面板与场景联动（信号对齐 Godot 版契约）──
  // 下钻面包屑：路径回跳 / 上级 / 退出；Esc 逐级返回
  const breadcrumb = createBreadcrumb({
    overlayRoot,
    onDrillSelected() {
      // 下钻进选中的行政区
      const promise = scene.drill.intoSelected();
      breadcrumb.setLoading(true);
      promise.finally(() => breadcrumb.setLoading(false));
      promise.catch((error) => breadcrumb.setError(`下钻失败 ${error.message ?? error}`));
    },
    onUp() {
      scene.drill.up();
    },
    onExit() {
      scene.drill.exit();
    },
    onCrumb(i) {
      scene.drill.upTo(i);
    },
  });
  scene.onDrillChanged(({ active, crumbs, selected, canDrill }) => {
    breadcrumb.update({ active, crumbs, selected, canDrill });
  });
  window.addEventListener("keydown", (event) => {
    // Esc 逐级返回；栈底级直接退出下钻
    if (event.key === "Escape" && scene.drill.active) {
      if (scene.drill.stack.length <= 1) scene.drill.exit();
      else scene.drill.up();
    }
  });

  const panel = createPanel({
    overlayRoot,
    countries,
    groups,
    onCountryDrill(index) {
      // 下钻进中国（省市区动态加载）
      const drillPromise = scene.drill.into({
        adcode: "100000",
        name: "中国",
        level: "country",
        center: countries.centroids[index],
        span: 0.6,
      });
      breadcrumb.setLoading(true);
      drillPromise.finally(() => breadcrumb.setLoading(false));
      drillPromise.catch((error) => breadcrumb.setError(`加载失败 ${error.message ?? error}`));
    },
    onCountrySelect(index, toggle) {
      // 面板选国家：普通 = 选中高亮 + 旋转对准；Shift = 多选 toggle（不对准）
      if (toggle) {
        scene.toggleCountry(index);
        return;
      }
      scene.selectCountry(index);
      if (index >= 0) scene.faceCountry(index);
    },
    onGroupToggle(index) {
      // 大洲/组织维度 toggle（-1 = 全部/清空）：选中时旋转对准编组区域，
      // 缩放保持当前级别（大跨度编组切全球距离），状态由场景维护后 sync 回来
      scene.toggleGroup(index);
      if (index >= 0) scene.faceGroup(index);
    },
  });

  scene.onSelectionChanged(({ kind, index, countries: activeCountries, groups: activeGroups }) => {
    if (kind === "country") panel.syncSelection("country", index);
    else if (kind === "countries") panel.syncCountries(activeCountries);
    else if (kind === "group") panel.syncGroups(activeGroups);
    else panel.syncSelection("", -1);
  });

  // ── 缩放滑块（与机位跳转共用同一级别制，距离吸附最近级别）──
  const zoomBar = createZoomBar({
    overlayRoot,
    initialLevel: START_LEVEL,
    onLevelInput(level) {
      scene.rig.setLevel(level);
      zoomBar.setLevel(scene.rig.level());
    },
  });
  scene.onLevelChanged((level) => zoomBar.setLevel(level));

  // ── 设置面板（齿轮唯一入口）与呈现模式 ──
  const legend = createLegend({ overlayRoot, countries });
  const settings = createSettings({
    overlayRoot,
    initialMode: scene.presentationMode,
    onModeSelected(mode) {
      scene.setPresentation(mode);
    },
    onFullscreen(on) {
      applyFullscreen(on);
    },
    onOpenChange(open) {
      // 手风琴：设置面板打开收起国家面板让位，收起后恢复（不收走入口）
      panel.setCollapsed(open);
    },
  });
  scene.onPresentationChanged((mode) => {
    settings.setMode(mode);
    legend.setMode(mode);
  });

  // ── 启动默认：亚洲机位 + 选中国家（中国：高亮 + 面板行选中 + 详情展开）──
  const chinaIndex = countries.isos.indexOf(CHINA_ISO);
  if (chinaIndex >= 0) {
    scene.selectCountry(chinaIndex);
  }

  // ── 操作提示（设计稿左下）──
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "拖动旋转 · 滑块缩放";
  overlayRoot.appendChild(hint);
}

boot().catch((error) => {
  console.error(error);
  const loading = document.getElementById("loading");
  if (loading) loading.textContent = `加载失败：${error && error.message}`;
});
