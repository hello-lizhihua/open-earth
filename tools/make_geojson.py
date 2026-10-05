#!/usr/bin/env python3
"""数据管线：map-godot countries.json → GeoJSON，复制编组/遮罩/贴图资产。

源：../../godot/map-godot/assets/data/countries.json（rings/centroid 为字符串化 JSON）
产物（public/）：
- data/countries.geojson   242 国 FeatureCollection（MultiPolygon，[lon, lat]）
- data/china_lines.geojson 十段线 10 段（细带 Polygon）
- data/groups.json         编组清单原样复制
- data/masks/              选中遮罩 country_<i>.png / group_<i>.png 原样复制
- textures/earth/          底图与高程贴图原样复制

索引约定：遮罩 country_<i> 对齐 countries.geojson 的 feature 顺序；
group_<i> 前 6 项为大洲组（亚洲欧洲非洲北美洲南美洲大洋洲），其后为 groups.json 组织序。

多边形并集：countries.json 的中国为 DataV 34 省级要素（合并不彻底，环内含省界），
用 shapely unary_union 溶解（venv：tools/.venv，含 shapely）；shapely 不可用时原样保留。
"""

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT.parents[2] / "godot" / "map-godot" / "assets"
OUT = ROOT.parent / "public"

try:
    import shapely
    import shapely.geometry as sgeom
except ImportError:
    shapely = None
    sgeom = None


def parse_json_field(value):
    """字段可能为字符串化 JSON 或原生 JSON（手工新增条目未字符串化），两种形态兼容"""
    if isinstance(value, str):
        return json.loads(value)
    return value


def dissolve(geometry):
    """单国多边形并集：溶解内部共享边（中国省级要素合并）"""
    if sgeom is None:
        return geometry
    shape = sgeom.shape(geometry)
    if not isinstance(shape, sgeom.MultiPolygon) or len(shape.geoms) < 2:
        return geometry
    # DataV 省界存在自相交，buffer(0) 修复无效几何后再并集
    parts = [part if part.is_valid else part.buffer(0) for part in shape.geoms]
    merged = shapely.union_all([p for p in parts if not p.is_empty])
    if merged.is_empty:
        return geometry
    geojson = sgeom.mapping(merged)
    if geojson["type"] == "Polygon":
        geojson["coordinates"] = [ring[: len(ring)] for ring in geojson["coordinates"]]
    return geojson


def parse_lists(country: dict) -> dict:
    return {
        "name": country["name"],
        "name_zh": country["name_zh"],
        "continent": country["continent"],
        "subregion": country["subregion"],
        "iso": country["iso"],
        "pop": int(country["pop"]),
        "gdp": int(country["gdp"]),
        "area": float(country["area"]),
        "centroid": parse_json_field(country["centroid"]),
    }


def main() -> None:
    data = json.loads((SRC / "data" / "countries.json").read_text(encoding="utf-8"))

    countries = []
    for country in data["countries"]:
        props = parse_lists(country)
        rings = parse_json_field(country["rings"])
        if len(rings) == 1:
            geometry = {"type": "Polygon", "coordinates": rings[0]}
        else:
            geometry = {"type": "MultiPolygon", "coordinates": rings}
        geometry = dissolve(geometry)
        countries.append({"type": "Feature", "properties": props, "geometry": geometry})

    lines = []
    for ring in data.get("china_lines", []):
        lines.append({
            "type": "Feature",
            "properties": {"kind": "china_line"},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })

    out_data = OUT / "data"
    out_data.mkdir(parents=True, exist_ok=True)
    (out_data / "countries.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": countries},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    (out_data / "china_lines.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": lines},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    shutil.copyfile(SRC / "data" / "groups.json", out_data / "groups.json")

    for name in ("masks",):
        src_dir = SRC / "data" / name
        dst_dir = out_data / name
        if dst_dir.exists():
            shutil.rmtree(dst_dir)
        shutil.copytree(src_dir, dst_dir, ignore=shutil.ignore_patterns("*.import"))

    out_tex = OUT / "textures" / "earth"
    out_tex.mkdir(parents=True, exist_ok=True)
    for tex in (SRC / "textures" / "earth").iterdir():
        if tex.suffix in (".png", ".jpg"):
            shutil.copyfile(tex, out_tex / tex.name)

    print(f"countries.geojson: {len(countries)} 国")
    print(f"china_lines.geojson: {len(lines)} 段")
    print(f"masks: {len(list((out_data / 'masks').glob('country_*.png')))} 国 + "
          f"{len(list((out_data / 'masks').glob('group_*.png')))} 组")
    print(f"textures: {len(list(out_tex.iterdir()))} 张")


if __name__ == "__main__":
    main()
