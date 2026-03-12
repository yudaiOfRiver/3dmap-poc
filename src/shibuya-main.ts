import * as THREE from "three";
import { setupScene } from "./scene/setup";
import { setupFloorSelector } from "./ui/floor-selector";
import { animateCameraTo, moveCameraToFirstPerson, moveCameraToBirdEye, moveCameraToWalkView } from "./utils/camera-animation";
import { loadNetwork, findNearestNode, findRoute, buildRouteSteps } from "./data/network";
import { setupRoutePanel } from "./ui/route-panel";
import { renderRoute, clearRoute, getViewToggleButton } from "./scene/route-renderer";
import { buildSearchIndex } from "./data/search";
import { setupLocatePanel } from "./ui/locate-panel";
import { renderTenants, setTenantFirstPersonMode } from "./scene/tenant-renderer";
import type { TenantStore, RenderedTenant } from "./scene/tenant-renderer";
import { createNavBar, type NavBarController } from "./ui/nav-bar";
import type { POIEntry } from "./scene/poi-layer";
import type { FloorInfo } from "./data/loader";
import Fuse from "fuse.js";
import { renderBuildings } from "./scene/building-renderer";
import "./style.css";

interface ShibuyaSurface {
  type: string;
  vertices: number[];  // flat array [x,y,z, x,y,z, ...]
  indices: number[];   // triangle indices
  centroid?: [number, number, number];
}

interface ShibuyaFloorData {
  ordinal: number;
  y: number;
  surfaces: ShibuyaSurface[];
  stats: Record<string, number>;
}

interface ShibuyaPOI {
  sprite: THREE.Sprite;
  floorKey: string;
  worldPos: THREE.Vector3;
  label: string;
  surfaceType: string;
}

// サーフェスタイプ -> 色
const SURFACE_COLORS: Record<string, number> = {
  wall: 0x8899aa,
  floor: 0x556677,
  ceiling: 0x667788,
  closure: 0x778899,
  door: 0x33cc77,
  window: 0x88ddff,
  installation: 0xaa8866,
};

// サーフェスタイプ -> 不透明度
const SURFACE_OPACITY: Record<string, number> = {
  wall: 0.7,
  floor: 0.5,
  ceiling: 0.3,
  closure: 0.4,
  door: 0.75,
  window: 0.18,
  installation: 0.6,
};

// エッジアウトラインを付けるサーフェスタイプ
const EDGE_TYPES = new Set(["wall", "floor", "door", "window"]);

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

