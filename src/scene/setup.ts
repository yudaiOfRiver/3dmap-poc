import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  requestRender: () => void;
}

export function setupScene(canvas: HTMLCanvasElement): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1a2d);
  scene.fog = new THREE.Fog(0x0b1a2d, 300, 800);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    2000,
  );
  camera.position.set(200, 200, 300);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  controls.maxDistance = 1000;
  controls.minDistance = 10;

  // タッチ操作の最適化
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };
  controls.rotateSpeed = 0.8;
  controls.panSpeed = 0.8;
  controls.zoomSpeed = 1.2;

  // ライティング
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
  dirLight.position.set(100, 200, 150);
  scene.add(dirLight);

  // グリッド
  const grid = new THREE.GridHelper(600, 60, 0x1a3a5c, 0x112840);
  grid.position.y = -20;
  scene.add(grid);

  // --- 静止時レンダリング停止 ---
  let renderRequested = true;
  let dampingFrames = 0;
  const MAX_DAMPING_FRAMES = 60; // ダンピング後の余韻フレーム

  function requestRender() {
    renderRequested = true;
    dampingFrames = MAX_DAMPING_FRAMES;
  }

  controls.addEventListener("change", requestRender);

  function animate() {
    requestAnimationFrame(animate);

    const needsUpdate = controls.update();
    if (needsUpdate) {
      dampingFrames = MAX_DAMPING_FRAMES;
    }

    if (renderRequested || dampingFrames > 0) {
      renderer.render(scene, camera);
      renderRequested = false;
      if (dampingFrames > 0) dampingFrames--;
    }
  }
  animate();

  // リサイズ
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    requestRender();
  });

  return { renderer, scene, camera, controls, requestRender };
}
