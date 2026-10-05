use std::path::PathBuf;

use tauri::ipc::Response;
use tauri::Manager;

/// 数据集二进制回传：编译期内嵌 public/data 数据文件，IPC 单次批量回传字节，
/// 前端一次解析后常驻内存，避免每帧调用。
/// 浏览器开发（非 Tauri WebView）时前端降级走静态 fetch，同一份数据文件。
#[tauri::command]
fn dataset(name: &str) -> Response {
    eprintln!("[ipc] dataset {name}"); // 桌面验证：确认前端走 IPC 而非静态 fetch
    let bytes: &'static [u8] = match name {
        "countries" => include_bytes!("../../public/data/countries.geojson"),
        "china_lines" => include_bytes!("../../public/data/china_lines.geojson"),
        "groups" => include_bytes!("../../public/data/groups.json"),
        "provinces" => include_bytes!("../../public/data/provinces.geojson"),
        "rivers" => include_bytes!("../../public/data/rivers.geojson"),
        other => {
            let msg = format!("未知数据集 {other}");
            return Response::new(msg.into_bytes());
        }
    };
    Response::new(bytes.to_vec())
}

/// 行政区下钻 server：省市区三级按需加载，只打包国级数据（100000）。
/// 顺序：编译期内嵌（100000）→ 磁盘缓存（app_cache_dir/admin/{adcode}.json）→
/// 网络下载（longwosion/geojson-map-china 镜像；阿里 DataV areas_v3 已门禁登录）。
/// adcode 规范：省级 xx0000 → 省 children geometryProvince/{xx}.json；
/// 市级 xxxx00（四级 id 补 00）→ 区 children geometryCouties/{adcode}.json。
#[tauri::command]
async fn admin_region(app: tauri::AppHandle, adcode: String) -> Result<Response, String> {
    if adcode.is_empty() || !adcode.chars().all(|c| c.is_ascii_digit()) || adcode.len() > 6 {
        return Err(format!("非法 adcode {adcode}"));
    }
    // 市级四级 id 补 00 规范化为六位
    let adcode = if adcode.len() == 4 {
        format!("{adcode}00")
    } else {
        adcode
    };
    eprintln!("[ipc] admin_region {adcode}");

    // 国级：编译期内嵌，不发请求
    if adcode == "100000" {
        return Ok(Response::new(
            include_bytes!("../../public/data/admin/100000.json").to_vec(),
        ));
    }

    // 磁盘缓存
    let cache_path: PathBuf = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("缓存目录不可用 {e}"))?
        .join("admin")
        .join(format!("{adcode}.json"));
    if let Ok(bytes) = tokio::fs::read(&cache_path).await {
        eprintln!("[ipc] admin_region {adcode} 缓存命中");
        return Ok(Response::new(bytes));
    }

    // 网络下载：省级取 geometryProvince/{前两位}，市级取 geometryCouties/{adcode}
    let url = if adcode.ends_with("0000") {
        format!(
            "https://cdn.jsdelivr.net/gh/longwosion/geojson-map-china@master/geometryProvince/{}.json",
            &adcode[..2]
        )
    } else {
        format!(
            "https://cdn.jsdelivr.net/gh/longwosion/geojson-map-china@master/geometryCouties/{adcode}.json"
        )
    };
    let bytes = reqwest::get(&url)
        .await
        .map_err(|e| format!("下载 {adcode} 失败 {e}"))?
        .error_for_status()
        .map_err(|e| format!("下载 {adcode} 失败（无此层级数据）{e}"))?
        .bytes()
        .await
        .map_err(|e| format!("读取 {adcode} 失败 {e}"))?
        .to_vec();
    if bytes.first() != Some(&b'{') {
        return Err(format!("{adcode} 数据非 GeoJSON（源不可用）"));
    }
    if let Some(parent) = cache_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let _ = tokio::fs::write(&cache_path, &bytes).await;
    eprintln!("[ipc] admin_region {adcode} 已下载并缓存");
    Ok(Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![dataset, admin_region])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
