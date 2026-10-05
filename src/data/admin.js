// 行政区下钻 client：按 adcode 动态加载省市区边界。
// Tauri 走 IPC（Rust 端内置国级 → 磁盘缓存 → 网络下载并落盘）；浏览器开发直连
// 镜像源（国级走本地打包文件），会话内内存缓存。
// 数据源：longwosion/geojson-map-china（jsdelivr 镜像）；阿里 DataV areas_v3 已门禁。

const memoryCache = new Map();

function isTauri() {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

// 市级四级 id 补 00 规范化为六位（3706 → 370600）
function normalizeAdcode(adcode) {
  return adcode.length === 4 ? `${adcode}00` : adcode;
}

function mirrorUrl(adcode) {
  const base = "https://cdn.jsdelivr.net/gh/longwosion/geojson-map-china@master";
  if (adcode.endsWith("0000")) {
    return `${base}/geometryProvince/${adcode.slice(0, 2)}.json`;
  }
  return `${base}/geometryCouties/${adcode}.json`;
}

async function invokeRegion(adcode) {
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke("admin_region", { adcode });
  if (bytes instanceof ArrayBuffer) return new TextDecoder().decode(bytes);
  if (Array.isArray(bytes)) return new TextDecoder().decode(new Uint8Array(bytes));
  return String(bytes);
}

export function loadRegion(rawAdcode) {
  const adcode = normalizeAdcode(rawAdcode);
  if (memoryCache.has(adcode)) return memoryCache.get(adcode);
  const pending = (async () => {
    if (isTauri()) {
      try {
        return JSON.parse(await invokeRegion(adcode));
      } catch (error) {
        console.warn(`IPC 行政区 ${adcode} 失败，降级网络加载`, error);
      }
    }
    if (adcode === "100000") {
      const response = await fetch("./data/admin/100000.json");
      if (!response.ok) throw new Error(`国级行政区加载失败 ${response.status}`);
      return response.json();
    }
    const response = await fetch(mirrorUrl(adcode));
    if (!response.ok) throw new Error(`行政区 ${adcode} 加载失败 ${response.status}`);
    const text = await response.text();
    return JSON.parse(text.replace(/^\uFEFF/, "")); // 源文件可能带 BOM
  })();
  memoryCache.set(adcode, pending);
  return pending;
}
