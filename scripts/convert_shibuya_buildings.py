#!/usr/bin/env python3
"""
渋谷駅周辺 PLATEAU CityGML (bldg LOD1/LOD2) → Three.js用JSON変換

入力: data/raw/shibuya_plateau/citygml/udx/bldg/53393596_bldg_*.gml (+ 隣接メッシュ)
出力: public/data/shibuya_buildings_plateau.json
"""

import json
import math
import os
import sys
import glob
from collections import defaultdict
from lxml import etree

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLDG_DIR = os.path.join(
    BASE_DIR, "data/raw/shibuya_plateau/citygml/udx/bldg"
)
OUTPUT_FILE = os.path.join(BASE_DIR, "public/data/shibuya_buildings_plateau.json")

# 渋谷駅中心（convert_shibuya.pyと同じ）
CENTER_LAT = 35.6598
CENTER_LON = 139.7010
GEOID_HEIGHT = 36.7

# 駅中心からの最大表示範囲 (m)
MAX_DISTANCE = 50

# 対象メッシュコード
TARGET_MESHES = [
    "53393595",  # 西 (109, マークシティ)
    "53393596",  # 中央 (駅)
    "53393597",  # 東
    "53393585",  # 南西
    "53393586",  # 南
    "53393587",  # 南東
    "53394505",  # 北西
    "53394506",  # 北
    "53394507",  # 北東
]

NS = {
    "core": "http://www.opengis.net/citygml/2.0",
    "bldg": "http://www.opengis.net/citygml/building/2.0",
    "gml": "http://www.opengis.net/gml",
    "uro": "https://www.geospatial.jp/iur/uro/3.1",
}

SURFACE_TYPE_MAP = {
    "WallSurface": "wall",
    "RoofSurface": "roof",
    "GroundSurface": "ground",
    "OuterFloorSurface": "floor",
    "OuterCeilingSurface": "ceiling",
    "ClosureSurface": "wall",
}


def to_local(lat: float, lon: float, h: float) -> tuple:
    x = (lon - CENTER_LON) * math.cos(math.radians(CENTER_LAT)) * 111319.49
    z = (lat - CENTER_LAT) * 110940.0
    y = h - GEOID_HEIGHT
    return (round(x, 1), round(y, 1), round(z, 1))


def parse_poslist(text: str) -> list:
    vals = text.strip().split()
    coords = []
    for i in range(0, len(vals) - 2, 3):
        coords.append((float(vals[i]), float(vals[i + 1]), float(vals[i + 2])))
    return coords


def fan_triangulate(n: int) -> list:
    indices = []
    for i in range(1, n - 1):
        indices.extend([0, i, i + 1])
    return indices


def compute_normal(verts: list) -> list:
    if len(verts) < 9:
        return [0.0, 1.0, 0.0]
    x0, y0, z0 = verts[0], verts[1], verts[2]
    x1, y1, z1 = verts[3], verts[4], verts[5]
    x2, y2, z2 = verts[6], verts[7], verts[8]
    v1x, v1y, v1z = x1 - x0, y1 - y0, z1 - z0
    v2x, v2y, v2z = x2 - x0, y2 - y0, z2 - z0
    nx = v1y * v2z - v1z * v2y
    ny = v1z * v2x - v1x * v2z
    nz = v1x * v2y - v1y * v2x
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length < 1e-10:
        return [0.0, 1.0, 0.0]
    return [round(nx / length, 4), round(ny / length, 4), round(nz / length, 4)]


def extract_polygons(elem) -> list:
    """gml:Polygon を全て抽出"""
    polygons = []
    for polygon in elem.iter("{%s}Polygon" % NS["gml"]):
        exterior = polygon.find("gml:exterior/gml:LinearRing/gml:posList", NS)
        if exterior is None or exterior.text is None:
            continue
        coords = parse_poslist(exterior.text)
        if len(coords) < 3:
            continue
        if len(coords) > 3 and coords[0] == coords[-1]:
            coords = coords[:-1]
        if len(coords) < 3:
            continue
        polygons.append(coords)
    return polygons


