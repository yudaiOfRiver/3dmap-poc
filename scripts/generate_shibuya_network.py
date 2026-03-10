"""
渋谷駅の歩行ネットワークグラフを生成するスクリプト

B1/B2/B3のフロアデータからfloor・doorサーフェスのcentroidを
ノードとして抽出し、KNN + 距離閾値でリンクを生成する。
フロア間はdoor付近の垂直接続も追加する。

出力: public/data/shibuya/network.json
"""

import json
import math
import os
from pathlib import Path

# ──────────────────────────────────────────────
# 設定
# ──────────────────────────────────────────────
MAX_LINK_DISTANCE = 30.0  # 同一フロア内リンクの最大距離 (m)
K_NEIGHBORS = 8           # 各ノードから接続する最大近傍数
VERTICAL_ALIGN_XZ = 5.0   # フロア間接続のXZ距離閾値 (m)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "public" / "data" / "shibuya"
OUTPUT_PATH = DATA_DIR / "network.json"

FLOORS = {
    "B1": {"file": "B1.json", "y": -5.0},
    "B2": {"file": "B2.json", "y": -10.0},
    "B3": {"file": "B3.json", "y": -15.0},
}


# ──────────────────────────────────────────────
# ノード抽出
# ──────────────────────────────────────────────
def extract_nodes():
    """各フロアのfloor/doorサーフェスのcentroidをノードとして収集"""
    nodes = []  # (id, x, y, z, floor, is_door)
    node_id = 0

    for floor_name, info in FLOORS.items():
        fpath = DATA_DIR / info["file"]
        with open(fpath, "r") as f:
            data = json.load(f)

        for surf in data["surfaces"]:
            stype = surf.get("type", "")
            if stype not in ("floor", "door"):
                continue

            centroid = surf.get("centroid")
            if centroid is None:
                continue

            x, y, z = centroid
            is_door = stype == "door"
            nodes.append({
                "id": node_id,
                "x": round(x, 2),
                "y": round(y, 2),
                "z": round(z, 2),
                "floor": floor_name,
                "is_door": is_door,
            })
            node_id += 1

    return nodes


# ──────────────────────────────────────────────
# 同一フロア内リンク生成 (KNN + 距離閾値)
# ──────────────────────────────────────────────
def dist_xz(a, b):
    """XZ平面上の距離（y は高さなのでリンク距離には水平距離を使う）"""
    dx = a["x"] - b["x"]
    dz = a["z"] - b["z"]
    return math.sqrt(dx * dx + dz * dz)


def dist_3d(a, b):
    dx = a["x"] - b["x"]
    dy = a["y"] - b["y"]
    dz = a["z"] - b["z"]
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def generate_intra_floor_links(nodes):
    """同一フロア内のKNN接続"""
    links = []
    link_set = set()

    # フロアごとにグルーピング
    by_floor = {}
    for n in nodes:
        by_floor.setdefault(n["floor"], []).append(n)

    for floor_name, fnodes in by_floor.items():
        for i, node_a in enumerate(fnodes):
            # 全ノードとの距離を計算してソート
            dists = []
            for j, node_b in enumerate(fnodes):
                if i == j:
                    continue
                d = dist_xz(node_a, node_b)
                if d <= MAX_LINK_DISTANCE:
                    dists.append((d, node_b))

            # K近傍のみリンク
            dists.sort(key=lambda x: x[0])
            for d, node_b in dists[:K_NEIGHBORS]:
                key = (min(node_a["id"], node_b["id"]),
                       max(node_a["id"], node_b["id"]))
                if key not in link_set:
                    link_set.add(key)
                    links.append({
                        "source": node_a["id"],
                        "target": node_b["id"],
                        "distance": round(d, 1),
                        "cost": round(d, 1),
                        "routeType": 1,  # walk
                    })

    return links


