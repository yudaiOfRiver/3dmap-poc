import * as THREE from "three";

/* ── PLATEAU建物データ型 ── */
interface PlateauSurface {
  type: string;       // "wall" | "roof" | "ground"
  vertices: number[]; // flat [x,y,z, ...]
  indices: number[];  // triangle indices
}

interface PlateauBuilding {
  name: string | null;
  h: number | null;
  centroid: [number, number, number];
  surfaces: PlateauSurface[];
}

interface PlateauData {
  buildingCount: number;
  buildings: PlateauBuilding[];
}

/* ── 道路データ型 ── */
interface RoadDef {
  name: string;
  type: "ns" | "ew" | "line" | "intersection";
  x?: number;
  z?: number;
  x1?: number;
  z1?: number;
  x2?: number;
  z2?: number;
  length?: number;
  width: number;
  size?: number;
}

interface RoadsData {
  roads: RoadDef[];
}

/* ── サーフェスタイプ別カラー ── */
const SURFACE_COLORS: Record<string, number> = {
  wall:    0x8899aa,
  roof:    0x667788,
  ground:  0x556666,
  floor:   0x556666,
  ceiling: 0x667788,
};

const GROUND_Y = -16;
const BUILDING_OPACITY = 0.4;
const ROAD_COLOR = 0x555555;
const ROAD_OPACITY = 0.35;
const LABEL_Y_OFFSET = 8;

/**
 * PLATEAUデータで渋谷駅周辺建物 + 手動道路を描画
 */
export async function renderBuildings(
  scene: THREE.Scene,
  requestRender: () => void,
): Promise<void> {
  const group = new THREE.Group();
  group.name = "buildings-roads";

  // 並行ロード
  const [plateauRes, roadsRes] = await Promise.all([
    fetch("./data/shibuya_buildings_plateau.json").catch(() => null),
    fetch("./data/shibuya_buildings.json").catch(() => null),
  ]);

  // PLATEAU建物
  if (plateauRes?.ok) {
    const data: PlateauData = await plateauRes.json();
    renderPlateauBuildings(data, group);
  }

  // 道路（手動データ）
  if (roadsRes?.ok) {
    const roadsData: RoadsData = await roadsRes.json();
    if (roadsData.roads) {
      for (const r of roadsData.roads) {
        const mesh = createRoadMesh(r);
        if (mesh) group.add(mesh);

        const pos = getRoadLabelPos(r);
        if (pos) {
          const label = createLabel(r.name, "#cccccc", 0.6);
          label.position.copy(pos);
          group.add(label);
        }
      }
    }
  }

  scene.add(group);
  requestRender();
}

/**
 * PLATEAU建物をバッチ化してジオメトリをマージ描画
 */
function renderPlateauBuildings(data: PlateauData, group: THREE.Group): void {
  // サーフェスタイプ別にバッファをまとめる（ドローコール削減）
  const batches: Record<string, { positions: number[]; indices: number[]; offset: number }> = {};

  for (const stype of Object.keys(SURFACE_COLORS)) {
    batches[stype] = { positions: [], indices: [], offset: 0 };
  }

  for (const bldg of data.buildings) {
    for (const surf of bldg.surfaces) {
      const batch = batches[surf.type] ?? batches["wall"];
      const verts = surf.vertices;
      const baseOffset = batch.offset;

      // 頂点追加
      for (let i = 0; i < verts.length; i++) {
        batch.positions.push(verts[i]);
      }

      // インデックス追加（オフセット付き）
      for (const idx of surf.indices) {
        batch.indices.push(idx + baseOffset);
      }

      batch.offset += verts.length / 3;
    }
  }

  // バッチごとにメッシュ生成
  for (const [stype, batch] of Object.entries(batches)) {
    if (batch.positions.length === 0) continue;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
    geo.setIndex(batch.indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      color: SURFACE_COLORS[stype] ?? 0x8899aa,
      transparent: true,
      opacity: BUILDING_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `plateau-${stype}`;
    group.add(mesh);
  }

  // 名前付き建物にラベル
  for (const bldg of data.buildings) {
    if (!bldg.name || !bldg.h || bldg.h < 30) continue;
    const [cx, , cz] = bldg.centroid;
    const topY = bldg.h - 36.7 + LABEL_Y_OFFSET; // GEOID補正済みのため概算
    const label = createLabel(bldg.name, "#ffffff");
    // bbox上端をy座標に使う
    let maxY = -Infinity;
    for (const s of bldg.surfaces) {
      for (let i = 1; i < s.vertices.length; i += 3) {
        if (s.vertices[i] > maxY) maxY = s.vertices[i];
      }
    }
    label.position.set(cx, maxY + LABEL_Y_OFFSET, cz);
    group.add(label);
  }
}

/* ── 道路メッシュ生成（旧コードを維持） ── */

function createRoadMesh(r: RoadDef): THREE.Mesh | null {
  const mat = new THREE.MeshBasicMaterial({
    color: ROAD_COLOR,
    transparent: true,
    opacity: ROAD_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  if (r.type === "ns") {
    const geo = new THREE.PlaneGeometry(r.width, r.length!);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(r.x!, GROUND_Y + 0.1, r.z!);
    return mesh;
  }

  if (r.type === "ew") {
    const geo = new THREE.PlaneGeometry(r.length!, r.width);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(r.x!, GROUND_Y + 0.1, r.z!);
    return mesh;
  }

  if (r.type === "line") {
    const dx = r.x2! - r.x1!;
    const dz = r.z2! - r.z1!;
    const len = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);
    const geo = new THREE.PlaneGeometry(len, r.width);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -angle;
    mesh.position.set((r.x1! + r.x2!) / 2, GROUND_Y + 0.1, (r.z1! + r.z2!) / 2);
    return mesh;
  }

  if (r.type === "intersection") {
    const geo = new THREE.CircleGeometry(r.size! / 2, 32);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(r.x!, GROUND_Y + 0.15, r.z!);
    return mesh;
  }

  return null;
}

function getRoadLabelPos(r: RoadDef): THREE.Vector3 | null {
  if (r.type === "ns" || r.type === "ew") {
    return new THREE.Vector3(r.x!, GROUND_Y + 3, r.z!);
  }
  if (r.type === "line") {
    return new THREE.Vector3((r.x1! + r.x2!) / 2, GROUND_Y + 3, (r.z1! + r.z2!) / 2);
  }
  if (r.type === "intersection") {
    return new THREE.Vector3(r.x!, GROUND_Y + 3, r.z!);
  }
  return null;
}

/* ── ラベル生成 ── */

function createLabel(text: string, color: string, scale = 1.0): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  const fontSize = 28;
  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const textW = metrics.width + 16;
  const textH = fontSize + 12;

  canvas.width = Math.ceil(textW);
  canvas.height = Math.ceil(textH);

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 6);
  ctx.fill();

  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;

  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
  });

  const sprite = new THREE.Sprite(spriteMat);
  const aspect = canvas.width / canvas.height;
  const spriteH = 6 * scale;
  sprite.scale.set(spriteH * aspect, spriteH, 1);
  return sprite;
}
