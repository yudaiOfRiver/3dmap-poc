"""
国交省 新宿駅屋内地図 Shapefile → GeoJSON 変換スクリプト

入力: data/raw/shapefile/ 以下の各エリア・フロアのShapefile
出力: public/data/floors/<フロアキー>.json （フロアごとに全エリア統合）

座標系: EPSG:6668 (JGD2011) → メートル単位ローカル座標
  - 中心点を原点としてオフセット
  - X=東西（経度方向）, Z=南北（緯度方向）, Y=上（フロア高さ）
"""

import json
import os
import glob
import math
from collections import defaultdict

import fiona
from shapely.geometry import shape, mapping
from pyproj import Transformer

# --- 設定 ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
RAW_DIR = os.path.join(PROJECT_DIR, "data", "raw", "shapefile",
                       "新宿駅周辺屋内地図オープンデータ（Shapefile）")
OUT_DIR = os.path.join(PROJECT_DIR, "public", "data", "floors")

# 新宿駅中心付近の座標（原点とする）
CENTER_LON = 139.7005
CENTER_LAT = 35.6896

# フロアの高さマッピング（ordinal値→メートル）
FLOOR_HEIGHT_MAP = {
    -3.0: -15.0,
    -2.0: -10.0,
    -1.0: -5.0,
    0.0: 0.0,
    1.0: 5.0,
    2.0: 10.0,
    3.0: 15.0,
    4.0: 20.0,
}

# フロアディレクトリ名 → ordinal値
FLOOR_DIR_TO_ORDINAL = {
    "B3": -3.0,
    "B2": -2.0,
    "B1": -1.0,
    "0": 0.0,
    "1": 1.0,
    "2": 2.0,
    "2out": 2.0,  # 屋外2階
    "3": 3.0,
    "3out": 3.0,
    "4": 4.0,
    "4out": 4.0,
}

# Spaceカテゴリの色分けグループ
SPACE_CATEGORY_GROUP = {
    "B001": "shop",        # 商業施設
    "B002": "office",      # 事務所
    "B003": "public",      # 公的施設
    "B004": "public",      # 待合室
    "B005": "ticket",      # きっぷ売り場
    "B006": "info",        # 受付・案内
    "B007": "toilet",      # トイレ（男性）
    "B008": "toilet",      # トイレ（女性）
    "B009": "toilet",      # トイレ（共用）
    "B010": "toilet",      # トイレ（不明）
    "B011": "toilet",      # 多機能トイレ
    "B012": "toilet",
    "B013": "toilet",
    "B014": "toilet",
    "B016": "public",      # 授乳室
    "B018": "office",      # 駅事務室
    "B019": "room",        # その他部屋
    "B020": "void",        # 吹抜
    "B021": "stairs",      # 階段
    "B022": "elevator",    # エレベーター
    "B023": "escalator",   # エスカレーター
    "B025": "stairs",      # スロープ
    "B026": "nonpublic",   # 非公開
    "B028": "platform",    # プラットホーム
    "B029": "walkway",     # 通路/コンコース
    "B030": "walkway",     # ペデストリアンデッキ
}

# エリア名マッピング（ディレクトリ名→日本語短縮名）
AREA_NAMES = {
    "1.JR新宿駅改札": "JR改札",
    "2.JR新宿駅新南改札": "JR新南改札",
    "3.JR新宿駅": "JR新宿駅",
    "4.ルミネ": "ルミネ",
    "5.東京メトロ新宿駅": "メトロ",
    "6.小田急新宿駅_小田急エース": "小田急",
    "7.京王新宿駅_京王モールアネックス": "京王",
    "8.京王モール": "京王モール",
    "9.都営新宿駅": "都営新宿",
    "10.都営新宿西口駅": "都営西口",
    "11.サブナード": "サブナード",
    "12.西武新宿駅": "西武",
    "13.西口周辺": "西口周辺",
    "14.バスタ新宿": "バスタ",
    "15.NEWoMan": "NEWoMan",
    "16.other": "その他",
}

# EPSG:6668 → メートル変換用トランスフォーマー
transformer = Transformer.from_crs("EPSG:6668", "EPSG:6677", always_xy=True)