def is_near_station(lat: float, lon: float) -> bool:
    """駅中心から一定距離内か判定"""
    x = (lon - CENTER_LON) * math.cos(math.radians(CENTER_LAT)) * 111319.49
    z = (lat - CENTER_LAT) * 110940.0
    return math.sqrt(x * x + z * z) <= MAX_DISTANCE


def parse_building(building_elem) -> dict | None:
    """1つの bldg:Building をパース"""
    # まず建物全体の位置を推定（最初のポリゴンから）
    first_polygon = None
    for polygon in building_elem.iter("{%s}Polygon" % NS["gml"]):
        exterior = polygon.find("gml:exterior/gml:LinearRing/gml:posList", NS)
        if exterior is not None and exterior.text:
            first_polygon = parse_poslist(exterior.text)
            break

    if not first_polygon:
        return None

    # 中心の緯度経度
    avg_lat = sum(c[0] for c in first_polygon) / len(first_polygon)
    avg_lon = sum(c[1] for c in first_polygon) / len(first_polygon)

    if not is_near_station(avg_lat, avg_lon):
        return None

    # 建物高さ (measuredHeight)
    height_elem = building_elem.find("bldg:measuredHeight", NS)
    measured_height = float(height_elem.text) if height_elem is not None and height_elem.text else None

    # LOD2サーフェスを探す
    surfaces = []

    # LOD2: boundedBy 内の WallSurface, RoofSurface, GroundSurface
    for bounded in building_elem.iter("{%s}boundedBy" % NS["bldg"]):
        for child in bounded:
            tag_local = etree.QName(child.tag).localname
            stype = SURFACE_TYPE_MAP.get(tag_local)
            if stype is None:
                continue
            polygons = extract_polygons(child)
            if not polygons:
                continue
            for coords in polygons:
                verts = []
                for lat, lon, h in coords:
                    x, y, z = to_local(lat, lon, h)
                    verts.extend([x, y, z])
                n = len(coords)
                indices = fan_triangulate(n)
                surfaces.append({
                    "type": stype,
                    "vertices": verts,
                    "indices": indices,
                })

    # LOD2が無ければ LOD1 (lod1Solid) を使う
    if not surfaces:
        lod1 = building_elem.find("bldg:lod1Solid", NS)
        if lod1 is None:
            lod1 = building_elem.find("bldg:lod1MultiSurface", NS)
        if lod1 is not None:
            polygons = extract_polygons(lod1)
            for coords in polygons:
                verts = []
                for lat, lon, h in coords:
                    x, y, z = to_local(lat, lon, h)
                    verts.extend([x, y, z])
                n = len(coords)
                indices = fan_triangulate(n)
                normal = compute_normal(verts)
                # 法線のY成分で壁/屋根/地面を推定
                if abs(normal[1]) > 0.7:
                    stype = "roof" if normal[1] > 0 else "ground"
                else:
                    stype = "wall"
                surfaces.append({
                    "type": stype,
                    "vertices": verts,
                    "indices": indices,
                })

    if not surfaces:
        return None

    # 建物の重心を計算
    all_x, all_y, all_z = [], [], []
    for s in surfaces:
        v = s["vertices"]
        for i in range(0, len(v), 3):
            all_x.append(v[i])
            all_y.append(v[i + 1])
            all_z.append(v[i + 2])

    centroid = [
        round(sum(all_x) / len(all_x), 2),
        round(sum(all_y) / len(all_y), 2),
        round(sum(all_z) / len(all_z), 2),
    ]

    # 建物名を取得
    name = None
    # uro:buildingDetails/uro:BuildingDetails/uro:buildingID 等
    for detail in building_elem.iter("{%s}BuildingDetails" % NS["uro"]):
        name_elem = detail.find("uro:buildingID", NS)
        if name_elem is not None and name_elem.text:
            name = name_elem.text
            break

    # gml:name
    if not name:
        name_elem = building_elem.find("gml:name", NS)
        if name_elem is not None and name_elem.text:
            name = name_elem.text

    # gml:id
    gml_id = building_elem.get("{%s}id" % NS["gml"], "")

    # 異常な高さ (<=0) をフィルタ
    if measured_height is not None and measured_height <= 0:
        return None

    return {
        "name": name,
        "h": measured_height,
        "centroid": centroid,
        "surfaces": surfaces,
        "bbox": {
            "xMin": round(min(all_x), 1),
            "xMax": round(max(all_x), 1),
            "yMin": round(min(all_y), 1),
            "yMax": round(max(all_y), 1),
            "zMin": round(min(all_z), 1),
            "zMax": round(max(all_z), 1),
        },
    }


