// 数据着色图例：左下渐变条 + 端值标签（0 → 最大端），仅分级统计模式
// （人口着色 / 经济着色）可见。

import { fmtPop } from "./panel.js";

const RAMP_LOW = "#fff4c7";
const RAMP_HIGH = "#9e2114";

export function createLegend({ overlayRoot, countries }) {
  let popMax = 0;
  let gdpMax = 0;
  for (let i = 0; i < countries.count; i++) {
    popMax = Math.max(popMax, countries.pops[i]);
    gdpMax = Math.max(gdpMax, countries.gdps[i]);
  }

  const root = document.createElement("div");
  root.className = "legend hide";
  root.innerHTML = `
    <div class="ltitle">人口</div>
    <div class="lbar"></div>
    <div class="lends"><span>0</span><span id="legendMax"></span></div>`;
  overlayRoot.appendChild(root);

  function setMode(mode) {
    root.classList.toggle("hide", mode !== "population" && mode !== "gdp");
    if (mode === "population") {
      root.querySelector(".ltitle").textContent = "人口";
      root.querySelector("#legendMax").textContent = `${(popMax / 100000000).toFixed(1)}亿人`;
    } else if (mode === "gdp") {
      root.querySelector(".ltitle").textContent = "经济总量（GDP）";
      root.querySelector("#legendMax").textContent = `${Math.round(gdpMax / 1000000)}万亿美元`;
    }
  }

  return { setMode };
}
