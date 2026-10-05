// 指针与触屏输入 → 注视点相机：拖动地球跟着指针走（画面与指针同向，像拨动桌面
// 地球仪）；单击选中、双击对准不缩放；触屏仅单指拖动（无捏合）；滚轮步进缩放级别；
// 交互无惯性——拖动是逐事件直接映射，松手即停。

import { clamp } from "../geo.js";
import { degPerPixel } from "./camera-rig.js";
import {
  TAP_MAX_MOVEMENT, TAP_MAX_MSEC, DOUBLE_TAP_MSEC, DOUBLE_TAP_MOVEMENT, START_LEVEL,
} from "./constants.js";

export function attachControls({ container, rig, onTap, onDoubleTap, onZoomDelta, onZoomReset }) {
  const pointers = new Map(); // pointerId → 最近位置
  let primaryId = null;
  let pressX = 0, pressY = 0, pressTime = 0;
  let lastTapX = -1, lastTapY = -1, lastTapTime = 0;
  let wheelAcc = 0;

  function beginManual() {
    rig.cancel();
  }

  function rotateBy(dx, dy) {
    const degPerPx = degPerPixel(container.clientHeight);
    rig.lon -= dx * degPerPx;
    rig.lat = clamp(rig.lat + dy * degPerPx, -88, 88);
  }

  function zoomStep(step) {
    if (!onZoomDelta) return;
    beginManual();
    onZoomDelta(step);
  }

  // Cmd/Ctrl + ＋/−/0 拦截为内置缩放（＋步进一级、−回退一级、0 回默认级别），
  // 阻断浏览器页面缩放；输入框聚焦时不抢按键
  const ZOOM_KEYS = { "=": 1, "+": 1, "-": -1, _: -1 };
  window.addEventListener("keydown", function onKeyDown(event) {
    if (!(event.metaKey || event.ctrlKey)) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (event.key in ZOOM_KEYS) {
      event.preventDefault();
      zoomStep(ZOOM_KEYS[event.key]);
    } else if (event.key === "0") {
      event.preventDefault();
      beginManual();
      rig.setLevel(START_LEVEL);
      if (onZoomReset) onZoomReset();
    }
  });

  container.addEventListener("pointerdown", function onPointerDown(event) {
    if (pointers.size === 0) {
      primaryId = event.pointerId;
      pressX = event.clientX;
      pressY = event.clientY;
      pressTime = performance.now();
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginManual();
    container.setPointerCapture?.(event.pointerId);
  });

  container.addEventListener("pointermove", function onPointerMove(event) {
    const prev = pointers.get(event.pointerId);
    if (!prev) return;
    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // 触屏仅单指拖动旋转（第二根手指不参与、无捏合缩放）
    if (event.pointerId === primaryId && pointers.size === 1) {
      rotateBy(dx, dy);
    }
  });

  function pointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (event.pointerId !== primaryId) return;
    primaryId = null;
    const dt = performance.now() - pressTime;
    const dist = Math.hypot(event.clientX - pressX, event.clientY - pressY);
    if (dist > TAP_MAX_MOVEMENT || dt > TAP_MAX_MSEC) return;
    // 点击判定（位移与时长都在阈值内）：单击选中；触屏双击（350ms/32px 内）对准
    // 不缩放。鼠标双击走 dblclick 事件（合成事件不保证两对 pointerup）
    if (onTap) onTap(event.clientX, event.clientY, event.shiftKey);
    if (event.pointerType !== "mouse") {
      if (lastTapX >= 0
        && Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY) <= DOUBLE_TAP_MOVEMENT
        && performance.now() - lastTapTime <= DOUBLE_TAP_MSEC) {
        lastTapX = -1;
        if (onDoubleTap) onDoubleTap(event.clientX, event.clientY);
      } else {
        lastTapX = event.clientX;
        lastTapY = event.clientY;
        lastTapTime = performance.now();
      }
    }
  }

  container.addEventListener("pointerup", pointerUp);
  container.addEventListener("pointercancel", pointerUp);

  // 滚轮步进缩放级别（无惯性：一级一停，累计增量过阈值才步进）
  container.addEventListener("wheel", function onWheel(event) {
    event.preventDefault();
    beginManual();
    wheelAcc += event.deltaY;
    while (Math.abs(wheelAcc) >= 100) {
      const step = wheelAcc > 0 ? -1 : 1;
      wheelAcc -= step * 100;
      if (onZoomDelta) onZoomDelta(step);
    }
  }, { passive: false });

  // 防网页默认缩放：双击缩放、iOS Safari 捏合页面缩放；鼠标双击国家 = 对准不缩放
  container.addEventListener("dblclick", function onDblClick(event) {
    event.preventDefault();
    if (onDoubleTap) onDoubleTap(event.clientX, event.clientY);
  });
  const preventDefault = (event) => event.preventDefault();
  container.addEventListener("gesturestart", preventDefault);

  return {
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", pointerUp);
      container.removeEventListener("pointercancel", pointerUp);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("dblclick", onDblClick);
      container.removeEventListener("gesturestart", preventDefault);
    },
  };
}