def find_gml_files() -> list:
    """対象メッシュのGMLファイルを探す"""
    files = []
    for mesh in TARGET_MESHES:
        pattern = os.path.join(BLDG_DIR, f"{mesh}_bldg_*.gml")
        found = glob.glob(pattern)
        files.extend(found)
    return sorted(set(files))


def parse_gml_file(gml_path: str) -> list:
    """1つのGMLファイルから駅周辺の建物を抽出"""
    print(f"  パース中: {os.path.basename(gml_path)} ({os.path.getsize(gml_path) / 1024 / 1024:.1f} MB)")

    buildings = []
    context = etree.iterparse(
        gml_path,
        events=("end",),
        tag="{%s}Building" % NS["bldg"],
    )

    total = 0
    kept = 0
    for event, elem in context:
        total += 1
        bldg = parse_building(elem)
        if bldg:
            buildings.append(bldg)
            kept += 1

        elem.clear()
        while elem.getprevious() is not None:
            parent = elem.getparent()
            if parent is not None and len(parent) > 0:
                del parent[0]
            else:
                break

    print(f"    建物: {total} → {kept} (範囲内)")
    return buildings


def main():
    print("=== 渋谷駅周辺建物変換 ===")
    print(f"中心: lat={CENTER_LAT}, lon={CENTER_LON}")
    print(f"範囲: {MAX_DISTANCE}m")

    gml_files = find_gml_files()
    if not gml_files:
        print(f"エラー: GMLファイルが見つかりません: {BLDG_DIR}", file=sys.stderr)
        print("対象メッシュ:", TARGET_MESHES)
        sys.exit(1)

    print(f"\nGMLファイル: {len(gml_files)}件")

    all_buildings = []
    for gml_path in gml_files:
        buildings = parse_gml_file(gml_path)
        all_buildings.extend(buildings)

    print(f"\n合計建物数: {len(all_buildings)}")

    # 統計
    lod2_count = sum(1 for b in all_buildings if any(s["type"] == "roof" for s in b["surfaces"]))
    total_surfaces = sum(len(b["surfaces"]) for b in all_buildings)
    print(f"LOD2建物 (屋根あり): {lod2_count}")
    print(f"総サーフェス数: {total_surfaces}")

    # 高さ分布
    heights = [b["h"] for b in all_buildings if b["h"]]
    if heights:
        print(f"建物高さ: {min(heights):.1f}m ~ {max(heights):.1f}m (中央値: {sorted(heights)[len(heights)//2]:.1f}m)")

    # JSON出力
    output = {
        "center": {"lat": CENTER_LAT, "lon": CENTER_LON},
        "radius": MAX_DISTANCE,
        "buildingCount": len(all_buildings),
        "buildings": all_buildings,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    size_mb = os.path.getsize(OUTPUT_FILE) / 1024 / 1024
    print(f"\n出力: {OUTPUT_FILE} ({size_mb:.1f} MB)")
    print("完了!")


if __name__ == "__main__":
    main()
