import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

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
