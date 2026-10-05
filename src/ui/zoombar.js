// 左上控制排：设置齿轮（设置唯一入口）+ 缩放滑块（10 级）。
// 自 layout/panel.html 设计稿移植：齿轮中心距左 40，胶囊左缘距左 72，
// 轨道 10 档刻度、滑块随级别；轨道点击 / 拖动定级，＋/− 步进。

import { ZOOM_LEVELS } from "../scene/constants.js";

export function createZoomBar({ overlayRoot, initialLevel, onLevelInput }) {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="zoom">
      <button class="zbtn" id="zoomOut" type="button" aria-label="缩小">−</button>
      <div class="ztrack" id="ztrack">
        <div class="zticks" id="zticks"></div>
        <div class="zthumb" id="zthumb"></div>
      </div>
      <button class="zbtn" id="zoomIn" type="button" aria-label="放大">＋</button>
    </div>`;
  overlayRoot.appendChild(root);

  const ztrack = root.querySelector("#ztrack");
  const zticks = root.querySelector("#zticks");
  const zthumb = root.querySelector("#zthumb");

  for (let i = 0; i < ZOOM_LEVELS; i++) {
    const tick = document.createElement("div");
    tick.className = "ztick";
    tick.style.left = `${(i / (ZOOM_LEVELS - 1)) * (ztrack.clientWidth || 88)}px`;
    zticks.appendChild(tick);
  }

  let level = initialLevel;

  function paint() {
    const width = ztrack.clientWidth || 88;
    zthumb.style.left = `${((level - 1) / (ZOOM_LEVELS - 1)) * width}px`;
    for (let i = 0; i < zticks.children.length; i++) {
      zticks.children[i].classList.toggle("on", i < level);
    }
  }

  function setLevel(next) {
    level = Math.min(ZOOM_LEVELS, Math.max(1, next));
    paint();
  }

  function levelFromEvent(event) {
    const rect = ztrack.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return Math.round(1 + t * (ZOOM_LEVELS - 1));
  }

  ztrack.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    onLevelInput(levelFromEvent(event));
    const move = (e) => onLevelInput(levelFromEvent(e));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  root.querySelector("#zoomIn").addEventListener("click", () => onLevelInput(level + 1));
  root.querySelector("#zoomOut").addEventListener("click", () => onLevelInput(level - 1));

  setLevel(initialLevel);

  return { setLevel, get level() { return level; } };
}
