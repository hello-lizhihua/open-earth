#!/usr/bin/env python3
"""省界图层：DataV datav_china.json → public/data/provinces.geojson。

34 省级要素（十段线 adchar=JD 剔除，十段线已有独立数据），逐省多边形并集
（缓冲修复 DataV 自相交）；properties 保留 name/adcode。
运行：tools/.venv/bin/python tools/make_provinces.py（venv 含 shapely）
"""

import json
from pathlib import Path

import shapely
import shapely.geometry as sgeom

ROOT = Path(__file__).resolve().parent
SRC = ROOT.parents[2] / "godot" / "map-godot" / "assets" / "data" / "datav_china.json"
OUT = ROOT.parent / "public" / "data" / "provinces.geojson"


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    features = []
    for feature in data["features"]:
        props = feature.get("properties", {})
        if props.get("adchar") == "JD":
            continue  # 十段线细带：独立数据渲染，不进省界
        shape = sgeom.shape(feature["geometry"])
        parts = [part if part.is_valid else part.buffer(0) for part in (
            shape.geoms if isinstance(shape, sgeom.MultiPolygon) else [shape])]
        merged = shapely.union_all([p for p in parts if not p.is_empty])
        features.append({
            "type": "Feature",
            "properties": {"name": props.get("name", ""), "adcode": props.get("adcode")},
            "geometry": sgeom.mapping(merged),
        })
    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    print(f"provinces.geojson: {len(features)} 省")


if __name__ == "__main__":
    main()
