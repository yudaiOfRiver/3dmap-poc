#!/usr/bin/env python3
"""
汎用 PLATEAU CityGML (LOD4 ubld) → Three.js用フロア別JSON変換スクリプト

使い方:
  python scripts/convert_plateau.py --station shinjuku
  python scripts/convert_plateau.py --station shibuya
"""

import argparse
import glob
import json
import math
import os
import sys
from collections import defaultdict
from lxml import etree

# XML名前空間
NS = {
    "core": "http://www.opengis.net/citygml/2.0",
    "bldg": "http://www.opengis.net/citygml/building/2.0",
    "gml": "http://www.opengis.net/gml",
    "uro": "https://www.geospatial.jp/iur/uro/3.1",
}

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

GEOID_HEIGHT = 36.7  # 東京のジオイド高

# 駅別設定
STATION_CONFIG = {
    "shinjuku": {
        "center_lat": 35.6896,
        "center_lon": 139.7005,
        "gml_dir": "data/raw/shinjuku_plateau/citygml/udx/ubld/",
        "output_dir": "public/data/shinjuku_plateau",
        # フロア分類は高さ分布を見て自動決定（--auto-floors）
        # 手動設定の場合: (楕円体高下限, 上限, キー, ordinal, y座標)
        "floor_defs": None,  # 自動検出
    },
    "shibuya": {
        "center_lat": 35.6598,
        "center_lon": 139.7010,
        "gml_dir": "data/raw/shibuya_plateau/citygml/udx/ubld/",
        "output_dir": "public/data/shibuya",
        "floor_defs": [
            (0.0, 5.0, "B3", -3.0, -15.0),
            (5.0, 10.0, "B2", -2.0, -10.0),
            (10.0, 14.0, "B1", -1.0, -5.0),
        ],
    },
}


def to_local(lat, lon, h, center_lat, center_lon):
    x = (lon - center_lon) * math.cos(math.radians(center_lat)) * 111319.49
    z = (lat - center_lat) * 110940.0
    y = h - GEOID_HEIGHT
    return (round(x, 2), round(y, 2), round(z, 2))


def parse_poslist(text):
    vals = text.strip().split()
    coords = []
    for i in range(0, len(vals) - 2, 3):
        coords.append((float(vals[i]), float(vals[i + 1]), float(vals[i + 2])))
    return coords


def fan_triangulate(n_verts):
    indices = []
    for i in range(1, n_verts - 1):
        indices.extend([0, i, i + 1])
    return indices


def compute_normal(verts_flat):
    if len(verts_flat) < 9:
        return [0.0, 1.0, 0.0]
    x0, y0, z0 = verts_flat[0], verts_flat[1], verts_flat[2]
    x1, y1, z1 = verts_flat[3], verts_flat[4], verts_flat[5]
    x2, y2, z2 = verts_flat[6], verts_flat[7], verts_flat[8]
    v1x, v1y, v1z = x1 - x0, y1 - y0, z1 - z0
    v2x, v2y, v2z = x2 - x0, y2 - y0, z2 - z0
    nx = v1y * v2z - v1z * v2y
    ny = v1z * v2x - v1x * v2z
    nz = v1x * v2y - v1y * v2x
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length < 1e-10:
        return [0.0, 1.0, 0.0]
    return [round(nx / length, 4), round(ny / length, 4), round(nz / length, 4)]


def extract_polygons_from_element(elem):
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


def process_surface(surface_type, coords_list, center_lat, center_lon):
    all_verts = []
    all_indices = []
    all_h = []

    for coords in coords_list:
        offset = len(all_verts) // 3
        for lat, lon, h in coords:
            x, y, z = to_local(lat, lon, h, center_lat, center_lon)
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
        "_avg_h": avg_h,
    }