def lonlat_to_local(lon: float, lat: float) -> tuple[float, float]:
    """経緯度をローカルメートル座標に変換（中心点からのオフセット）"""
    x, y = transformer.transform(lon, lat)
    cx, cy = transformer.transform(CENTER_LON, CENTER_LAT)
    # Three.js座標: X=東西, Z=南北（反転なし、北が+Z方向にしない）
    # EPSG:6677: X=北方向, Y=東方向 → Three.js: x=Y-cy（東西）, z=-(X-cx)（南北反転）
    return round(y - cy, 3), round(-(x - cx), 3)


def convert_polygon_coords(geometry: dict) -> dict:
    """ジオメトリの座標をローカル座標に変換"""
    geom_type = geometry["type"]
    if geom_type == "Polygon":
        new_coords = []
        for ring in geometry["coordinates"]:
            new_ring = [lonlat_to_local(c[0], c[1]) for c in ring]
            new_coords.append(new_ring)
        return {"type": "Polygon", "coordinates": new_coords}
    elif geom_type == "MultiPolygon":
        new_polys = []
        for polygon in geometry["coordinates"]:
            new_rings = []
            for ring in polygon:
                new_ring = [lonlat_to_local(c[0], c[1]) for c in ring]
                new_rings.append(new_ring)
            new_polys.append(new_rings)
        return {"type": "MultiPolygon", "coordinates": new_polys}
    elif geom_type == "Point":
        x, z = lonlat_to_local(geometry["coordinates"][0], geometry["coordinates"][1])
        return {"type": "Point", "coordinates": [x, z]}
    elif geom_type == "LineString":
        new_coords = [lonlat_to_local(c[0], c[1]) for c in geometry["coordinates"]]
        return {"type": "LineString", "coordinates": new_coords}
    else:
        return geometry


def simplify_polygon(geometry: dict, tolerance: float = 0.1) -> dict | None:
    """ポリゴンを簡略化（頂点数削減）"""
    geom = shape(geometry)
    simplified = geom.simplify(tolerance, preserve_topology=True)
    if simplified.is_empty:
        return None
    result = mapping(simplified)
    # 座標を小数点3桁に丸め
    return round_coords(result)


def round_coords(geometry: dict) -> dict:
    """座標を小数点3桁に丸める"""
    def round_ring(ring):
        return [[round(c, 3) for c in coord] for coord in ring]

    geom_type = geometry["type"]
    if geom_type == "Polygon":
        return {"type": "Polygon", "coordinates": [round_ring(r) for r in geometry["coordinates"]]}
    elif geom_type == "MultiPolygon":
        return {"type": "MultiPolygon",
                "coordinates": [[round_ring(r) for r in poly] for poly in geometry["coordinates"]]}
    elif geom_type == "Point":
        return {"type": "Point", "coordinates": [round(c, 3) for c in geometry["coordinates"]]}
    elif geom_type == "LineString":
        return {"type": "LineString", "coordinates": round_ring(geometry["coordinates"])}
    return geometry


def get_floor_key(floor_dir: str, ordinal: float | None = None) -> str:
    """フロアキーを生成（例: B1, 0, 1, 2）"""
    if ordinal is not None:
        o = int(ordinal)
        if o < 0:
            return f"B{abs(o)}"
        return str(o)
    return floor_dir


