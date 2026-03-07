import * as THREE from "three";
import type { GeoPolygon } from "../data/loader";

/**
 * GeoJSON Polygon/MultiPolygon → Three.js Shape[] に変換
 * 座標系: [x, z] ローカルメートル座標（Python変換済み）
 */
export function geoToShapes(geometry: GeoPolygon): THREE.Shape[] {
  if (geometry.type === "Polygon") {
    const shape = polygonToShape(geometry.coordinates as number[][][]);
    return shape ? [shape] : [];
  } else if (geometry.type === "MultiPolygon") {
    const shapes: THREE.Shape[] = [];
    for (const poly of geometry.coordinates as number[][][][]) {
      const shape = polygonToShape(poly);
      if (shape) shapes.push(shape);
    }
    return shapes;
  }
  return [];
}

function polygonToShape(rings: number[][][]): THREE.Shape | null {
  if (rings.length === 0 || rings[0].length < 3) return null;

  // 外周リング
  const outer = rings[0];
  const shape = new THREE.Shape();
  shape.moveTo(outer[0][0], outer[0][1]);
  for (let i = 1; i < outer.length; i++) {
    shape.lineTo(outer[i][0], outer[i][1]);
  }
  shape.closePath();

  // 内周（穴）
  for (let h = 1; h < rings.length; h++) {
    const hole = rings[h];
    if (hole.length < 3) continue;
    const holePath = new THREE.Path();
    holePath.moveTo(hole[0][0], hole[0][1]);
    for (let i = 1; i < hole.length; i++) {
      holePath.lineTo(hole[i][0], hole[i][1]);
    }
    holePath.closePath();
    shape.holes.push(holePath);
  }

  return shape;
}
