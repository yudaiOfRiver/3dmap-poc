import * as THREE from "three";
import { setupScene } from "./scene/setup";
import { buildFloor, type BuiltFloor } from "./scene/floor-builder";
import { buildPOILayer, type POIEntry } from "./scene/poi-layer";
import { loadFloorIndex, loadFloorData } from "./data/loader";
import { setupFloorSelector } from "./ui/floor-selector";
import { setupSearchPanel } from "./ui/search-panel";
import { showDetail } from "./ui/info-panel";
import { buildSearchIndex } from "./data/search";
import { animateCameraTo, moveCameraToFirstPerson, moveCameraToBirdEye } from "./utils/camera-animation";
import { loadNetwork, findNearestNode, findRoute, buildRouteSteps } from "./data/network";
import { setupRoutePanel } from "./ui/route-panel";
import { renderRoute, clearRoute, getViewToggleButton } from "./scene/route-renderer";
import { setupLocatePanel } from "./ui/locate-panel";
import { loadAndPlaceTenants, createTenantSprite } from "./data/tenant-loader";
import type { FloorData } from "./data/loader";
import "./style.css";

// Spaceカテゴリコードの日本語名
const CATEGORY_NAMES: Record<string, string> = {
  B001: "商業施設",
  B002: "事務所",
  B003: "公的施設",
  B004: "待合室",
  B005: "きっぷ売り場",
  B006: "案内所",
  B007: "トイレ(男性)",
  B008: "トイレ(女性)",
  B009: "トイレ(共用)",
  B010: "トイレ",
  B011: "多機能トイレ",
  B018: "駅事務室",
  B019: "部屋",
  B021: "階段",
  B022: "エレベーター",
  B023: "エスカレーター",
  B025: "スロープ",
  B028: "ホーム",
  B029: "通路",
  B030: "デッキ",
};

const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

async function main() {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const { scene, camera, controls, requestRender } = setupScene(canvas);

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
  const floors = await loadFloorIndex();

  // 全フロアデータを並列ロード + ビルド
  const floorEntries = await Promise.all(
    floors.map(async (info) => {
      const data = await loadFloorData(info.key);
      const built = buildFloor(data);
      const pois = buildPOILayer(data.facilities, info.key, data.y);
      return { info, data, built, pois };
    }),
  );

  // シーンに追加
  const floorGroups = new Map<string, BuiltFloor>();
  const allClickables: THREE.Mesh[] = [];
  const allPOIs: POIEntry[] = [];
  const poiGroupsByFloor = new Map<string, THREE.Group>();

  for (const { info, built, pois } of floorEntries) {
    scene.add(built.group);
    floorGroups.set(info.key, built);
    allClickables.push(...built.clickables);

    // POIスプライトをフロアグループに追加
    const poiGroup = new THREE.Group();
    poiGroup.userData.floorKey = info.key;
    for (const entry of pois) {
      poiGroup.add(entry.sprite);
    }
    built.group.add(poiGroup);
    poiGroupsByFloor.set(info.key, poiGroup);
    allPOIs.push(...pois);
  }

  // テナント情報をオーバーレイ
  const floorDataMap = new Map<string, FloorData>();
  for (const { info, data } of floorEntries) {
    floorDataMap.set(info.key, data);
  }
  const placedTenants = await loadAndPlaceTenants(floorDataMap);
  for (const tenant of placedTenants) {
    const sprite = createTenantSprite(tenant);
    const built = floorGroups.get(tenant.floorKey);
    if (built) {
      built.group.add(sprite);
    }
  }

  // 検索インデックス構築（テナント情報も統合）
  buildSearchIndex(allPOIs, placedTenants);

  requestRender();

  // フロア切替UI
  let currentActiveFloors: Set<string>;
  setupFloorSelector(floors, onFloorChange);
  currentActiveFloors = new Set(floors.map((f) => f.key));

  function onFloorChange(active: Set<string>) {
    currentActiveFloors = active;
    const isAll = active.size === floors.length;
    for (const [key, built] of floorGroups) {
      const visible = active.has(key);
      built.group.visible = visible;

      built.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
          if (child.userData.layer === "floor") {
            child.material.opacity = isAll ? 0.4 : visible ? 0.5 : 0.1;
          } else if (child.userData.layer === "space") {
            child.material.opacity = isAll ? 0.75 : visible ? 0.85 : 0.1;
          }
        }
      });
    }

    if (active.size === 1) {
      const key = [...active][0];
      const info = floors.find((f) => f.key === key);
      if (info) controls.target.set(0, info.y, 0);
    } else {
      controls.target.set(0, 0, 0);
    }
    requestRender();
  }

  // 検索UI
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

  // ネットワークデータ読み込み + 経路検索UI
  await loadNetwork();

  const routeUI = setupRoutePanel(
    (req) => {
      // 出発・到着のPOI座標から最近傍ノードを探索
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

      // B5: 経路が通るフロアのみ表示
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

      // B2: フロア別ステップ生成
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

  // 現在地特定パネル
  let locateMarker: THREE.Mesh | null = null;
  setupLocatePanel(allPOIs, (result) => {
    // 該当フロアを表示
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
  }, placedTenants);

  // ツールチップ
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tooltip = document.getElementById("tooltip")!;

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

    // Space hitbox
    const hitboxes = allClickables.filter(
      (m) => m.userData.layer === "space-hitbox" && m.parent?.visible,
    );
    const intersects = raycaster.intersectObjects(hitboxes);
    if (intersects.length > 0) {
      const ud = intersects[0].object.userData;
      const catName = CATEGORY_NAMES[ud.category] || ud.group || "";
      const name = ud.name || catName;
      const label = name ? `${ud.area} - ${name}` : ud.area;
      showTooltip(label, clientX, clientY);
      return;
    }

    tooltip.style.display = "none";
  }

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
