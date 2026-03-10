#!/usr/bin/env python3
"""
渋谷駅 PLATEAU CityGML (LOD4) → Three.js用フロア別JSON変換スクリプト

入力: data/raw/shibuya_plateau/citygml/udx/ubld/53393596_ubld_6697_op.gml
出力: public/data/shibuya/{index.json, B1.json, B2.json, B3.json}
"""

import json
import math
import os
import sys
from collections import defaultdict
from lxml import etree

# === 定数 ===
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_GML = os.path.join(
    BASE_DIR,
    "data/raw/shibuya_plateau/citygml/udx/ubld/53393596_ubld_6697_op.gml",
)
OUTPUT_DIR = os.path.join(BASE_DIR, "public/data/shibuya")

CENTER_LAT = 35.6598
CENTER_LON = 139.7010
GEOID_HEIGHT = 36.7  # 東京のジオイド高 (m)

# XML名前空間
NS = {
    "core": "http://www.opengis.net/citygml/2.0",
    "bldg": "http://www.opengis.net/citygml/building/2.0",
    "gml": "http://www.opengis.net/gml",
    "uro": "https://www.geospatial.jp/iur/uro/3.1",
}

# サーフェスタイプのマッピング (CityGMLローカル名 → 出力タイプ)
SURFACE_TYPE_MAP = {
    "WallSurface": "wall",
    "InteriorWallSurface": "wall",
    "FloorSurface": "floor",
    "GroundSurface": "floor",
    "CeilingSurface": "ceiling",
    "RoofSurface": "ceiling",
    "ClosureSurface": "closure",
    "Door": "door",
    "Window": "window",
}

# フロア分類: (楕円体高の下限, 上限, フロアキー, ordinal, y座標)
FLOOR_DEFS = [
    (0.0, 5.0, "B3", -3.0, -15.0),
    (5.0, 10.0, "B2", -2.0, -10.0),
    (10.0, 14.0, "B1", -1.0, -5.0),
]


def to_local(lat: float, lon: float, h: float) -> tuple:
    """EPSG:6697 (lat, lon, 楕円体高) → ローカルメートル座標 (x, y, z)"""
    x = (lon - CENTER_LON) * math.cos(math.radians(CENTER_LAT)) * 111319.49
    z = (lat - CENTER_LAT) * 110940.0
    y = h - GEOID_HEIGHT  # 楕円体高→実標高
    return (round(x, 2), round(y, 2), round(z, 2))


def parse_poslist(text: str) -> list:
    """gml:posList テキスト → [(lat, lon, h), ...] のリスト"""
    vals = text.strip().split()
    coords = []
    for i in range(0, len(vals) - 2, 3):
        lat = float(vals[i])
        lon = float(vals[i + 1])
        h = float(vals[i + 2])
        coords.append((lat, lon, h))
    return coords


def fan_triangulate(n_verts: int) -> list:
    """凸ポリゴン用 fan triangulation"""
    indices = []
    for i in range(1, n_verts - 1):
        indices.extend([0, i, i + 1])
    return indices


def compute_normal(verts_flat: list) -> list:
    """3頂点以上のポリゴンから法線ベクトルを計算"""
    if len(verts_flat) < 9:
        return [0.0, 1.0, 0.0]
    x0, y0, z0 = verts_flat[0], verts_flat[1], verts_flat[2]
    x1, y1, z1 = verts_flat[3], verts_flat[4], verts_flat[5]
    x2, y2, z2 = verts_flat[6], verts_flat[7], verts_flat[8]
    # v1 = p1 - p0, v2 = p2 - p0
    v1x, v1y, v1z = x1 - x0, y1 - y0, z1 - z0
    v2x, v2y, v2z = x2 - x0, y2 - y0, z2 - z0
    # cross product
    nx = v1y * v2z - v1z * v2y
    ny = v1z * v2x - v1x * v2z
    nz = v1x * v2y - v1y * v2x
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length < 1e-10:
        return [0.0, 1.0, 0.0]
    return [round(nx / length, 4), round(ny / length, 4), round(nz / length, 4)]


def classify_floor(avg_h: float) -> str | None:
    """楕円体高の平均値からフロアキーを返す"""
    for h_min, h_max, key, _, _ in FLOOR_DEFS:
        if h_min <= avg_h < h_max:
            return key
    # 範囲外の場合、最も近いフロアに割り当て
    if avg_h < FLOOR_DEFS[0][0]:
        return FLOOR_DEFS[0][2]
    if avg_h >= FLOOR_DEFS[-1][1]:
        return FLOOR_DEFS[-1][2]
    return None


