import * as THREE from "three";
import type { NetNode, RouteResult } from "../data/network";

const ROUTE_COLOR = 0x00ffaa;
const ROUTE_WIDTH = 3;
const MARKER_COLOR_START = 0x44ff88;
const MARKER_COLOR_END = 0xff4466;

let routeGroup: THREE.Group | null = null;
let animationId: number | null = null;
let requestRenderFn: (() => void) | null = null;
let viewToggleBtn: HTMLButtonElement | null = null;

/**
 * 経路を3Dで描画
 */
export function renderRoute(
  scene: THREE.Scene,
  route: RouteResult,
  requestRender: () => void,
  negateZ = true,
): void {
  clearRoute(scene);

  routeGroup = new THREE.Group();
  routeGroup.userData.layer = "route";

  const path = route.path;
  if (path.length < 2) return;

  // ルートライン（TubeGeometryでパスを太く見せる）
  const points = path.map((n) => new THREE.Vector3(n.x, n.y + 2, negateZ ? -n.z : n.z));
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
  const linePoints = path.map((n) => new THREE.Vector3(n.x, n.y + 2.5, negateZ ? -n.z : n.z));
  const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
  });
  const line = new THREE.Line(lineGeom, lineMat);
  routeGroup.add(line);

  // パルスマーカー（経路上を移動する光る球体）
  const pulseGeom = new THREE.SphereGeometry(1.0, 8, 6);
  const pulseMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
  });
  const pulse = new THREE.Mesh(pulseGeom, pulseMat);
  routeGroup.add(pulse);

  // スタート・ゴールマーカー
  addMarker(routeGroup, path[0], MARKER_COLOR_START, "S", negateZ);
  addMarker(routeGroup, path[path.length - 1], MARKER_COLOR_END, "G", negateZ);

  scene.add(routeGroup);
  requestRender();

  // 視点切替ボタンを表示
  if (!viewToggleBtn) {
    viewToggleBtn = document.createElement("button");
    viewToggleBtn.id = "view-toggle";
    // インラインスタイル
    Object.assign(viewToggleBtn.style, {
      position: "absolute",
      bottom: "50px",
      right: "12px",
      padding: "8px 16px",
      fontSize: "14px",
      fontWeight: "bold",
      border: "1px solid rgba(80,140,220,0.4)",
      borderRadius: "8px",
      background: "rgba(10,30,55,0.9)",
      color: "#e0eaf5",
      cursor: "pointer",
      backdropFilter: "blur(8px)",
      zIndex: "20",
      pointerEvents: "auto",
      display: "none",
    });
    document.getElementById("ui")!.appendChild(viewToggleBtn);
  }
  viewToggleBtn.style.display = "block";
  viewToggleBtn.textContent = "👁 目線";
  viewToggleBtn.dataset.view = "firstperson";

  // パルスアニメーション開始
  requestRenderFn = requestRender;
  let t = 0;
  function animatePulse() {
    t += 0.002; // ~8秒で1サイクル (1/500 * 60fps ≈ 8.3秒)
    if (t > 1) t = 0;
    const pos = curve.getPoint(t);
    pulse.position.copy(pos);
    if (requestRenderFn) requestRenderFn();
    animationId = requestAnimationFrame(animatePulse);
  }
  animatePulse();
}

function addMarker(group: THREE.Group, node: NetNode, color: number, label: string, negateZ: boolean) {
  // 球体マーカー
  const sphereGeom = new THREE.SphereGeometry(1.5, 12, 8);
  const sphereMat = new THREE.MeshBasicMaterial({ color });
  const sphere = new THREE.Mesh(sphereGeom, sphereMat);
  sphere.position.set(node.x, node.y + 3, negateZ ? -node.z : node.z);
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
  sprite.position.set(node.x, node.y + 7, negateZ ? -node.z : node.z);
  sprite.scale.set(5, 5, 1);
  group.add(sprite);
}

/**
 * 視点切替ボタンの参照を取得
 */
export function getViewToggleButton(): HTMLButtonElement | null {
  return viewToggleBtn;
}

/**
 * 経路表示をクリア
 */
export function clearRoute(scene: THREE.Scene) {
  // アニメーション停止
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  requestRenderFn = null;

  if (viewToggleBtn) {
    viewToggleBtn.style.display = "none";
  }

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
