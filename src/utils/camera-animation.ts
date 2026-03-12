import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * 経路の出発点に一人称視点でカメラを移動
 * @param startNode - 出発ノード {x, y, z} (network座標系)
 * @param nextNode - 経路上の次のノード（視線方向決定用）
 * @param camera
 * @param controls
 * @param requestRender
 */
export function moveCameraToFirstPerson(
  startNode: { x: number; y: number; z: number },
  nextNode: { x: number; y: number; z: number },
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  requestRender: () => void,
  negateZ = true,
): void {
  // 目線高さ: ノードのY + 1.6m（人の目線）
  const eyeHeight = 1.6;
  const startPos = new THREE.Vector3(startNode.x, startNode.y + eyeHeight, negateZ ? -startNode.z : startNode.z);

  // 視線方向: 次のノードの方を向く
  const lookAt = new THREE.Vector3(nextNode.x, nextNode.y + eyeHeight, negateZ ? -nextNode.z : nextNode.z);

  // 視線方向に少し離れた位置をtargetにする（8m先を見る）
  const dir = new THREE.Vector3().subVectors(lookAt, startPos).normalize();
  const target = new THREE.Vector3().copy(startPos).addScaledVector(dir, 8);

  // アニメーションで移動
  const duration = 800; // ms
  const startTime = performance.now();
  const fromPos = camera.position.clone();
  const fromTarget = controls.target.clone();

  function animate() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    // easeInOutCubic
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    camera.position.lerpVectors(fromPos, startPos, ease);
    controls.target.lerpVectors(fromTarget, target, ease);
    controls.update();
    requestRender();

    if (t < 1) {
      requestAnimationFrame(animate);
    }
  }
  animate();
}

/**
 * 鳥瞰視点に戻す
 * @param camera
 * @param controls
 * @param requestRender
 * @param centerY - フロアの中心Y座標（デフォルト0）
 */
export function moveCameraToBirdEye(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  requestRender: () => void,
  centerY: number = 0,
): void {
  const targetPos = new THREE.Vector3(200, 200, 300);
  const targetLookAt = new THREE.Vector3(0, centerY, 0);

  const duration = 800;
  const startTime = performance.now();
  const fromPos = camera.position.clone();
  const fromTarget = controls.target.clone();

  function animate() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    camera.position.lerpVectors(fromPos, targetPos, ease);
    controls.target.lerpVectors(fromTarget, targetLookAt, ease);
    controls.update();
    requestRender();

    if (t < 1) {
      requestAnimationFrame(animate);
    }
  }
  animate();
}

/**
 * カメラをターゲット位置にスムーズ移動
 */
export function animateCameraTo(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  targetPos: THREE.Vector3,
  requestRender: () => void,
  duration = 600,
) {
  const startTarget = controls.target.clone();
  const startCamPos = camera.position.clone();

  // ターゲットから適度な距離のカメラ位置を計算
  const offset = new THREE.Vector3(60, 50, 60);
  const endCamPos = targetPos.clone().add(offset);

  const startTime = performance.now();

  function tick() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    // easeOutCubic
    const ease = 1 - Math.pow(1 - t, 3);

    controls.target.lerpVectors(startTarget, targetPos, ease);
    camera.position.lerpVectors(startCamPos, endCamPos, ease);
    requestRender();

    if (t < 1) {
      requestAnimationFrame(tick);
    }
  }
  tick();
}
