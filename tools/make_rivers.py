#!/usr/bin/env python3
"""河流图层：下载 Natural Earth 50m 河流与湖心线 GeoJSON → public/data/rivers.geojson。

数据公有领域（Natural Earth）；只保留 name 与 scalrank 供渲染分级。
"""

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "public" / "data" / "rivers.geojson"
# jsdelivr 镜像优先（项目既定），GitHub raw 兜底
URLS = [
    "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_rivers_lake_centerlines.geojson",
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson",
]


def main():
    data = None
    error = None
    for url in URLS:
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                data = json.loads(response.read().decode("utf-8"))
            break
        except OSError as err:
            error = err
    if data is None:
        print(f"下载失败：{error}")
        sys.exit(1)
    features = []
    for feature in data["features"]:
        props = feature.get("properties", {})
        features.append({
            "type": "Feature",
            "properties": {
                "name": props.get("name", ""),
                "name_zh": props.get("name_zh", ""),
                "scalerank": props.get("scalerank", 0),
            },
            "geometry": feature["geometry"],
        })
    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    print(f"rivers.geojson: {len(features)} 条水线")


if __name__ == "__main__":
    main()
