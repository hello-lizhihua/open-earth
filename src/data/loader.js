// 数据加载：Tauri 下走 IPC 二进制回传（dataset 命令），浏览器开发降级静态 fetch。
// 三份数据集：countries（242 国 GeoJSON）、china_lines（十段线）、groups（编组清单）。

const FILES = {
  countries: "countries.geojson",
  china_lines: "china_lines.geojson",
  groups: "groups.json",
  provinces: "provinces.geojson",
  rivers: "rivers.geojson",
};

const cache = new Map();

function isTauri() {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

async function invokeDataset(name) {
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke("dataset", { name });
  if (bytes instanceof ArrayBuffer) return new TextDecoder().decode(bytes);
  // Response 通道失败时回退为数组形态字节
  if (Array.isArray(bytes)) return new TextDecoder().decode(new Uint8Array(bytes));
  return String(bytes);
}

export function loadDataset(name) {
  if (cache.has(name)) return cache.get(name);
  const pending = (async () => {
    if (isTauri()) {
      try {
        return JSON.parse(await invokeDataset(name));
      } catch (error) {
        console.warn(`IPC 数据集 ${name} 失败，降级静态加载`, error);
      }
    }
    const response = await fetch(`./data/${FILES[name]}`);
    if (!response.ok) throw new Error(`数据集 ${name} 加载失败：${response.status}`);
    return response.json();
  })();
  cache.set(name, pending);
  return pending;
}

// 静态二进制资产（遮罩 / 贴图）始终 fetch：按需加载，浏览器缓存接管
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`图片加载失败 ${url}`));
    image.src = url;
  });
}