# ──────────────────────────────────────────────
# フロア間リンク生成（垂直接続）
# ──────────────────────────────────────────────
def generate_inter_floor_links(nodes):
    """XZ座標が近いdoor/floorノードをフロア間で接続"""
    links = []
    link_set = set()

    # フロアごとにdoorノードを取得（doorがなければfloorも使う）
    by_floor = {}
    for n in nodes:
        by_floor.setdefault(n["floor"], []).append(n)

    floor_pairs = [("B1", "B2"), ("B2", "B3")]

    for f_upper, f_lower in floor_pairs:
        upper_nodes = by_floor.get(f_upper, [])
        lower_nodes = by_floor.get(f_lower, [])

        # door同士を優先、なければ全ノードで探す
        upper_doors = [n for n in upper_nodes if n["is_door"]]
        lower_doors = [n for n in lower_nodes if n["is_door"]]

        # door同士で垂直接続
        for nu in upper_doors:
            for nl in lower_doors:
                dxz = dist_xz(nu, nl)
                if dxz <= VERTICAL_ALIGN_XZ:
                    key = (min(nu["id"], nl["id"]),
                           max(nu["id"], nl["id"]))
                    if key not in link_set:
                        link_set.add(key)
                        d3 = dist_3d(nu, nl)
                        links.append({
                            "source": nu["id"],
                            "target": nl["id"],
                            "distance": round(d3, 1),
                            "cost": round(d3, 1),
                            "routeType": 4,  # stairs (default vertical)
                        })

        # フロア間接続が少なすぎる場合、全ノードからも探す
        if len([l for l in links
                if (any(n["id"] == l["source"] and n["floor"] == f_upper for n in nodes) and
                    any(n["id"] == l["target"] and n["floor"] == f_lower for n in nodes)) or
                   (any(n["id"] == l["source"] and n["floor"] == f_lower for n in nodes) and
                    any(n["id"] == l["target"] and n["floor"] == f_upper for n in nodes))
                ]) < 2:
            # 全ノードからXZが近い組を追加
            for nu in upper_nodes:
                best_d = float("inf")
                best_nl = None
                for nl in lower_nodes:
                    dxz = dist_xz(nu, nl)
                    if dxz < best_d:
                        best_d = dxz
                        best_nl = nl
                if best_nl and best_d <= VERTICAL_ALIGN_XZ * 3:
                    key = (min(nu["id"], best_nl["id"]),
                           max(nu["id"], best_nl["id"]))
                    if key not in link_set:
                        link_set.add(key)
                        d3 = dist_3d(nu, best_nl)
                        links.append({
                            "source": nu["id"],
                            "target": best_nl["id"],
                            "distance": round(d3, 1),
                            "cost": round(d3, 1),
                            "routeType": 4,
                        })
                    break  # 1つ追加したら十分

    return links


# ──────────────────────────────────────────────
# メイン
# ──────────────────────────────────────────────
def main():
    print("ノード抽出中...")
    nodes = extract_nodes()
    print(f"  ノード数: {len(nodes)}")
    for floor in FLOORS:
        cnt = sum(1 for n in nodes if n["floor"] == floor)
        doors = sum(1 for n in nodes if n["floor"] == floor and n["is_door"])
        print(f"    {floor}: {cnt} nodes ({doors} doors)")

    print("同一フロア内リンク生成中...")
    intra_links = generate_intra_floor_links(nodes)
    print(f"  フロア内リンク数: {len(intra_links)}")

    print("フロア間リンク生成中...")
    inter_links = generate_inter_floor_links(nodes)
    print(f"  フロア間リンク数: {len(inter_links)}")

    all_links = intra_links + inter_links
    print(f"  合計リンク数: {len(all_links)}")

    # network.json形式に変換（配列形式）
    # nodes: [id, x, y, z, floor]
    # links: [startId, endId, distance, cost, routeType]
    out_nodes = []
    for n in nodes:
        out_nodes.append([n["id"], n["x"], n["y"], n["z"], n["floor"]])

    out_links = []
    for l in all_links:
        out_links.append([
            l["source"],
            l["target"],
            l["distance"],
            l["cost"],
            l["routeType"],
        ])

    output = {"nodes": out_nodes, "links": out_links}

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    file_size = OUTPUT_PATH.stat().st_size / 1024
    print(f"\n出力: {OUTPUT_PATH}")
    print(f"ファイルサイズ: {file_size:.1f} KB")
    print(f"ノード: {len(out_nodes)}, リンク: {len(out_links)}")


if __name__ == "__main__":
    main()