def parse_gml(gml_path, center_lat, center_lon):
    print(f"パース中: {gml_path}")
    print(f"ファイルサイズ: {os.path.getsize(gml_path) / 1024 / 1024:.1f} MB")

    surfaces = []
    context = etree.iterparse(
        gml_path, events=("end",), tag="{%s}boundedBy" % NS["bldg"]
    )

    count = 0
    for event, elem in context:
        for child in elem:
            tag_local = etree.QName(child.tag).localname
            stype = SURFACE_TYPE_MAP.get(tag_local)
            if stype is None:
                continue

            polygons = extract_polygons_from_element(child)
            if not polygons:
                continue
            surface = process_surface(stype, polygons, center_lat, center_lon)
            if surface:
                surfaces.append(surface)
                count += 1

            # opening 内の Door/Window
            for opening in child.iter("{%s}opening" % NS["bldg"]):
                for sub in opening:
                    sub_tag = etree.QName(sub.tag).localname
                    sub_stype = SURFACE_TYPE_MAP.get(sub_tag)
                    if sub_stype is None:
                        continue
                    sub_polygons = extract_polygons_from_element(sub)
                    if not sub_polygons:
                        continue
                    sub_surface = process_surface(sub_stype, sub_polygons, center_lat, center_lon)
                    if sub_surface:
                        surfaces.append(sub_surface)
                        count += 1

        elem.clear()
        while elem.getprevious() is not None:
            del elem.getparent()[0]

    print(f"boundedBy サーフェス数: {count}")

    # IntBuildingInstallation
    print("IntBuildingInstallation を処理中...")
    context2 = etree.iterparse(
        gml_path, events=("end",), tag="{%s}IntBuildingInstallation" % NS["bldg"]
    )
    inst_count = 0
    for event, elem in context2:
        polygons = extract_polygons_from_element(elem)
        if not polygons:
            elem.clear()
            continue
        surface = process_surface("installation", polygons, center_lat, center_lon)
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


def auto_detect_floors(surfaces, station_name):
    """高さ分布からフロア定義を自動生成"""
    heights = [s["_avg_h"] for s in surfaces]
    min_h = min(heights)
    max_h = max(heights)
    real_min = min_h - GEOID_HEIGHT
    real_max = max_h - GEOID_HEIGHT

    print(f"\n楕円体高の範囲: {min_h:.2f} ~ {max_h:.2f}")
    print(f"実標高の範囲: {real_min:.2f} ~ {real_max:.2f}")

    # ヒストグラムで高さクラスタを検出
    import numpy as np
    h_arr = np.array(heights)
    # 5m間隔でビンを作成
    bin_size = 4.0
    bins = np.arange(min_h - 1, max_h + bin_size + 1, bin_size)
    hist, bin_edges = np.histogram(h_arr, bins=bins)

    print(f"\n高さヒストグラム ({bin_size}m間隔):")
    floor_defs = []
    ordinal_map = {}

    for i in range(len(hist)):
        if hist[i] > 0:
            h_lo = bin_edges[i]
            h_hi = bin_edges[i + 1]
            real_lo = h_lo - GEOID_HEIGHT
            real_hi = h_hi - GEOID_HEIGHT
            print(f"  {h_lo:.1f}-{h_hi:.1f} (実標高 {real_lo:.1f}~{real_hi:.1f}): {hist[i]} サーフェス")

    # 新宿駅の場合の手動フロア定義（PLATEAUデータの高さに基づく）
    # 国交省データの既存フロア: B3(-15), B2(-10), B1(-5), 0(0), 1(5), 2(10), 3(15), 4(20)
    # 実標高 = 楕円体高 - 36.7
    # B3: 実標高 ~-15m → 楕円体高 ~21.7m
    # B2: 実標高 ~-10m → 楕円体高 ~26.7m
    # B1: 実標高 ~-5m → 楕円体高 ~31.7m
    # 0F: 実標高 ~0m → 楕円体高 ~36.7m
    # 1F: 実標高 ~5m → 楕円体高 ~41.7m

    # 高さ分布に基づいて適切なフロアを割り当てる
    # 4m間隔で区切る
    current_h = min_h
    floor_labels_below = ["B5", "B4", "B3", "B2", "B1"]
    floor_labels_above = ["0", "1", "2", "3", "4", "5"]
    floor_ordinals_below = [-5, -4, -3, -2, -1]
    floor_ordinals_above = [0, 1, 2, 3, 4, 5]

    # 地上（楕円体高 ~36.7m）を基準にフロアを決定
    ground_h = GEOID_HEIGHT  # 36.7m

    defs = []
    # 地下フロア
    for i, (label, ordinal) in enumerate(zip(reversed(floor_labels_below), reversed(floor_ordinals_below))):
        h_center = ground_h + ordinal * 5  # 各フロアは5m間隔
        h_lo = h_center - 2.5
        h_hi = h_center + 2.5
        # このフロアに該当するサーフェスがあるか確認
        count = sum(1 for h in heights if h_lo <= h < h_hi)
        if count > 0:
            y_pos = ordinal * 5.0
            defs.append((h_lo, h_hi, label, float(ordinal), y_pos))

    # 地上フロア
    for label, ordinal in zip(floor_labels_above, floor_ordinals_above):
        h_center = ground_h + ordinal * 5
        h_lo = h_center - 2.5
        h_hi = h_center + 2.5
        count = sum(1 for h in heights if h_lo <= h < h_hi)
        if count > 0:
            y_pos = ordinal * 5.0
            defs.append((h_lo, h_hi, label, float(ordinal), y_pos))

    # ordinalでソート
    defs.sort(key=lambda x: x[3])

    print(f"\n自動検出フロア:")
    for h_lo, h_hi, key, ordinal, y in defs:
        count = sum(1 for h in heights if h_lo <= h < h_hi)
        print(f"  {key}: 楕円体高 {h_lo:.1f}~{h_hi:.1f}, y={y}, {count} サーフェス")

    return defs


