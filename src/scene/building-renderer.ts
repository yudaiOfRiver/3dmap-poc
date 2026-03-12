import * as THREE from "three";

interface BuildingDef {
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
}

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

interface BuildingsData {
  buildings: BuildingDef[];
  roads: RoadDef[];
}

const GROUND_Y = -16;
const ROAD_COLOR = 0x555555;
const ROAD_OPACITY = 0.35;
const BUILDING_OPACITY = 0.25;
const LABEL_Y_OFFSET = 8;

/**
 * 渋谷駅周辺の建物と道路を描画
 */
export async function renderBuildings(
  scene: THREE.Scene,
  requestRender: () => void,
): Promise<void> {
  const res = await fetch("./data/shibuya_buildings.json");
  const data: BuildingsData = await res.json();

  const group = new THREE.Group();
  group.name = "buildings-roads";

  // 建物
  for (const b of data.buildings) {
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(b.color),
      transparent: true,
      opacity: BUILDING_OPACITY,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(b.x, GROUND_Y + b.h / 2, b.z);
    group.add(mesh);

    // ワイヤーフレームエッジ
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: b.color, opacity: 0.5, transparent: true }),
    );
    line.position.copy(mesh.position);
    group.add(line);

    // ラベル
    const label = createLabel(b.name, b.color);
    label.position.set(b.x, GROUND_Y + b.h + LABEL_Y_OFFSET, b.z);
    group.add(label);
  }

  // 道路
  for (const r of data.roads) {
    const roadMesh = createRoadMesh(r);
    if (roadMesh) {
      group.add(roadMesh);
    }

    // 道路ラベル
    const pos = getRoadLabelPos(r);
    if (pos) {
      const label = createLabel(r.name, "#cccccc", 0.6);
      label.position.copy(pos);
      group.add(label);
    }
  }

  scene.add(group);
  requestRender();
}

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
    mesh.position.set(
      (r.x1! + r.x2!) / 2,
      GROUND_Y + 0.1,
      (r.z1! + r.z2!) / 2,
    );
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
    return new THREE.Vector3(
      (r.x1! + r.x2!) / 2,
      GROUND_Y + 3,
      (r.z1! + r.z2!) / 2,
    );
  }
  if (r.type === "intersection") {
    return new THREE.Vector3(r.x!, GROUND_Y + 3, r.z!);
  }
  return null;
}

/**
 * Canvasベースのスプライトラベルを生成
 */
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

  // 背景
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 6);
  ctx.fill();

  // テキスト
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