def process_area(area_dir: str, area_path: str, floor_data: dict):
    """1エリアの全フロアを処理"""
    area_name = AREA_NAMES.get(area_dir, area_dir)

    for floor_dir in sorted(os.listdir(area_path)):
        floor_path = os.path.join(area_path, floor_dir)
        if not os.path.isdir(floor_path):
            continue

        ordinal = FLOOR_DIR_TO_ORDINAL.get(floor_dir)
        if ordinal is None:
            print(f"  [WARN] Unknown floor dir: {floor_dir}, skipping")
            continue

        floor_key = get_floor_key(floor_dir, ordinal)

        if floor_key not in floor_data:
            floor_data[floor_key] = {
                "ordinal": ordinal,
                "y": FLOOR_HEIGHT_MAP.get(ordinal, ordinal * 5),
                "spaces": [],
                "fixtures": [],
                "floors": [],
                "drawings": [],
                "facilities": [],
            }

        # Floor.shp
        floor_shp = glob.glob(os.path.join(floor_path, "*_Floor.shp"))
        for shp in floor_shp:
            with fiona.open(shp) as src:
                for feat in src:
                    geom = convert_polygon_coords(feat["geometry"])
                    simplified = simplify_polygon(geom, tolerance=0.3)
                    if simplified:
                        floor_data[floor_key]["floors"].append({
                            "geometry": simplified,
                            "area": area_name,
                        })

        # Space.shp
        space_shp = glob.glob(os.path.join(floor_path, "*_Space.shp"))
        for shp in space_shp:
            with fiona.open(shp) as src:
                for feat in src:
                    props = feat["properties"]
                    cat = props.get("category", "")
                    group = SPACE_CATEGORY_GROUP.get(cat, "other")

                    # 非公開や吹抜は除外
                    if group in ("void", "nonpublic"):
                        continue
                    if props.get("nonpublic") == "1":
                        continue

                    geom = convert_polygon_coords(feat["geometry"])
                    simplified = simplify_polygon(geom, tolerance=0.15)
                    if simplified:
                        entry = {
                            "geometry": simplified,
                            "category": cat,
                            "group": group,
                            "area": area_name,
                        }
                        name = props.get("name")
                        if name and name != "不明":
                            entry["name"] = name
                        floor_data[floor_key]["spaces"].append(entry)

        # Fixture.shp
        fixture_shp = glob.glob(os.path.join(floor_path, "*_Fixture.shp"))
        for shp in fixture_shp:
            with fiona.open(shp) as src:
                for feat in src:
                    props = feat["properties"]
                    cat = props.get("category", "")
                    geom = convert_polygon_coords(feat["geometry"])
                    simplified = simplify_polygon(geom, tolerance=0.1)
                    if simplified:
                        floor_data[floor_key]["fixtures"].append({
                            "geometry": simplified,
                            "category": cat,
                            "area": area_name,
                        })

        # Facility.shp (POI)
        facility_shp = glob.glob(os.path.join(floor_path, "*_Facility.shp"))
        for shp in facility_shp:
            with fiona.open(shp) as src:
                for feat in src:
                    props = feat["properties"]
                    geom = convert_polygon_coords(feat["geometry"])
                    entry = {
                        "geometry": round_coords(geom),
                        "category": props.get("category", ""),
                        "area": area_name,
                    }
                    name = props.get("name")
                    if name:
                        entry["name"] = name
                    floor_data[floor_key]["facilities"].append(entry)

        # Drawing.shp（描画用線分）
        drawing_shp = glob.glob(os.path.join(floor_path, "*_Drawing.shp"))
        for shp in drawing_shp:
            with fiona.open(shp) as src:
                for feat in src:
                    geom = convert_polygon_coords(feat["geometry"])
                    floor_data[floor_key]["drawings"].append({
                        "geometry": round_coords(geom),
                        "area": area_name,
                    })


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    if not os.path.isdir(RAW_DIR):
        print(f"ERROR: Raw data directory not found: {RAW_DIR}")
        print("Please download Shapefile from https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2")
        return

    floor_data: dict = {}

    # 全エリアを処理
    for area_dir in sorted(os.listdir(RAW_DIR)):
        area_path = os.path.join(RAW_DIR, area_dir)
        if not os.path.isdir(area_path):
            continue
        print(f"Processing: {area_dir}")
        process_area(area_dir, area_path, floor_data)

    # フロアごとにJSONを出力
    floor_index = []
    for floor_key in sorted(floor_data.keys(), key=lambda k: floor_data[k]["ordinal"]):
        data = floor_data[floor_key]
        out_path = os.path.join(OUT_DIR, f"{floor_key}.json")

        output = {
            "ordinal": data["ordinal"],
            "y": data["y"],
            "spaces": data["spaces"],
            "fixtures": data["fixtures"],
            "floors": data["floors"],
            "drawings": data["drawings"],
            "facilities": data["facilities"],
        }

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

        size_kb = os.path.getsize(out_path) / 1024
        n_spaces = len(data["spaces"])
        n_fixtures = len(data["fixtures"])
        n_floors = len(data["floors"])
        n_facilities = len(data["facilities"])
        print(f"  {floor_key}.json: {size_kb:.1f}KB "
              f"(floors={n_floors}, spaces={n_spaces}, fixtures={n_fixtures}, facilities={n_facilities})")

        floor_index.append({
            "key": floor_key,
            "ordinal": data["ordinal"],
            "y": data["y"],
            "label": f"B{abs(int(data['ordinal']))}F" if data["ordinal"] < 0 else f"{int(data['ordinal'])}F",
        })

    # フロアインデックスを出力
    index_path = os.path.join(OUT_DIR, "index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(floor_index, f, ensure_ascii=False, indent=2)

    print(f"\nDone! {len(floor_index)} floors output to {OUT_DIR}")


if __name__ == "__main__":
    main()