def classify_floor(avg_h, floor_defs):
    for h_min, h_max, key, _, _ in floor_defs:
        if h_min <= avg_h < h_max:
            return key
    # 範囲外 → 最も近いフロアに
    if avg_h < floor_defs[0][0]:
        return floor_defs[0][2]
    if avg_h >= floor_defs[-1][1]:
        return floor_defs[-1][2]
    return None


def write_floor_json(floor_key, surfaces, output_dir, floor_defs):
    floor_def = None
    for h_min, h_max, key, ordinal, y in floor_defs:
        if key == floor_key:
            floor_def = (ordinal, y)
            break
    if floor_def is None:
        return

    ordinal, y_pos = floor_def
    clean_surfaces = []
    stats = defaultdict(int)
    for s in surfaces:
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
    print(f"  {floor_key}.json: {len(clean_surfaces)} サーフェス, {size_kb:.0f} KB, stats={dict(stats)}")


def write_index_json(floor_keys, output_dir, floor_defs):
    entries = []
    for h_min, h_max, key, ordinal, y in floor_defs:
        if key in floor_keys:
            entries.append({"key": key, "ordinal": ordinal, "y": y, "label": f"{key}F"})

    path = os.path.join(output_dir, "index.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
    print(f"  index.json: {len(entries)} フロア")


def main():
    parser = argparse.ArgumentParser(description="PLATEAU CityGML → Three.js JSON")
    parser.add_argument("--station", required=True, choices=list(STATION_CONFIG.keys()))
    args = parser.parse_args()

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    config = STATION_CONFIG[args.station]

    gml_dir = os.path.join(base_dir, config["gml_dir"])
    output_dir = os.path.join(base_dir, config["output_dir"])

    # GMLファイルを検索
    gml_files = sorted(glob.glob(os.path.join(gml_dir, "*_ubld_*.gml")))
    if not gml_files:
        print(f"エラー: GMLファイルが見つかりません: {gml_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"GMLファイル: {len(gml_files)} 件")
    for f in gml_files:
        print(f"  {os.path.basename(f)}")

    os.makedirs(output_dir, exist_ok=True)

    # 全GMLファイルをパース
    all_surfaces = []
    for gml_path in gml_files:
        surfaces = parse_gml(gml_path, config["center_lat"], config["center_lon"])
        all_surfaces.extend(surfaces)

    if not all_surfaces:
        print("エラー: サーフェスが見つかりませんでした", file=sys.stderr)
        sys.exit(1)

    print(f"\n総サーフェス数: {len(all_surfaces)}")

    # フロア定義
    floor_defs = config["floor_defs"]
    if floor_defs is None:
        floor_defs = auto_detect_floors(all_surfaces, args.station)

    if not floor_defs:
        print("エラー: フロアが検出されませんでした", file=sys.stderr)
        sys.exit(1)

    # フロア別にグループ化
    floors = defaultdict(list)
    unclassified = 0
    for s in all_surfaces:
        key = classify_floor(s["_avg_h"], floor_defs)
        if key:
            floors[key].append(s)
        else:
            unclassified += 1

    if unclassified > 0:
        print(f"警告: {unclassified} サーフェスがフロア分類外")

    print(f"\nフロア別サーフェス数:")
    for key in sorted(floors.keys()):
        print(f"  {key}: {len(floors[key])}")

    # JSON出力
    print(f"\n出力先: {output_dir}")
    for key in sorted(floors.keys()):
        write_floor_json(key, floors[key], output_dir, floor_defs)

    write_index_json(list(floors.keys()), output_dir, floor_defs)
    print("\n完了!")


if __name__ == "__main__":
    main()
