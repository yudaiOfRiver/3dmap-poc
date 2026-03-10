import * as THREE from "three";
import { setupScene } from "./scene/setup";
import { setupFloorSelector } from "./ui/floor-selector";
import { setupSearchPanel } from "./ui/search-panel";
import { showDetail } from "./ui/info-panel";
import { buildSearchIndex } from "./data/search";
import { animateCameraTo, moveCameraToFirstPerson, moveCameraToBirdEye } from "./utils/camera-animation";
import { loadNetwork, findNearestNode, findRoute, buildRouteSteps } from "./data/network";
import { setupRoutePanel } from "./ui/route-panel";
import { renderRoute, clearRoute, getViewToggleButton } from "./scene/route-renderer";
import { setupLocatePanel } from "./ui/locate-panel";
import type { POIEntry } from "./scene/poi-layer";
import type { FloorInfo } from "./data/loader";
import "./style.css";

// --- PLATEAU データ型 ---

interface PlateauSurface {
  type: string;
  vertices: number[];   // flat [x,y,z, ...]
  indices: number[];     // triangle indices
  normal?: number[];
  centroid?: [number, number, number];
}

interface PlateauFloorData {
  ordinal: number;
  y: number;
  surfaces: PlateauSurface[];
  stats: Record<string, number>;
}

// --- サーフェス描画設定 ---

const SURFACE_COLORS: Record<string, number> = {
  wall: 0x8899aa,
  floor: 0x556677,
  ceiling: 0x667788,
  closure: 0x778899,
  door: 0x33cc77,
  window: 0x88ddff,
  installation: 0xaa8866,
};

const SURFACE_OPACITY: Record<string, number> = {
  wall: 0.7,
  floor: 0.5,
  ceiling: 0.3,
  closure: 0.4,
  door: 0.75,
  window: 0.18,
  installation: 0.6,
};

const EDGE_TYPES = new Set(["wall", "floor", "door", "window"]);

// --- テナント配置用ハッシュ ---

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

// --- テナントタイプ → 色 ---

const TYPE_COLORS: Record<string, string> = {
  convenience: "#44cc44",
  cafe: "#cc8844",
  restaurant: "#cc4444",
  fastfood: "#ff6644",
  drugstore: "#44aacc",
  fashion: "#cc44aa",
  goods: "#aaaa44",
  book: "#8888cc",
  beauty: "#cc88cc",
  service: "#6688aa",
  food: "#ff8844",
  other: "#888888",
};

// --- テナントフロアキー正規化 ---

const AREA_MAP: Record<string, string> = {
  サブナード: "サブナード",
  京王モール: "京王モール",
  京王モールアネックス: "京王",
  小田急エース: "小田急",
  JR新宿駅改札内: "JR改札",
  JR新宿駅新南改札: "JR新南改札",
  西武新宿駅: "西武",
  都営新宿西口駅: "都営西口",
  ルミネ新宿: "ルミネ",
  西口周辺: "西口周辺",
};

function normalizeFloorKey(key: string, area: string): string {
  if (area === "サブナード") return "B2";
  return key.replace(/F$/, "");
}

// --- テナントデータ型 ---

interface TenantStore {
  name: string;
  area: string;
  floorKey: string;
  type: string;
  icon: string;
}

interface PlacedTenantPOI {
  store: TenantStore;
  floorKey: string;
  worldPos: THREE.Vector3;
  sprite: THREE.Sprite;
}

const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

