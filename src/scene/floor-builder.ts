import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FloorData } from "../data/loader";
import { geoToShapes } from "../utils/geo-to-mesh";

// Spaceグループごとの色
const GROUP_COLORS: Record<string, number> = {
  walkway: 0x4488ff,    // 通路/コンコース
  ticket: 0x44cc88,     // 改札内・きっぷ売り場
  shop: 0xffaa44,       // 商業施設
  stairs: 0xff6666,     // 階段・EV・エスカ・スロープ
  elevator: 0xff6666,
  escalator: 0xff6666,
  platform: 0xaa88ff,   // ホーム
  toilet: 0x66cccc,     // トイレ
  info: 0x44cc88,       // 案内
  office: 0x888899,     // 事務所
  public: 0x66aa66,     // 公的施設
  room: 0x999999,       // その他部屋
  other: 0x777788,
};

const FLOOR_COLOR = 0x555566;
const FIXTURE_COLOR = 0x666680;
const EXTRUDE_HEIGHT = 3.0;
const FLOOR_THICKNESS = 0.3;

export interface BuiltFloor {
  group: THREE.Group;
  clickables: THREE.Mesh[];
}

/**
 * フロアデータから3Dメッシュを構築
 */
export function buildFloor(data: FloorData): BuiltFloor {
  const group = new THREE.Group();
  const clickables: THREE.Mesh[] = [];
  const baseY = data.y;

  // 1. フロア基盤面（Floor）
  const floorGeoms = collectGeometries(
    data.floors,
    (f) => f.geometry,
    FLOOR_THICKNESS,
  );
  if (floorGeoms.length > 0) {
    const merged = mergeGeometries(floorGeoms);
    if (merged) {
      const mat = new THREE.MeshLambertMaterial({
        color: FLOOR_COLOR,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.position.y = baseY;
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.layer = "floor";
      group.add(mesh);
      floorGeoms.forEach((g) => g.dispose());
    }
  }

  // 2. Space（グループごとにマージ）
  const spacesByGroup = new Map<string, THREE.BufferGeometry[]>();

  for (const space of data.spaces) {
    const grp = space.group;
    const shapes = geoToShapes(space.geometry);
    for (const shape of shapes) {
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: EXTRUDE_HEIGHT,
        bevelEnabled: false,
      });
      if (!spacesByGroup.has(grp)) {
        spacesByGroup.set(grp, []);
      }
      spacesByGroup.get(grp)!.push(geom);
    }
  }

  for (const [grp, geoms] of spacesByGroup) {
    if (geoms.length === 0) continue;
    const merged = mergeGeometries(geoms);
    if (merged) {
      const color = GROUP_COLORS[grp] ?? GROUP_COLORS.other;
      const mat = new THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.position.y = baseY;
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.layer = "space";
      mesh.userData.group = grp;
      group.add(mesh);
      clickables.push(mesh);
      geoms.forEach((g) => g.dispose());
    }
  }

  // 個別Space（ホバー用。マージとは別にraycast用に薄い透明メッシュ）
  for (const space of data.spaces) {
    const shapes = geoToShapes(space.geometry);
    for (const shape of shapes) {
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: EXTRUDE_HEIGHT,
        bevelEnabled: false,
      });
      const mat = new THREE.MeshBasicMaterial({
        visible: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.y = baseY;
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.layer = "space-hitbox";
      mesh.userData.name = space.name || "";
      mesh.userData.area = space.area;
      mesh.userData.category = space.category;
      mesh.userData.group = space.group;
      group.add(mesh);
      clickables.push(mesh);
    }
  }

  // 3. Fixture（柱等）
  const fixtureGeoms = collectGeometries(
    data.fixtures,
    (f) => f.geometry,
    EXTRUDE_HEIGHT * 0.8,
  );
  if (fixtureGeoms.length > 0) {
    const merged = mergeGeometries(fixtureGeoms);
    if (merged) {
      const mat = new THREE.MeshLambertMaterial({
        color: FIXTURE_COLOR,
        transparent: true,
        opacity: 0.6,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.position.y = baseY;
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.layer = "fixture";
      group.add(mesh);
      fixtureGeoms.forEach((g) => g.dispose());
    }
  }

  // 4. Drawing（壁の線分→薄い壁メッシュ）
  if (data.drawings.length > 0) {
    const wallGeoms: THREE.BufferGeometry[] = [];
    for (const drawing of data.drawings) {
      const coords = drawing.geometry.coordinates;
      if (coords.length < 2) continue;
      const points: THREE.Vector3[] = coords.map(
        (c) => new THREE.Vector3(c[0], 0, -c[1]),
      );
      // 壁として薄い面を立てる
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.01) continue;

        const wallGeom = new THREE.PlaneGeometry(len, EXTRUDE_HEIGHT);
        const midX = (p1.x + p2.x) / 2;
        const midZ = (p1.z + p2.z) / 2;
        const angle = Math.atan2(dz, dx);

        wallGeom.translate(0, EXTRUDE_HEIGHT / 2, 0);
        wallGeom.rotateY(-angle);
        wallGeom.translate(midX, 0, midZ);
        wallGeoms.push(wallGeom);
      }
    }
    if (wallGeoms.length > 0) {
      const merged = mergeGeometries(wallGeoms);
      if (merged) {
        const mat = new THREE.MeshLambertMaterial({
          color: 0x555577,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(merged, mat);
        mesh.position.y = baseY;
        mesh.userData.layer = "drawing";
        group.add(mesh);
        wallGeoms.forEach((g) => g.dispose());
      }
    }
  }

  return { group, clickables };
}

function collectGeometries<T>(
  items: T[],
  getGeom: (item: T) => { type: string; coordinates: unknown },
  height: number,
): THREE.BufferGeometry[] {
  const geoms: THREE.BufferGeometry[] = [];
  for (const item of items) {
    const geo = getGeom(item);
    const shapes = geoToShapes(geo as import("../data/loader").GeoPolygon);
    for (const shape of shapes) {
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
      });
      geoms.push(geom);
    }
  }
  return geoms;
}
