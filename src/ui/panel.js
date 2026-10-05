// 右侧国家面板：自 layout/panel.html 设计稿移植，行为按 Godot 版 earth_panel.gd。
// 页签「国家(N)」第一默认（排序行 + 顺序行 + 搜索框 + 手风琴列表），「选中」第二
// （大洲 / 组织两个多选维度下拉，弹层钉面板内容顶部）。
// 排序：字段（面积/人口/名称）× 顺序（正序/倒序）两维；切换字段回该字段默认方向；
// 面积与人口倒序（重要大口径国家置前）、名称正序（二字码升序）。

import { ZOOM_LEVELS } from "../scene/constants.js";

// 大洲维度顺序（用户约定）：亚洲、欧洲、北美洲、南美洲、大洋洲、非洲
const CONTINENT_DIMENSION = ["亚洲", "欧洲", "北美洲", "南美洲", "大洋洲", "非洲"];
// 组织维度优先序：其他组织排在其后（保持数据序）
const ORG_PRIORITY = ["上海合作组织", "金砖国家", "北约", "欧盟", "二十国集团", "七国集团"];
// 港澳台展示（ISO 3166-1 中国代码 + 名称前缀）
const REGION_DISPLAY = {
  HK: ["CN-HK", "中国-香港"],
  MO: ["CN-MO", "中国-澳门"],
  "CN-TW": ["CN-TW", "中国-台湾"],
};
// 七洲英→中映射；列表分组顺序与此一致（南极洲保留分组浏览，无编组）
const CONTINENT_ORDER = [
  ["Asia", "亚洲"],
  ["Europe", "欧洲"],
  ["Africa", "非洲"],
  ["North America", "北美洲"],
  ["South America", "南美洲"],
  ["Oceania", "大洋洲"],
  ["Antarctica", "南极洲"],
];
const SORT_ITEMS = [["面积", "area"], ["人口", "pop"], ["名称", "name"]];
// 各字段默认顺序：面积/人口倒序（大→小），名称正序（二字码 A→Z）
const SORT_DEFAULT_DESC = { area: true, pop: true, name: false };