async function main() {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const { scene, camera, controls, requestRender } = setupScene(canvas);

  // 新宿駅向けカメラ初期値
  camera.position.set(150, 120, 200);
  controls.target.set(0, -10, 0);
  controls.update();

  // 操作ヒント
  const infoPanel = document.getElementById("info-panel")!;
  infoPanel.textContent = isTouchDevice
    ? "1本指: 回転 | ピンチ: ズーム | 2本指: 移動"
    : "ドラッグ: 回転 | スクロール: ズーム | 右ドラッグ: 移動";

  // 凡例の折りたたみ
  const legend = document.getElementById("legend")!;
  const legendHeader = legend.querySelector(".legend-header")!;
  if (!isTouchDevice) legend.classList.remove("collapsed");
  legendHeader.addEventListener("click", () => {
    if (isTouchDevice) {
      legend.classList.toggle("expanded");
    } else {
      legend.classList.toggle("collapsed");
    }
  });

  // --- フロアインデックス読み込み（PLATEAU新宿データ） ---

  const indexRes = await fetch("./data/shinjuku_plateau/index.json");
  const floors: FloorInfo[] = await indexRes.json();

  // --- フロアデータをロード & BufferGeometryメッシュ構築 ---

  const floorGroups = new Map<string, THREE.Group>();
  const floorEntries: { info: FloorInfo; data: PlateauFloorData }[] = [];

  for (const info of floors) {
    const res = await fetch(`./data/shinjuku_plateau/${info.key}.json`);
    const data: PlateauFloorData = await res.json();
    floorEntries.push({ info, data });

    const group = new THREE.Group();

    // サーフェスタイプごとにマージ
    const surfacesByType = new Map<string, { vertices: number[]; indices: number[]; indexOffset: number }>();

    for (const surface of data.surfaces) {
      const t = surface.type;
      if (!surfacesByType.has(t)) {
        surfacesByType.set(t, { vertices: [], indices: [], indexOffset: 0 });
      }
      const bucket = surfacesByType.get(t)!;
      const offset = bucket.indexOffset;

      bucket.vertices.push(...surface.vertices);
      for (const idx of surface.indices) {
        bucket.indices.push(idx + offset);
      }
      bucket.indexOffset += surface.vertices.length / 3;
    }

    // 各タイプのマージ済みメッシュを生成
    for (const [type, bucket] of surfacesByType) {
      if (bucket.vertices.length === 0) continue;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.vertices, 3));
      geometry.setIndex(bucket.indices);
      geometry.computeVertexNormals();

      const color = SURFACE_COLORS[type] ?? 0x888888;
      const opacity = SURFACE_OPACITY[type] ?? 0.5;

      const material = new THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.layer = type;
      group.add(mesh);

      // エッジアウトライン（壁・床・ドア・窓）
      if (EDGE_TYPES.has(type)) {
        const edgeGeom = new THREE.EdgesGeometry(geometry, 30);
        const edgeColor = type === "door" ? 0x22aa55 : type === "window" ? 0x5599cc : 0x223344;
        const edgeMat = new THREE.LineBasicMaterial({
          color: edgeColor,
          transparent: true,
          opacity: 0.6,
        });
        const edges = new THREE.LineSegments(edgeGeom, edgeMat);
        group.add(edges);
      }
    }

    scene.add(group);
    floorGroups.set(info.key, group);
  }

  // --- ドアPOI生成（PLATEAUデータのcentroidから） ---

  const allPOIs: POIEntry[] = [];

  for (const { info, data } of floorEntries) {
    const poiGroup = new THREE.Group();
    let doorCount = 0;
    for (const surface of data.surfaces) {
      if (surface.type !== "door" || !surface.centroid) continue;
      if (doorCount >= 30) break; // 各フロア最大30ドア
      doorCount++;

      const [cx, cy, cz] = surface.centroid;

      const poiCanvas = document.createElement("canvas");
      poiCanvas.width = 64;
      poiCanvas.height = 64;
      const ctx = poiCanvas.getContext("2d")!;
      ctx.beginPath();
      ctx.arc(32, 32, 30, 0, Math.PI * 2);
      ctx.fillStyle = "#33cc77";
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = "28px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText("🚪", 32, 33);

      const texture = new THREE.CanvasTexture(poiCanvas);
      const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, sizeAttenuation: true });
      const sprite = new THREE.Sprite(mat);
      const worldPos = new THREE.Vector3(cx, cy + 1, cz);
      sprite.position.copy(worldPos);
      sprite.scale.set(4, 4, 1);
      poiGroup.add(sprite);

      allPOIs.push({
        sprite,
        facility: {
          geometry: { type: "Point", coordinates: [cx, -cz] },
          category: "DOOR",
          area: `${info.label}`,
          name: "ドア",
        },
        floorKey: info.key,
        worldPos,
        label: `ドア (${info.label})`,
        categoryLabel: "ドア",
      });
    }
    const floorGroup = floorGroups.get(info.key);
    if (floorGroup) floorGroup.add(poiGroup);
  }

  // --- テナント情報読み込み & floor surface centroidベースで配置 ---

  const tenantPOIs: PlacedTenantPOI[] = [];
  try {
    const tenantRes = await fetch("./data/tenants.json");
    if (tenantRes.ok) {
      const tenantData = await tenantRes.json();
      const stores: TenantStore[] = tenantData.stores || [];

      for (const store of stores) {
        const floorKey = normalizeFloorKey(store.floorKey, store.area);
        const floorGroup = floorGroups.get(floorKey);
        if (!floorGroup) continue;

        // フロアデータからfloorサーフェスのcentroidを取得
        const floorData = floorEntries.find(e => e.info.key === floorKey);
        if (!floorData) continue;
        const floorSurfaces = floorData.data.surfaces.filter(s => s.type === "floor" && s.centroid);
        if (floorSurfaces.length === 0) continue;

        // ハッシュベースでfloorサーフェスの重心に配置
        const idx = Math.abs(hashCode(store.name)) % floorSurfaces.length;
        const centroid = floorSurfaces[idx].centroid!;

        const tenantCanvas = document.createElement("canvas");
        tenantCanvas.width = 256;
        tenantCanvas.height = 80;
        const ctx = tenantCanvas.getContext("2d")!;
        ctx.fillStyle = TYPE_COLORS[store.type] ?? "#888888";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(0, 0, 256, 80);
        ctx.globalAlpha = 1;
        ctx.font = "32px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.fillText(store.icon, 8, 40);
        ctx.font = "bold 22px sans-serif";
        const name = store.name.length > 10 ? store.name.slice(0, 10) + "…" : store.name;
        ctx.fillText(name, 48, 40);

        const texture = new THREE.CanvasTexture(tenantCanvas);
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, sizeAttenuation: true });
        const sprite = new THREE.Sprite(mat);
        const worldPos = new THREE.Vector3(centroid[0], centroid[1] + 2, centroid[2]);
        sprite.position.copy(worldPos);
        sprite.scale.set(14, 4.5, 1);
        floorGroup.add(sprite);

        const dataArea = AREA_MAP[store.area] ?? store.area;
        const poiEntry: POIEntry = {
          sprite,
          facility: {
            geometry: { type: "Point", coordinates: [worldPos.x, -worldPos.z] },
            category: "TENANT",
            area: dataArea,
            name: store.name,
          },
          floorKey,
          worldPos,
          label: `${dataArea} - ${store.name}`,
          categoryLabel: store.type,
        };
        allPOIs.push(poiEntry);

        tenantPOIs.push({
          store,
          floorKey,
          worldPos,
          sprite,
        });
      }
    }
  } catch { /* テナントデータがなくても動作する */ }

  // --- 検索インデックス構築（ドアPOI + テナントPOI統合） ---

  buildSearchIndex(allPOIs);

  requestRender();

  // --- フロア切替UI ---

  let currentActiveFloors: Set<string>;
  setupFloorSelector(floors, onFloorChange);
  currentActiveFloors = new Set(floors.map((f) => f.key));

  function onFloorChange(active: Set<string>) {
    currentActiveFloors = active;
    for (const [key, group] of floorGroups) {
      group.visible = active.has(key);
    }

    if (active.size === 1) {
      const key = [...active][0];
      const info = floors.find((f) => f.key === key);
      if (info) controls.target.set(0, info.y, 0);
    } else {
      controls.target.set(0, -10, 0);
    }
    requestRender();
  }

  // --- 検索UI ---

  setupSearchPanel((item) => {
    // 該当フロアを表示
    const active = new Set([item.floorKey]);
    currentActiveFloors = active;
    onFloorChange(active);

    // フロアボタンのUI更新
    document.querySelectorAll<HTMLButtonElement>(".floor-btn[data-floor-key]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.floorKey === item.floorKey);
    });
    document.querySelectorAll<HTMLButtonElement>(".floor-btn:not([data-floor-key])").forEach((btn) => {
      btn.classList.remove("active");
    });

    // カメラ移動
    animateCameraTo(camera, controls, item.poiEntry.worldPos, requestRender);

    // 詳細パネル表示
    showDetail(item.poiEntry);
  });

  // --- ネットワークデータ読み込み + 経路検索UI ---

  try {
    await loadNetwork("./data/network.json");
  } catch {
    console.warn("ネットワークデータが見つかりません（経路検索は無効）");
  }

  const routeUI = setupRoutePanel(
    (req) => {
      const startNode = findNearestNode(
        req.start.worldPos.x, req.start.worldPos.y, -req.start.worldPos.z,
      );
      const endNode = findNearestNode(
        req.end.worldPos.x, req.end.worldPos.y, -req.end.worldPos.z,
      );

      if (!startNode || !endNode) {
        routeUI.showError();
        return;
      }

      const result = findRoute(startNode.id, endNode.id, {
        avoidStairs: req.barrierFree,
      });
      if (!result) {
        routeUI.showError();
        return;
      }

      // 経路が通るフロアのみ表示
      const routeFloors = [...new Set(result.path.map((n) => n.floor))];
      const routeActive = new Set(routeFloors);
      onFloorChange(routeActive);
      document.querySelectorAll<HTMLButtonElement>(".floor-btn[data-floor-key]").forEach((btn) => {
        btn.classList.toggle("active", routeActive.has(btn.dataset.floorKey!));
      });
      document.querySelectorAll<HTMLButtonElement>(".floor-btn:not([data-floor-key])").forEach((btn) => {
        btn.classList.remove("active");
      });

      // 経路描画
      renderRoute(scene, result, requestRender);

      // フロア別ステップ生成
      const steps = buildRouteSteps(result);
      routeUI.showResult(result.totalDistance, routeFloors, steps);

      // 出発点の一人称視点に移動
      const startPath = result.path[0];
      const nextPath = result.path[Math.min(3, result.path.length - 1)];
      let isFirstPerson = true;
      moveCameraToFirstPerson(startPath, nextPath, camera, controls, requestRender);

      // 視点切替ボタンのハンドラ
      const toggleBtn = getViewToggleButton();
      if (toggleBtn) {
        toggleBtn.textContent = "🦅 鳥瞰";
        toggleBtn.onclick = () => {
          if (isFirstPerson) {
            moveCameraToBirdEye(camera, controls, requestRender);
            toggleBtn.textContent = "👁 目線";
            isFirstPerson = false;
          } else {
            moveCameraToFirstPerson(startPath, nextPath, camera, controls, requestRender);
            toggleBtn.textContent = "🦅 鳥瞰";
            isFirstPerson = true;
          }
        };
      }
    },
    () => {
      clearRoute(scene);
      requestRender();
    },
  );

  // --- 現在地特定パネル ---

  let locateMarker: THREE.Mesh | null = null;
  setupLocatePanel(allPOIs, (result) => {
    const active = new Set([result.floorKey]);
    onFloorChange(active);
    document.querySelectorAll<HTMLButtonElement>(".floor-btn[data-floor-key]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.floorKey === result.floorKey);
    });
    document.querySelectorAll<HTMLButtonElement>(".floor-btn:not([data-floor-key])").forEach((btn) => {
      btn.classList.remove("active");
    });

    // 既存マーカーを削除
    if (locateMarker) {
      scene.remove(locateMarker);
      locateMarker.geometry.dispose();
      (locateMarker.material as THREE.Material).dispose();
      locateMarker = null;
    }

    // 現在地マーカーを配置（青い光る円柱）
    const markerGeom = new THREE.CylinderGeometry(2.5, 2.5, 0.5, 16);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff,
      transparent: true,
      opacity: 0.7,
    });
    locateMarker = new THREE.Mesh(markerGeom, markerMat);
    locateMarker.position.copy(result.position);
    locateMarker.position.y += 0.5;
    scene.add(locateMarker);

    // カメラ移動
    animateCameraTo(camera, controls, result.position, requestRender);
  });

  // --- ツールチップ ---

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tooltip = document.getElementById("tooltip")!;

  const typeNames: Record<string, string> = {
    wall: "壁",
    floor: "床",
    ceiling: "天井",
    closure: "閉鎖面",
    door: "ドア",
    window: "窓",
    installation: "設備",
  };

  function showTooltip(text: string, clientX: number, clientY: number) {
    tooltip.textContent = text;
    tooltip.style.display = "block";
    if (isTouchDevice) {
      tooltip.style.left = "50%";
      tooltip.style.transform = "translateX(-50%)";
      tooltip.style.top = "auto";
      tooltip.style.bottom = "50px";
    } else {
      tooltip.style.left = clientX + 15 + "px";
      tooltip.style.top = clientY - 10 + "px";
      tooltip.style.transform = "";
      tooltip.style.bottom = "";
    }
  }

  function handlePointerHit(clientX: number, clientY: number) {
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    // POIスプライトのraycast
    const visibleSprites = allPOIs
      .filter((p) => p.sprite.parent?.parent?.visible)
      .map((p) => p.sprite);

    const spriteHits = raycaster.intersectObjects(visibleSprites);
    if (spriteHits.length > 0) {
      const hit = allPOIs.find((p) => p.sprite === spriteHits[0].object);
      if (hit) {
        showTooltip(hit.label, clientX, clientY);
        return;
      }
    }

    // メッシュhit（サーフェスタイプ名を表示）
    const meshes: THREE.Mesh[] = [];
    for (const [, group] of floorGroups) {
      if (!group.visible) continue;
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
    }

    const intersects = raycaster.intersectObjects(meshes);
    if (intersects.length > 0) {
      const layer = intersects[0].object.userData.layer;
      showTooltip(typeNames[layer] || layer, clientX, clientY);
      return;
    }

    tooltip.style.display = "none";
  }

  // POIタップで詳細表示
  function handlePointerTap(clientX: number, clientY: number) {
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const visibleSprites = allPOIs
      .filter((p) => p.sprite.parent?.parent?.visible)
      .map((p) => p.sprite);
    const spriteHits = raycaster.intersectObjects(visibleSprites);
    if (spriteHits.length > 0) {
      const hit = allPOIs.find((p) => p.sprite === spriteHits[0].object);
      if (hit) {
        showDetail(hit);
        animateCameraTo(camera, controls, hit.worldPos, requestRender);
      }
    }
  }

  // PC: pointermove + click
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    handlePointerHit(e.clientX, e.clientY);
  });
  canvas.addEventListener("click", (e) => {
    handlePointerTap(e.clientX, e.clientY);
  });

  // スマホ: シングルタップ
  if (isTouchDevice) {
    let touchStart = 0;
    let touchStartPos = { x: 0, y: 0 };

    canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        touchStart = Date.now();
        touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { passive: true });

    canvas.addEventListener("touchend", (e) => {
      const dt = Date.now() - touchStart;
      if (dt < 300 && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStartPos.x;
        const dy = t.clientY - touchStartPos.y;
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          handlePointerHit(t.clientX, t.clientY);
          handlePointerTap(t.clientX, t.clientY);
        }
      }
    }, { passive: true });
  }
}

main();