async function main() {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const { scene, camera, controls, requestRender } = setupScene(canvas);

  // 地下駅向けカメラ初期値（B1レベルを見下ろす）
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

  // フロアインデックス読み込み
  const indexRes = await fetch("./data/shibuya/index.json");
  const floors: FloorInfo[] = await indexRes.json();

  // フロアデータをロード & 3Dメッシュ構築
  const floorGroups = new Map<string, THREE.Group>();
  const floorEntries: { info: FloorInfo; data: ShibuyaFloorData }[] = [];

  for (const info of floors) {
    const res = await fetch(`./data/shibuya/${info.key}.json`);
    const data: ShibuyaFloorData = await res.json();
    floorEntries.push({ info, data });

    const group = new THREE.Group();

    // サーフェスタイプごとにメッシュを作成
    const surfacesByType = new Map<string, { vertices: number[]; indices: number[]; indexOffset: number }>();

    for (const surface of data.surfaces) {
      const t = surface.type;
      if (!surfacesByType.has(t)) {
        surfacesByType.set(t, { vertices: [], indices: [], indexOffset: 0 });
      }
      const bucket = surfacesByType.get(t)!;
      const offset = bucket.indexOffset;

      // 頂点を追加
      bucket.vertices.push(...surface.vertices);

      // インデックスをオフセット付きで追加
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

      // エッジアウトラインを追加（壁・床・ドア・窓）
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

  // ドアPOIを生成（PLATEAUデータから）
  const allPOIs: ShibuyaPOI[] = [];
  const poiTypeConfig: Record<string, { icon: string; color: string; label: string }> = {
    door: { icon: "🚪", color: "#33cc77", label: "ドア" },
    window: { icon: "🪟", color: "#88ddff", label: "窓" },
    installation: { icon: "⚙", color: "#aa8866", label: "設備" },
  };

  for (const { info, data } of floorEntries) {
    const poiGroup = new THREE.Group();
    let doorCount = 0;
    for (const surface of data.surfaces) {
      if (surface.type !== "door" || !surface.centroid) continue;
      if (doorCount >= 30) break; // 各フロア最大30ドア
      doorCount++;

      const [cx, cy, cz] = surface.centroid;
      const config = poiTypeConfig.door;

      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.beginPath();
      ctx.arc(32, 32, 30, 0, Math.PI * 2);
      ctx.fillStyle = config.color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = "28px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(config.icon, 32, 33);

      const texture = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, sizeAttenuation: true });
      const sprite = new THREE.Sprite(mat);
      const worldPos = new THREE.Vector3(cx, cy + 1, cz);
      sprite.position.copy(worldPos);
      sprite.scale.set(4, 4, 1);
      poiGroup.add(sprite);

      allPOIs.push({
        sprite,
        floorKey: info.key,
        worldPos,
        label: `ドア (${info.key}F)`,
        surfaceType: "door",
      });
    }
    const floorGroup = floorGroups.get(info.key);
    if (floorGroup) floorGroup.add(poiGroup);
  }

  // テナント情報読み込み & モダン表示
  let renderedTenants: RenderedTenant[] = [];
  try {
    const tenantRes = await fetch("./data/shibuya_tenants.json");
    if (tenantRes.ok) {
      const tenantData = await tenantRes.json();
      const stores: TenantStore[] = tenantData.stores || [];

      const tenantFloorEntries = floorEntries.map(e => ({
        key: e.info.key,
        surfaces: e.data.surfaces,
        y: e.data.y,
      }));

      // 渋谷駅エリア→空間ゾーンマッピング
      const SHIBUYA_AREA_ZONES: Record<string, import("./scene/tenant-renderer").AreaZone> = {
        "東急フードショー":         { xMin: -130, xMax: -30, zMin: -110, zMax: 20 },
        "渋谷マークシティ":         { xMin: -130, xMax: -20, zMin: -110, zMax: 20 },
        "渋谷ちかみち":             { xMin: -30,  xMax: 60,  zMin: -110, zMax: 20 },
        "JR渋谷駅改札内":           { xMin: -20,  xMax: 80,  zMin: -110, zMax: 20 },
        "渋谷スクランブルスクエア":  { xMin: 40,   xMax: 160, zMin: -110, zMax: 20 },
        "渋谷ヒカリエ ShinQs":      { xMin: 80,   xMax: 160, zMin: -110, zMax: 160 },
        "東京メトロ渋谷駅":         { xMin: -50,  xMax: 80,  zMin: -110, zMax: 160 },
        "東急東横線渋谷駅":         { xMin: -80,  xMax: 180, zMin: -140, zMax: 130 },
        "東急田園都市線渋谷駅":     { xMin: -190, xMax: 150, zMin: -110, zMax: 160 },
      };

      renderedTenants = renderTenants(stores, tenantFloorEntries, floorGroups, {
        hashFn: hashCode,
        areaZones: SHIBUYA_AREA_ZONES,
      });

      for (const rt of renderedTenants) {
        allPOIs.push({
          sprite: rt.sprite,
          floorKey: rt.floorKey,
          worldPos: rt.worldPos,
          label: `${rt.store.area} - ${rt.store.name}`,
          surfaceType: "tenant",
        });
      }
    }
  } catch { /* テナントデータがなくても動作する */ }

  // 周辺建物・道路を描画
  renderBuildings(scene, requestRender).catch(() => {});

  // 視点切替ボタン（経路探索不要で常時表示）
  let isWalkMode = false;
  const viewBtn = document.createElement("button");
  viewBtn.id = "view-mode-btn";
  viewBtn.textContent = "👁 目線モード";
  viewBtn.title = "一人称視点に切り替え";
  document.getElementById("ui")!.appendChild(viewBtn);
  viewBtn.addEventListener("click", () => {
    if (isWalkMode) {
      moveCameraToBirdEye(camera, controls, requestRender);
      setTenantFirstPersonMode(renderedTenants, camera, false, requestRender);
      viewBtn.textContent = "👁 目線モード";
      isWalkMode = false;
    } else {
      moveCameraToWalkView(camera, controls, requestRender);
      setTenantFirstPersonMode(renderedTenants, camera, true, requestRender);
      viewBtn.textContent = "🦅 鳥瞰モード";
      isWalkMode = true;
    }
  });

  // 検索インデックス構築
  interface SearchItem {
    label: string;
    floorKey: string;
    poi: ShibuyaPOI;
  }
  const searchItems: SearchItem[] = allPOIs.map(p => ({
    label: p.label,
    floorKey: p.floorKey,
    poi: p,
  }));
  const fuse = new Fuse(searchItems, {
    keys: [{ name: "label", weight: 0.7 }, { name: "floorKey", weight: 0.3 }],
    threshold: 0.4,
    includeScore: true,
  });

  // 検索UIセットアップ
  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  const searchClear = document.getElementById("search-clear") as HTMLButtonElement;
  const searchResults = document.getElementById("search-results") as HTMLElement;

  if (searchInput) {
    searchInput.style.pointerEvents = "auto";
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim();
      searchClear.style.display = q ? "block" : "none";
      if (!q) { searchResults.innerHTML = ""; return; }
      const results = fuse.search(q, { limit: 10 });
      searchResults.innerHTML = "";
      for (const r of results) {
        const div = document.createElement("div");
        div.className = "search-result-item";
        div.textContent = `${r.item.label} (${r.item.floorKey}F)`;
        div.addEventListener("click", () => {
          const poi = r.item.poi;
          // フロア表示切り替え
          const active = new Set([poi.floorKey]);
          onFloorChange(active);
          document.querySelectorAll<HTMLButtonElement>(".floor-btn[data-floor-key]").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.floorKey === poi.floorKey);
          });
          document.querySelectorAll<HTMLButtonElement>(".floor-btn:not([data-floor-key])").forEach(btn => {
            btn.classList.remove("active");
          });
          // カメラ移動
          animateCameraTo(camera, controls, poi.worldPos, requestRender);
          searchResults.innerHTML = "";
          searchInput.value = r.item.label;
        });
        searchResults.appendChild(div);
      }
    });
    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      searchResults.innerHTML = "";
      searchClear.style.display = "none";
    });
  }

  // グローバル検索インデックスに登録（route-panelが使うsearch()に反映）
  const virtualPOIs: POIEntry[] = allPOIs.map(p => {
    const parts = p.label.split(" - ");
    const isTenant = parts.length >= 2;
    return {
      sprite: p.sprite,
      facility: {
        geometry: { type: "Point" as const, coordinates: [p.worldPos.x, -p.worldPos.z] },
        category: p.surfaceType === "tenant" ? "TENANT" : "DOOR",
        area: isTenant ? parts[0] : p.floorKey,
        name: isTenant ? parts[1] : p.label,
      },
      floorKey: p.floorKey,
      worldPos: p.worldPos,
      label: p.label,
      categoryLabel: p.surfaceType,
    };
  });
  buildSearchIndex(virtualPOIs);

  // ネットワーク読み込み + 経路検索UI
  try {
    await loadNetwork("./data/shibuya/network.json");
  } catch {
    console.warn("渋谷ネットワークデータが見つかりません（経路検索は無効）");
  }

  let navBar: NavBarController | null = null;

  const routeUI = setupRoutePanel(
    (req) => {
      try {
      const startNode = findNearestNode(
        req.start.worldPos.x, req.start.worldPos.y, req.start.worldPos.z,
      );
      const endNode = findNearestNode(
        req.end.worldPos.x, req.end.worldPos.y, req.end.worldPos.z,
      );
      if (!startNode || !endNode) { routeUI.showError(); return; }
      const result = findRoute(startNode.id, endNode.id, { avoidStairs: req.barrierFree });
      if (!result) { routeUI.showError(); return; }
      const routeFloors = [...new Set(result.path.map(n => n.floor))];
      const routeActive = new Set(routeFloors);
      onFloorChange(routeActive);
      document.querySelectorAll<HTMLButtonElement>(".floor-btn[data-floor-key]").forEach(btn => {
        btn.classList.toggle("active", routeActive.has(btn.dataset.floorKey!));
      });
      document.querySelectorAll<HTMLButtonElement>(".floor-btn:not([data-floor-key])").forEach(btn => {
        btn.classList.remove("active");
      });
      renderRoute(scene, result, requestRender, false);
      const steps = buildRouteSteps(result);
      routeUI.showResult(result.totalDistance, routeFloors, steps);
      // ナビバー作成
      if (navBar) navBar.destroy();
      navBar = createNavBar(steps, result.path, renderedTenants, (stepIdx, startNode, nextNode) => {
        moveCameraToFirstPerson(startNode, nextNode, camera, controls, requestRender, false);
      });
      // 一人称視点
      const startPath = result.path[0];
      const nextPath = result.path[Math.min(3, result.path.length - 1)];
      let isFirstPerson = true;
      moveCameraToFirstPerson(startPath, nextPath, camera, controls, requestRender, false);
      setTenantFirstPersonMode(renderedTenants, camera, true, requestRender);
      if (navBar) navBar.show();
      const toggleBtn = getViewToggleButton();
      if (toggleBtn) {
        toggleBtn.textContent = "🦅 鳥瞰";
        toggleBtn.onclick = () => {
          if (isFirstPerson) {
            moveCameraToBirdEye(camera, controls, requestRender);
            setTenantFirstPersonMode(renderedTenants, camera, false, requestRender);
            if (navBar) navBar.hide();
            toggleBtn.textContent = "👁 目線";
            isFirstPerson = false;
          } else {
            moveCameraToFirstPerson(startPath, nextPath, camera, controls, requestRender, false);
            setTenantFirstPersonMode(renderedTenants, camera, true, requestRender);
            if (navBar) navBar.show();
            toggleBtn.textContent = "🦅 鳥瞰";
            isFirstPerson = true;
          }
        };
      }
      } catch (e) {
        console.error("経路検索エラー:", e);
        routeUI.showError();
      }
    },
    () => {
      clearRoute(scene);
      setTenantFirstPersonMode(renderedTenants, camera, false, requestRender);
      if (navBar) { navBar.destroy(); navBar = null; }
      requestRender();
    },
  );

  // 現在地特定パネル
  let locateMarker: THREE.Mesh | null = null;
  setupLocatePanel(virtualPOIs, (result) => {
    const active = new Set([result.floorKey]);
    onFloorChange(active);
    document.querySelectorAll<HTMLButtonElement>(".floor-btn[data-floor-key]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.floorKey === result.floorKey);
    });
    document.querySelectorAll<HTMLButtonElement>(".floor-btn:not([data-floor-key])").forEach(btn => {
      btn.classList.remove("active");
    });
    if (locateMarker) {
      scene.remove(locateMarker);
      locateMarker.geometry.dispose();
      (locateMarker.material as THREE.Material).dispose();
      locateMarker = null;
    }
    const markerGeom = new THREE.CylinderGeometry(2.5, 2.5, 0.5, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.7 });
    locateMarker = new THREE.Mesh(markerGeom, markerMat);
    locateMarker.position.copy(result.position);
    locateMarker.position.y += 0.5;
    scene.add(locateMarker);
    animateCameraTo(camera, controls, result.position, requestRender);
  });

  requestRender();

  // フロア切替UI
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

  // ツールチップ（シンプル版）
  const tooltip = document.getElementById("tooltip")!;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const typeNames: Record<string, string> = {
    wall: "壁",
    floor: "床",
    ceiling: "天井",
    closure: "閉鎖面",
    door: "ドア",
    window: "窓",
    installation: "設備",
  };

  function handlePointerHit(clientX: number, clientY: number) {
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const meshes: THREE.Mesh[] = [];
    for (const [, group] of floorGroups) {
      if (!group.visible) continue;
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
    }

    const intersects = raycaster.intersectObjects(meshes);
    if (intersects.length > 0) {
      const obj = intersects[0].object;
      if (obj.userData.layer === "tenant-overlay" && obj.userData.tenantName) {
        const area = obj.userData.tenantArea ? `${obj.userData.tenantArea} - ` : "";
        tooltip.textContent = `${area}${obj.userData.tenantName}`;
      } else {
        const layer = obj.userData.layer;
        tooltip.textContent = typeNames[layer] || layer;
      }
      tooltip.style.display = "block";
      tooltip.style.left = clientX + 15 + "px";
      tooltip.style.top = clientY - 10 + "px";
      return;
    }
    tooltip.style.display = "none";
  }

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    handlePointerHit(e.clientX, e.clientY);
  });

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
        }
      }
    }, { passive: true });
  }
}

main();