def get_surface_type(elem) -> str | None:
    """bldg:boundedBy の子要素からサーフェスタイプを判定"""
    for child in elem:
        tag = etree.QName(child.tag).localname
        if tag in SURFACE_TYPE_MAP:
            return SURFACE_TYPE_MAP[tag]
        # IntBuildingInstallation は boundedBy ではなく roomInstallation 内
    return None


def get_surface_type_from_tag(tag_localname: str) -> str | None:
    """タグのローカル名からサーフェスタイプを判定"""
    return SURFACE_TYPE_MAP.get(tag_localname)


def extract_polygons_from_element(elem) -> list:
    """要素内のすべての gml:Polygon から座標を抽出"""
    polygons = []
    for polygon in elem.iter("{%s}Polygon" % NS["gml"]):
        exterior = polygon.find(
            "gml:exterior/gml:LinearRing/gml:posList", NS
        )
        if exterior is None or exterior.text is None:
            continue
        coords = parse_poslist(exterior.text)
        if len(coords) < 3:
            continue
        # 閉じたポリゴン: 最初と最後が同じなら最後を除去
        if len(coords) > 3 and coords[0] == coords[-1]:
            coords = coords[:-1]
        if len(coords) < 3:
            continue
        polygons.append(coords)
    return polygons


def process_surface(surface_type: str, coords_list: list) -> dict:
    """1つのサーフェス(複数ポリゴン)をThree.js用データに変換"""
    all_verts = []
    all_indices = []
    all_h = []  # 楕円体高を保持（フロア分類用）

    for coords in coords_list:
        offset = len(all_verts) // 3
        for lat, lon, h in coords:
            x, y, z = to_local(lat, lon, h)
            all_verts.extend([x, y, z])
            all_h.append(h)
        n = len(coords)
        tri = fan_triangulate(n)
        all_indices.extend([idx + offset for idx in tri])

    if not all_verts:
        return None

    avg_h = sum(all_h) / len(all_h)
    normal = compute_normal(all_verts)

    return {
        "type": surface_type,
        "vertices": all_verts,
        "indices": all_indices,
        "normal": normal,
        "_avg_h": avg_h,  # フロア分類用（出力時に除去）
    }


def parse_gml(gml_path: str) -> list:
    """CityGMLファイルをパースし、全サーフェスを抽出"""
    print(f"パース中: {gml_path}")
    print(f"ファイルサイズ: {os.path.getsize(gml_path) / 1024 / 1024:.1f} MB")

    surfaces = []

    # イベント駆動パースで大きいファイルを効率的に処理
    context = etree.iterparse(
        gml_path,
        events=("end",),
        tag="{%s}boundedBy" % NS["bldg"],
    )

    count = 0
    for event, elem in context:
        # boundedBy の直下の子要素がサーフェスタイプ
        for child in elem:
            tag_local = etree.QName(child.tag).localname
            stype = get_surface_type_from_tag(tag_local)
            if stype is None:
                continue

            # lod4MultiSurface 内のポリゴンを抽出
            polygons = extract_polygons_from_element(child)
            if not polygons:
                continue

            surface = process_surface(stype, polygons)
            if surface:
                surfaces.append(surface)
                count += 1

            # opening 内の Door/Window も処理
            for opening in child.iter("{%s}opening" % NS["bldg"]):
                for sub in opening:
                    sub_tag = etree.QName(sub.tag).localname
                    sub_stype = get_surface_type_from_tag(sub_tag)
                    if sub_stype is None:
                        continue
                    sub_polygons = extract_polygons_from_element(sub)
                    if not sub_polygons:
                        continue
                    sub_surface = process_surface(sub_stype, sub_polygons)
                    if sub_surface:
                        surfaces.append(sub_surface)
                        count += 1

        # メモリ解放
        elem.clear()
        while elem.getprevious() is not None:
            del elem.getparent()[0]

    print(f"サーフェス数: {count}")

    # IntBuildingInstallation も処理（roomInstallation 内）
    print("IntBuildingInstallation を処理中...")
    context2 = etree.iterparse(
        gml_path,
        events=("end",),
        tag="{%s}IntBuildingInstallation" % NS["bldg"],
    )
    inst_count = 0
    for event, elem in context2:
        polygons = extract_polygons_from_element(elem)
        if not polygons:
            elem.clear()
            continue
        surface = process_surface("installation", polygons)
        if surface:
            surfaces.append(surface)
            inst_count += 1
        elem.clear()
        while elem.getprevious() is not None:
            parent = elem.getparent()
            if parent is not None and len(parent) > 0:
                del parent[0]
            else:
                break

    print(f"IntBuildingInstallation 数: {inst_count}")

    return surfaces


