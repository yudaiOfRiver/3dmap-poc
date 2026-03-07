"""
歩行ネットワークデータ（node.shp / link.shp）→ JSON変換

出力: public/data/network.json
"""

import json
import os

import fiona
from pyproj import Transformer

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
RAW_DIR = os.path.join(PROJECT_DIR, "data", "raw", "shapefile",
                       "新宿駅周辺屋内地図オープンデータ（Shapefile）", "nw")
OUT_PATH = os.path.join(PROJECT_DIR, "public", "data", "network.json")

CENTER_LON = 139.7005
CENTER_LAT = 35.6896

FLOOR_HEIGHT_MAP = {
    -3.0: -15.0, -2.5: -12.5, -2.0: -10.0, -1.5: -7.5,
    -1.0: -5.0, -0.5: -2.5, 0.0: 0.0,
    1.0: 5.0, 1.5: 7.5, 2.0: 10.0, 2.5: 12.5,
    3.0: 15.0, 4.0: 20.0, 4.5: 22.5,
}

# route_type: 1=通常歩行, 4=階段, 5=エスカレーター, 6=エレベーター
ROUTE_TYPE_WEIGHT = {
    "1": 1.0,    # 通常歩行
    "4": 2.5,    # 階段（重めのペナルティ）
    "5": 1.5,    # エスカレーター
    "6": 1.2,    # エレベーター（待ち時間考慮で少しペナルティ）
}

transformer = Transformer.from_crs("EPSG:6668", "EPSG:6677", always_xy=True)


def lonlat_to_local(lon: float, lat: float) -> tuple[float, float]:
    x, y = transformer.transform(lon, lat)
    cx, cy = transformer.transform(CENTER_LON, CENTER_LAT)
    return round(y - cy, 2), round(-(x - cx), 2)


def main():
    node_shp = os.path.join(RAW_DIR, "Shinjuku_node.shp")
    link_shp = os.path.join(RAW_DIR, "Shinjuku_link.shp")

    if not os.path.exists(node_shp):
        print(f"ERROR: {node_shp} not found")
        return

    # ノード読み込み
    nodes = {}
    with fiona.open(node_shp) as src:
        for feat in src:
            p = feat["properties"]
            nid = p["node_id"]
            lon, lat = feat["geometry"]["coordinates"][:2]
            x, z = lonlat_to_local(lon, lat)
            ordinal = p["ordinal"]
            y = FLOOR_HEIGHT_MAP.get(ordinal, ordinal * 5)

            # フロアキー
            o = ordinal
            if o < 0:
                floor_key = f"B{abs(int(o))}"
            else:
                floor_key = str(int(o))

            nodes[nid] = {
                "x": x,
                "y": round(y, 1),
                "z": z,
                "floor": floor_key,
                "ordinal": ordinal,
            }

    print(f"Nodes: {len(nodes)}")

    # リンク読み込み
    links = []
    with fiona.open(link_shp) as src:
        for feat in src:
            p = feat["properties"]
            start = p["start_id"]
            end = p["end_id"]

            if start not in nodes or end not in nodes:
                continue

            distance = p["distance"] or 0
            route_type = p.get("route_type", "1")
            weight_mult = ROUTE_TYPE_WEIGHT.get(route_type, 1.0)
            cost = round(distance * weight_mult, 2)

            links.append({
                "s": start,
                "e": end,
                "d": round(distance, 1),
                "c": cost,
                "t": int(route_type),
            })

    print(f"Links: {len(links)}")

    # ノードIDを短縮（ファイルサイズ削減）
    id_map = {}
    for i, nid in enumerate(nodes.keys()):
        id_map[nid] = str(i)

    short_nodes = []
    for nid, data in nodes.items():
        short_nodes.append([
            float(id_map[nid]),
            data["x"], data["y"], data["z"],
            data["floor"],
        ])

    short_links = []
    for link in links:
        if link["s"] in id_map and link["e"] in id_map:
            short_links.append([
                int(id_map[link["s"]]),
                int(id_map[link["e"]]),
                link["d"],
                link["c"],
                link["t"],
            ])

    output = {
        "nodes": short_nodes,  # [id, x, y, z, floor]
        "links": short_links,  # [startId, endId, distance, cost, routeType]
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"Output: {OUT_PATH} ({size_kb:.1f}KB)")


if __name__ == "__main__":
    main()