// 人口短格式：≥1e8 →「14.0亿」；≥1e4 →「8899万」；否则原数字
export function fmtPop(value) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`;
  if (value >= 10000) return `${Math.round(value / 10000)}万`;
  return String(value);
}

// 面积短格式：≥100万 km² →「960万 km²」；否则保留整数
export function fmtArea(value) {
  if (value >= 1000000) return `${Math.round(value / 10000)}万 km²`;
  return `${Math.round(value)} km²`;
}

// 「35°N / 105°E」纬度 + 经度，各保留整数度，纬度在前
function fmtPos(centroid) {
  const [lon, lat] = centroid;
  return `${Math.abs(Math.round(lat))}°${lat >= 0 ? "N" : "S"} / ${Math.abs(Math.round(lon))}°${lon >= 0 ? "E" : "W"}`;
}

function continentZh(nameEn) {
  for (const [en, zh] of CONTINENT_ORDER) {
    if (en === nameEn) return zh;
  }
  return nameEn;
}

// 下钻可用国家：中国（省市区数据源就绪），其余国家待数据接入
const DRILLABLE_ISO = new Set(["CN"]);

export function createPanel({ overlayRoot, countries, groups, onCountrySelect, onGroupToggle, onCountryDrill }) {
  const groupNames = groups.names;

  // ── DOM 结构（自设计稿移植）──
  const root = document.createElement("div");
  root.innerHTML = `
    <button class="cexpand hide" type="button" aria-label="展开面板">›</button>
    <aside class="cpanel">
      <div class="chead">
        <button class="ccollapse" type="button" aria-label="收起面板">‹</button>
      </div>
      <div class="tabs">
        <button class="tab active" data-tab="countries" type="button">国家(${countries.count})</button>
        <button class="tab" data-tab="selected" type="button">选中</button>
      </div>
      <div class="pane hide" id="paneSelected">
        <div class="prow frow"><span class="flabel">大洲</span>
          <div class="dd" id="ddCont" data-ph="全部">
            <button class="ddbox" type="button"><span class="ddlabel">全部</span><span class="ddclear" title="清空多选">×</span><span class="caret">▾</span></button>
            <div class="ddpop"></div>
          </div>
        </div>
        <div class="prow frow"><span class="flabel">组织</span>
          <div class="dd" id="ddOrg" data-ph="组织">
            <button class="ddbox" type="button"><span class="ddlabel">组织</span><span class="ddclear" title="清空多选">×</span><span class="caret">▾</span></button>
            <div class="ddpop"></div>
          </div>
        </div>
      </div>
      <div class="cworld" id="paneCountries">
        <div class="prow sorter">
          <span class="sortlabel">排序</span>
          <div class="chips" id="sortChips"></div>
        </div>
        <div class="prow sorter">
          <span class="sortlabel">顺序</span>
          <div class="chips" id="orderChips"></div>
        </div>
        <div class="prow search">
          <input id="search" type="text" placeholder="搜索国家：CN / 中国" autocomplete="off" spellcheck="false">
        </div>
        <div class="clist" id="clist"></div>
      </div>
    </aside>`;
  overlayRoot.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const clist = $("#clist");
  const cpanel = root.querySelector(".cpanel");
  const cexpand = root.querySelector(".cexpand");

  // ── 面板状态 ──
  const state = {
    tab: "countries",
    sort: "area",
    orderDesc: true,
    query: "",
    openGroups: new Set(["亚洲"]),
    selected: -1,
    multiSelected: [],
    activeGroups: [],
  };

  function regionDisplay(index) {
    const iso = countries.isos[index] ?? "";
    if (REGION_DISPLAY[iso]) return REGION_DISPLAY[iso];
    if (iso === "-99" || iso === "") return ["", countries.namesZh[index]];
    return [iso, countries.namesZh[index]];
  }

  function sortCode(index) {
    const code = regionDisplay(index)[0];
    return code || "～～"; // 无码实体垫底
  }

  function matchCountry(index, text) {
    const lower = text.toLowerCase();
    const [code, name] = regionDisplay(index);
    if (code.toLowerCase().startsWith(lower)) return true;
    return name.includes(text) || countries.namesZh[index].includes(text);
  }

  // ── 手风琴列表渲染 ──
  function renderList() {
    clist.innerHTML = "";
    const query = state.query.trim();
    const total = 0;
    let rendered = 0;
    for (const [, title] of CONTINENT_ORDER) {
      const indices = [];
      for (let i = 0; i < countries.count; i++) {
        if (continentZh(countries.continents[i]) === title) indices.push(i);
      }
      let rows = indices.map((i) => ({ index: i, area: countries.areas[i], pop: countries.pops[i] }));
      if (query) rows = rows.filter((row) => matchCountry(row.index, query));
      if (!rows.length) continue;
      rows.sort(comparator());
      rendered += rows.length;
      const expanded = query ? true : state.openGroups.has(title);
      const head = document.createElement("div");
      head.className = `ghead${expanded ? " exp" : ""}`;
      head.dataset.g = title;
      const coded = indices.filter((i) => /^[A-Z]{2}$/.test(regionDisplay(i)[0])).length;
      head.innerHTML = `<span class="gtitle">${title}</span>`
        + `<span class="gcount">${coded} 国</span>`
        + `<span class="garrow">${expanded ? "▾" : "▸"}</span>`;
      clist.appendChild(head);
      if (!expanded) continue;
      for (const row of rows) {
        clist.appendChild(renderRow(row));
      }
    }
    if (!rendered) {
      const empty = document.createElement("div");
      empty.className = "cempty";
      empty.textContent = "无匹配国家";
      clist.appendChild(empty);
    }
    return total;
  }

  function comparator() {
    const desc = state.orderDesc;
    return (a, b) => {
      let result = 0;
      if (state.sort === "pop") {
        result = b.pop - a.pop;
      } else if (state.sort === "area") {
        result = b.area - a.area;
      } else {
        result = sortCode(a.index) < sortCode(b.index) ? -1 : 1;
        return desc ? -result : result;
      }
      if (result !== 0) return desc ? result : -result;
      const ca = sortCode(a.index);
      const cb = sortCode(b.index);
      return ca < cb ? -1 : ca > cb ? 1 : 0;
    };
  }

  function renderRow(row) {
    const index = row.index;
    const selected = state.selected === index || state.multiSelected.includes(index);
    const el = document.createElement("div");
    el.className = `crow${selected ? " sel" : ""}`;
    el.dataset.index = String(index);
    const [code, name] = regionDisplay(index);
    let html = `<div class="crmain"><span class="ccode">${code}</span>`
      + `<span class="cname">${name}</span>`
      + `<span class="cpop">${fmtPop(row.pop)}</span></div>`;
    if (selected) {
      const [lon, lat] = countries.centroids[index];
      html += `<div class="cdetail">`
        + `<div>大小 ${fmtArea(row.area)} · 人口 ${fmtPop(row.pop)}</div>`
        + `<div>位置 ${fmtPos([lon, lat])} · ${continentZh(countries.continents[index])}</div></div>`;
    }
    el.innerHTML = html;
    if (DRILLABLE_ISO.has(countries.isos[index])) {
      const drill = document.createElement("button");
      drill.type = "button";
      drill.className = "drill-btn";
      drill.title = "下钻省市区";
      drill.textContent = "⤵";
      drill.addEventListener("click", (event) => {
        event.stopPropagation();
        onCountryDrill(index);
      });
      el.querySelector(".crmain").appendChild(drill);
    }
    return el;
  }

  clist.addEventListener("click", (event) => {
    const head = event.target.closest(".ghead");
    if (head) {
      const g = head.dataset.g;
      if (state.openGroups.has(g)) state.openGroups.delete(g);
      else state.openGroups.add(g);
      renderList();
      return;
    }
    const row = event.target.closest(".crow");
    if (row) {
      const index = Number(row.dataset.index);
      // Shift+行点击 = 多选 toggle；普通行点击 = 选中 + 对准（与双击同语义），再点还原
      if (event.shiftKey) {
        onCountrySelect(index, true);
      } else {
        const next = state.selected === index ? -1 : index;
        onCountrySelect(next, false);
      }
    }
  });

  // 面板区域内滚轮一律就地消费，不穿透成地球操作
  cpanel.addEventListener("wheel", (event) => event.stopPropagation());

  // ── 排序与顺序 chips（items 为 [标签, 值]）──
  function buildChips(el, items, getFn, setFn) {
    function paint() {
      for (const kid of el.children) {
        kid.classList.toggle("active", kid.dataset.v === getFn());
      }
    }
    for (const [label, value] of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = label;
      button.dataset.v = value;
      button.addEventListener("click", () => {
        setFn(value);
        paint();
      });
      el.appendChild(button);
    }
    paint();
  }

  buildChips($("#sortChips"), SORT_ITEMS,
    () => state.sort,
    (key) => {
      if (state.sort === key) return;
      state.sort = key;
      state.orderDesc = SORT_DEFAULT_DESC[key];
      buildOrderChips();
      renderList();
      scrollToSelected();
    });

  const orderChipsEl = $("#orderChips");
  function buildOrderChips() {
    orderChipsEl.innerHTML = "";
    buildChips(orderChipsEl, [["正序", "正序"], ["倒序", "倒序"]],
      () => (state.orderDesc ? "倒序" : "正序"),
      (label) => {
        state.orderDesc = label === "倒序";
        renderList();
        scrollToSelected();
      });
  }
  buildOrderChips();

  // ── 搜索 ──
  $("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderList();
  });

  // ── 页签 ──
  root.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.tab = tab.dataset.tab;
      root.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      $("#paneSelected").classList.toggle("hide", state.tab !== "selected");
      $("#paneCountries").classList.toggle("hide", state.tab !== "countries");
    });
  });

  // ── 多选维度下拉（大洲首项「全部」互斥；弹层钉面板内容顶部）──
  function dimensionOptions(kind) {
    const options = [];
    if (kind === "continent") {
      options.push(["全部", "all"]);
      for (const name of CONTINENT_DIMENSION) {
        const index = groupNames.indexOf(name);
        if (index >= 0) options.push([name, String(index)]);
      }
    } else {
      for (const name of ORG_PRIORITY) {
        const index = groupNames.indexOf(name);
        if (index >= 0) options.push([name, String(index)]);
      }
      for (let i = 6; i < groupNames.length; i++) {
        if (!ORG_PRIORITY.includes(groupNames[i])) options.push([groupNames[i], String(i)]);
      }
    }
    return options;
  }

  const dropdowns = {};
  function buildDropdown(rootId, kind) {
    const dd = $(rootId);
    const label = dd.querySelector(".ddlabel");
    const pop = dd.querySelector(".ddpop");
    const options = dimensionOptions(kind);
    const values = new Set(kind === "continent" ? ["all"] : []);

    function paint() {
      const has = [...values].some((v) => v !== "all");
      dd.classList.toggle("has", has);
      const names = options.filter(([, v]) => values.has(v)).map(([n]) => n);
      label.textContent = names.length ? names.join("、")
        : (kind === "continent" ? "全部" : "组织");
      for (const item of pop.querySelectorAll(".ditem")) {
        item.classList.toggle("on", values.has(item.dataset.v));
      }
    }

    for (const [name, value] of options) {
      const item = document.createElement("div");
      item.className = "ditem";
      item.dataset.v = value;
      item.innerHTML = `<span class="tick">✓</span><span>${name}</span>`;
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        if (value === "all") {
          // 大洲首项「全部」互斥：代替全球视角，清空其余勾选
          values.clear();
          values.add("all");
          onGroupToggle(-1);
        } else if (values.has(value)) {
          values.delete(value);
          onGroupToggle(Number(value));
        } else {
          values.delete("all");
          values.add(value);
          onGroupToggle(Number(value));
        }
        paint();
      });
      pop.appendChild(item);
    }

    dd.querySelector(".ddbox").addEventListener("click", (event) => {
      event.stopPropagation();
      const wasOpen = dd.classList.contains("open");
      closeAllDropdowns();
      if (!wasOpen) dd.classList.add("open");
    });
    dd.querySelector(".ddclear").addEventListener("click", (event) => {
      event.stopPropagation();
      values.clear();
      if (kind === "continent") values.add("all");
      onGroupToggle(-1);
      paint();
    });

    paint();
    dropdowns[kind] = { dd, values, paint };
  }

  function closeAllDropdowns() {
    for (const { dd } of Object.values(dropdowns)) dd.classList.remove("open");
  }
  document.addEventListener("click", closeAllDropdowns);

  buildDropdown("#ddCont", "continent");
  buildDropdown("#ddOrg", "org");

  // ── 折叠 / 展开 ──
  function setCollapsed(collapsed) {
    cpanel.classList.toggle("collapsed", collapsed);
    cexpand.classList.toggle("hide", !collapsed);
  }

  root.querySelector(".ccollapse").addEventListener("click", () => setCollapsed(true));
  cexpand.addEventListener("click", () => setCollapsed(false));

  // ── 场景状态同步（earth 维护状态后回调）──
  function syncSelection(kind, index) {
    if (kind === "country") {
      state.activeGroups = [];
      state.multiSelected = [];
      state.selected = index;
    } else {
      state.selected = -1;
      state.multiSelected = [];
      state.activeGroups = [];
    }
    syncDropdowns();
    renderList();
    scrollToSelected();
  }

  function syncCountries(indices) {
    // Shift 多选：成员行全部高亮，与编组维度互斥
    state.selected = -1;
    state.activeGroups = [];
    state.multiSelected = [...indices];
    syncDropdowns();
    renderList();
  }

  function syncGroups(indices) {
    state.activeGroups = [...indices];
    state.selected = -1;
    state.multiSelected = [];
    syncDropdowns();
    renderList();
  }

  function syncDropdowns() {
    for (const { values, paint } of Object.values(dropdowns)) values.clear();
    for (const groupIndex of state.activeGroups) {
      const dd = groupIndex < 6 ? dropdowns.continent : dropdowns.org;
      dd.values.add(String(groupIndex));
    }
    if (![...dropdowns.continent.values].some((v) => v !== "all")) {
      dropdowns.continent.values.add("all");
    }
    for (const { paint } of Object.values(dropdowns)) paint();
  }

  function scrollToSelected() {
    if (state.selected < 0) return;
    const row = clist.querySelector(`.crow[data-index="${state.selected}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }

  renderList();

  return { syncSelection, syncCountries, syncGroups, setCollapsed };
}
