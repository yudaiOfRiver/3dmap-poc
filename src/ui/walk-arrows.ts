import * as THREE from "three";
import type { DirectionInfo } from "./walk-engine";
import { triggerWalkTo } from "./walk-engine";

const ARROW_COLOR = 0x00ffaa;
const ARROW_HOVER_COLOR = 0x66ffcc;
const ARROW_Y_OFFSET = -0.3; // 目線より少し下

const ROUTE_TYPE_ICONS: Record<number, string> = {
  1: "→",
  4: "🪜",  // 階段
  5: "⬆️",  // エスカレーター
  6: "🛗",  // エレベーター
};

let arrowGroup: THREE.Group | null = null;
let arrowMeshes: { mesh: THREE.Mesh; info: DirectionInfo }[] = [];
let labelSprites: THREE.Sprite[] = [];

/**
 * 分岐で方向矢印を表示
 */
export function showWalkArrows(
  scene: THREE.Scene,
  position: THREE.Vector3,
  directions: DirectionInfo[],
  requestRender: () => void,
): void {
  clearWalkArrows(scene);

  arrowGroup = new THREE.Group();
  arrowGroup.name = "walk-arrows";
  arrowMeshes = [];
  labelSprites = [];

  for (const dir of directions) {
    // 矢印メッシュ（コーン）
    const coneGeo = new THREE.ConeGeometry(0.4, 1.2, 8);
    const coneMat = new THREE.MeshBasicMaterial({
      color: ARROW_COLOR,
      transparent: true,
      opacity: 0.85,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);

    // 方向に配置（position + direction * 3m）
    const arrowPos = position.clone().add(dir.direction.clone().multiplyScalar(3));
    arrowPos.y = position.y + ARROW_Y_OFFSET;
    cone.position.copy(arrowPos);

    // コーンを方向に向ける（デフォルトは+Y方向なので90度回転）
    const axis = new THREE.Vector3(0, 1, 0);
    const targetDir = dir.direction.clone();
    targetDir.y = 0;
    targetDir.normalize();

    // Y軸回転 + X軸に90度傾ける
    cone.rotation.z = -Math.PI / 2;
    cone.rotation.y = 0;
    // lookAtで方向を向ける
    const lookTarget = arrowPos.clone().add(targetDir);
    cone.lookAt(lookTarget);
    cone.rotateX(Math.PI / 2);

    cone.userData = { directionInfo: dir };
    arrowGroup.add(cone);
    arrowMeshes.push({ mesh: cone, info: dir });

    // ラベル（距離と方向）
    const icon = ROUTE_TYPE_ICONS[dir.routeType] || "→";
    const labelText = `${icon} ${dir.distance}m`;
    const label = createArrowLabel(labelText);
    label.position.copy(arrowPos);
    label.position.y += 1.0;
    arrowGroup.add(label);
    labelSprites.push(label);
  }

  scene.add(arrowGroup);
  requestRender();

  // パルスアニメーション
  startPulseAnimation(requestRender);
}

/**
 * 矢印を消す
 */
export function clearWalkArrows(scene: THREE.Scene): void {
  stopPulseAnimation();
  if (arrowGroup) {
    scene.remove(arrowGroup);
    arrowGroup.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      if (child instanceof THREE.Sprite) {
        (child.material as THREE.SpriteMaterial).map?.dispose();
        child.material.dispose();
      }
    });
    arrowGroup = null;
  }
  arrowMeshes = [];
  labelSprites = [];
}

/**
 * クリック/タップで矢印を判定
 */
export function handleArrowClick(
  raycaster: THREE.Raycaster,
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  scene: THREE.Scene,
): boolean {
  if (arrowMeshes.length === 0) return false;

  raycaster.setFromCamera(pointer, camera);
  const meshes = arrowMeshes.map(a => a.mesh);
  const intersects = raycaster.intersectObjects(meshes);

  if (intersects.length > 0) {
    const hit = intersects[0].object;
    const entry = arrowMeshes.find(a => a.mesh === hit);
    if (entry) {
      clearWalkArrows(scene);
      triggerWalkTo(entry.info.neighborId);
      return true;
    }
  }
  return false;
}

/**
 * ホバーエフェクト
 */
export function handleArrowHover(
  raycaster: THREE.Raycaster,
  pointer: THREE.Vector2,
  camera: THREE.Camera,
): void {
  if (arrowMeshes.length === 0) return;

  raycaster.setFromCamera(pointer, camera);
  const meshes = arrowMeshes.map(a => a.mesh);
  const intersects = raycaster.intersectObjects(meshes);

  for (const entry of arrowMeshes) {
    const mat = entry.mesh.material as THREE.MeshBasicMaterial;
    if (intersects.length > 0 && intersects[0].object === entry.mesh) {
      mat.color.setHex(ARROW_HOVER_COLOR);
      entry.mesh.scale.setScalar(1.3);
    } else {
      mat.color.setHex(ARROW_COLOR);
      entry.mesh.scale.setScalar(1.0);
    }
  }
}

/* ── パルスアニメーション ── */
let pulseId: number | null = null;

function startPulseAnimation(requestRender: () => void) {
  const startTime = performance.now();
  function pulse() {
    const t = ((performance.now() - startTime) % 1500) / 1500;
    const scale = 1.0 + 0.2 * Math.sin(t * Math.PI * 2);
    const opacity = 0.6 + 0.3 * Math.sin(t * Math.PI * 2);
    for (const entry of arrowMeshes) {
      entry.mesh.scale.setScalar(scale);
      (entry.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
    requestRender();
    pulseId = requestAnimationFrame(pulse);
  }
  pulseId = requestAnimationFrame(pulse);
}

function stopPulseAnimation() {
  if (pulseId !== null) {
    cancelAnimationFrame(pulseId);
    pulseId = null;
  }
}

/* ── ラベル生成 ── */
function createArrowLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const fontSize = 24;
  ctx.font = `bold ${fontSize}px sans-serif`;
  const w = ctx.measureText(text).width + 12;
  const h = fontSize + 8;
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);

  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 4);
  ctx.fill();

  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = "#00ffaa";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(2.5 * aspect, 2.5, 1);
  return sprite;
}
