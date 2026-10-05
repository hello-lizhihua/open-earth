// 设置面板：齿轮设置图标（设置唯一入口），点击展开、再点图标或点面板外收起；
// 打开时收起国家面板（手风琴互不遮挡），收起后恢复。
// 设置项：全屏开关 + 呈现模式单选（模拟地图/卫星影像/政治区划/人口着色/经济着色），
// 就地生效不重载场景。

import { PRESENTATION_OPTIONS } from "../scene/constants.js";

export function createSettings({ overlayRoot, initialMode, onModeSelected, onFullscreen, onOpenChange }) {
  let mode = initialMode;
  let fullscreenOn = false;
  let opened = false;

  const gear = document.createElement("button");
  gear.className = "cbtn";
  gear.id = "gearBtn";
  gear.title = "设置";
  gear.setAttribute("aria-label", "设置");
  gear.innerHTML = `<svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="#f0ede6" stroke-width="1.6" stroke-linecap="round" opacity=".92">
      <circle cx="16" cy="16" r="7"/>
      <circle cx="16" cy="16" r="2.6"/>
      <path d="M25.6 16 L29 16"/><path d="M22.8 22.8 L25.2 25.2"/><path d="M16 25.6 L16 29"/><path d="M9.2 22.8 L6.8 25.2"/>
      <path d="M6.4 16 L3 16"/><path d="M9.2 9.2 L6.8 6.8"/><path d="M16 6.4 L16 3"/><path d="M22.8 9.2 L25.2 6.8"/>
    </svg>`;

  const panel = document.createElement("div");
  panel.className = "settings hide";
  panel.innerHTML = `
    <div class="set-row"><span>全屏</span><button class="switch" id="fsSwitch" type="button" aria-label="全屏开关"><span class="knob"></span></button></div>
    <div class="sep"></div>`;
  const mapTypes = document.createElement("div");
  for (const option of PRESENTATION_OPTIONS) {
    const row = document.createElement("div");
    row.className = "set-row mrow";
    row.dataset.value = option.value;
    row.innerHTML = `<span>${option.label}</span><span class="mdot"></span>`;
    row.addEventListener("click", () => {
      onModeSelected(option.value);
    });
    mapTypes.appendChild(row);
  }
  panel.appendChild(mapTypes);
  overlayRoot.appendChild(gear);
  overlayRoot.appendChild(panel);

  function paint() {
    for (const row of mapTypes.querySelectorAll(".mrow")) {
      row.classList.toggle("sel", row.dataset.value === mode);
    }
    panel.querySelector("#fsSwitch").classList.toggle("on", fullscreenOn);
  }

  // 展开 / 收起（齿轮与面板外点击共用入口）；开合回调驱动国家面板手风琴让位
  function setOpen(open) {
    if (opened === open) return;
    opened = open;
    panel.classList.toggle("hide", !open);
    onOpenChange?.(open);
  }

  gear.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(!opened);
  });
  document.addEventListener("click", (event) => {
    if (!opened || panel.contains(event.target)) return;
    setOpen(false);
  });
  panel.addEventListener("click", (event) => event.stopPropagation());

  panel.querySelector("#fsSwitch").addEventListener("click", () => {
    fullscreenOn = !fullscreenOn;
    onFullscreen(fullscreenOn);
    paint();
  });

  paint();

  return {
    get isOpen() { return opened; },
    setOpen,
    setMode(next) {
      mode = next;
      paint();
    },
    setFullscreen(on) {
      fullscreenOn = on;
      paint();
    },
  };
}

// 全屏开关：Tauri 窗口 API 优先，浏览器降级 Fullscreen API
export function applyFullscreen(on) {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().setFullscreen(on);
    }).catch(() => {});
    return;
  }
  if (on) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}
