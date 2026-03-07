import * as THREE from "three";
import type { NetNode, RouteResult } from "../data/network";

const ROUTE_COLOR = 0x00ffaa;
const ROUTE_WIDTH = 3;
const MARKER_COLOR_START = 0x44ff88;
const MARKER_COLOR_END = 0xff4466;

let routeGroup: THREE.Group | null = null;

/**
 * 経路を3Dで描画
 */
export function renderRoute(
  scene: THREE.Scene,
  route: RouteResult,
  requestRender: () => void,
): void {
  clearRoute(scene);

  routeGroup = new THREE.Group();
  routeGroup.userData.layer = "route";

  const path = route.path;
  if (path.length < 2) return;

  // ルートライン（TubeGeometryでパスを太く見せる）
  const points = path.map((n) => new THREE.Vector3(n.x, n.y + 2, -n.z));
  const curve = new THREE.CatmullRomCurve3(points, false);

  const tubeGeom = new THREE.TubeGeometry(curve, path.length * 4, 0.6, 6, false);
  const tubeMat = new THREE.MeshBasicMaterial({
    color: ROUTE_COLOR,
    transparent: true,
    opacity: 0.85,
  });
  const tube = new THREE.Mesh(tubeGeom, tubeMat);
  routeGroup.add(tube);

  // 点線の進行方向アニメーション用ラインも追加
  const linePoints = path.map((n) => new THREE.Vector3(n.x, n.y + 2.5, -n.z));
  const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
  });
  const line = new THREE.Line(lineGeom, lineMat);
  routeGroup.add(line);

  // スタート・ゴールマーカー
  addMarker(routeGroup, path[0], MARKER_COLOR_START, "S");
  addMarker(routeGroup, path[path.length - 1], MARKER_COLOR_END, "G");

  scene.add(routeGroup);
  requestRender();
}

function addMarker(group: THREE.Group, node: NetNode, color: number, label: string) {
  // 球体マーカー
  const sphereGeom = new THREE.SphereGeometry(1.5, 12, 8);
  const sphereMat = new THREE.MeshBasicMaterial({ color });
  const sphere = new THREE.Mesh(sphereGeom, sphereMat);
  sphere.position.set(node.x, node.y + 3, -node.z);
  group.add(sphere);

  // ラベルSprite
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fill();
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(label, 32, 34);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: texture, depthWrite: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.set(node.x, node.y + 7, -node.z);
  sprite.scale.set(5, 5, 1);
  group.add(sprite);
}

/**
 * 経路表示をクリア
 */
export function clearRoute(scene: THREE.Scene) {
  if (routeGroup) {
    scene.remove(routeGroup);
    routeGroup.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    routeGroup = null;
  }
}