def group_by_floor(surfaces: list) -> dict:
    """サーフェスをフロア別にグループ化"""
    floors = defaultdict(list)
    unclassified = 0

    for s in surfaces:
        avg_h = s["_avg_h"]
        floor_key = classify_floor(avg_h)
        if floor_key:
            floors[floor_key].append(s)
        else:
            unclassified += 1

    if unclassified > 0:
        print(f"警告: {unclassified} サーフェスがフロア分類外")

    return floors


def write_floor_json(floor_key: str, surfaces: list, output_dir: str):
    """1フロア分のJSONを出力"""
    # フロア定義を取得
    floor_def = None
    for h_min, h_max, key, ordinal, y in FLOOR_DEFS:
        if key == floor_key:
            floor_def = (ordinal, y)
            break

    if floor_def is None:
        return

    ordinal, y_pos = floor_def

    # _avg_h を除去
    clean_surfaces = []
    stats = defaultdict(int)
    for s in surfaces:
        # 重心計算
        verts = s["vertices"]
        n_verts = len(verts) // 3
        cx = sum(verts[i * 3] for i in range(n_verts)) / n_verts if n_verts > 0 else 0
        cy = sum(verts[i * 3 + 1] for i in range(n_verts)) / n_verts if n_verts > 0 else 0
        cz = sum(verts[i * 3 + 2] for i in range(n_verts)) / n_verts if n_verts > 0 else 0
        clean = {
            "type": s["type"],
            "vertices": s["vertices"],
            "indices": s["indices"],
            "normal": s["normal"],
            "centroid": [round(cx, 2), round(cy, 2), round(cz, 2)],
        }
        clean_surfaces.append(clean)
        stats[s["type"]] += 1

    data = {
        "ordinal": ordinal,
        "y": y_pos,
        "surfaces": clean_surfaces,
        "stats": dict(stats),
    }

    path = os.path.join(output_dir, f"{floor_key}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    size_kb = os.path.getsize(path) / 1024
    print(
        f"  {floor_key}.json: {len(clean_surfaces)} サーフェス, "
        f"{size_kb:.0f} KB, stats={dict(stats)}"
    )


def write_index_json(floor_keys: list, output_dir: str):
    """index.json を出力"""
    entries = []
    for h_min, h_max, key, ordinal, y in FLOOR_DEFS:
        if key in floor_keys:
            entries.append({
                "key": key,
                "ordinal": ordinal,
                "y": y,
                "label": f"{key}F",
            })

    path = os.path.join(output_dir, "index.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
    print(f"  index.json: {len(entries)} フロア")


def main():
    if not os.path.exists(INPUT_GML):
        print(f"エラー: 入力ファイルが見つかりません: {INPUT_GML}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 1. CityGMLをパース
    surfaces = parse_gml(INPUT_GML)
    if not surfaces:
        print("エラー: サーフェスが見つかりませんでした", file=sys.stderr)
        sys.exit(1)

    # 高さ分布を確認
    heights = [s["_avg_h"] for s in surfaces]
    print(f"\n楕円体高の範囲: {min(heights):.2f} ~ {max(heights):.2f}")
    print(f"実標高の範囲: {min(heights) - GEOID_HEIGHT:.2f} ~ {max(heights) - GEOID_HEIGHT:.2f}")

    # 2. フロア別にグループ化
    floors = group_by_floor(surfaces)
    print(f"\nフロア別サーフェス数:")
    for key in sorted(floors.keys()):
        print(f"  {key}: {len(floors[key])}")

    # 3. JSON出力
    print(f"\n出力先: {OUTPUT_DIR}")
    for key in sorted(floors.keys()):
        write_floor_json(key, floors[key], OUTPUT_DIR)

    write_index_json(list(floors.keys()), OUTPUT_DIR)
    print("\n完了!")


if __name__ == "__main__":
    main()
