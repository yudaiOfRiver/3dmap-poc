import * as THREE from "three";
import type { NetNode, RouteStep } from "../data/network";
import type { RenderedTenant } from "../scene/tenant-renderer";

export interface NavBarController {
  show(): void;
  hide(): void;
  destroy(): void;
  goToStep(index: number): void;
}

interface NearbyTenant {
  name: string;
  icon: string;
  side: "left" | "right";
  dist: number;
}

const STEP_ICONS: Record<string, string> = {
  walk: "🚶",
  stairs: "🪜",
  escalator: "⬆️",
  elevator: "🛗",
};

const STEP_LABELS: Record<string, string> = {
  walk: "通路を直進",
  stairs: "階段",
  escalator: "エスカレーター",
  elevator: "エレベーター",
};

/**
 * 経路ナビバーを生成
 */
export function createNavBar(
  steps: RouteStep[],
  path: NetNode[],
  tenants: RenderedTenant[],
  onStepChange: (stepIdx: number, startNode: NetNode, nextNode: NetNode) => void,
): NavBarController {
  let currentStep = 0;

  // ステップごとの近傍テナントを事前計算
  const stepTenants = steps.map((step) => findNearbyTenants(step, path, tenants));

  // DOM構築
  const bar = document.createElement("div");
  bar.id = "nav-bar";
  bar.innerHTML = `
    <div class="nav-bar-main">
      <button class="nav-btn nav-prev" title="前のステップ">◀</button>
      <div class="nav-content">
        <div class="nav-instruction"></div>
        <div class="nav-landmarks"></div>
      </div>
      <button class="nav-btn nav-next" title="次のステップ">▶</button>
    </div>
    <div class="nav-progress">
      <div class="nav-progress-bar"></div>
    </div>
  `;
  bar.style.display = "none";
  document.getElementById("ui")!.appendChild(bar);

  const prevBtn = bar.querySelector(".nav-prev") as HTMLButtonElement;
  const nextBtn = bar.querySelector(".nav-next") as HTMLButtonElement;
  const instruction = bar.querySelector(".nav-instruction") as HTMLElement;
  const landmarks = bar.querySelector(".nav-landmarks") as HTMLElement;
  const progressBar = bar.querySelector(".nav-progress-bar") as HTMLElement;

  function render() {
    const step = steps[currentStep];
    const icon = STEP_ICONS[step.type] || "🚶";
    const label = STEP_LABELS[step.type] || "移動";

    // メイン案内文
    if (step.type === "walk") {
      instruction.textContent = `${icon} ${step.floor}F ${label} ${step.distance}m`;
    } else {
      // 次のステップのフロアを見て「B2Fへ」等を追加
      const nextStep = steps[currentStep + 1];
      const toFloor = nextStep ? nextStep.floor : step.floor;
      instruction.textContent = `${icon} ${label}で${toFloor}Fへ`;
    }

    // 近傍テナント表示
    const nearby = stepTenants[currentStep];
    if (nearby.length > 0) {
      const parts: string[] = [];
      const leftTenants = nearby.filter(t => t.side === "left").slice(0, 2);
      const rightTenants = nearby.filter(t => t.side === "right").slice(0, 2);
      if (leftTenants.length > 0) {
        parts.push(`左: ${leftTenants.map(t => `${t.icon}${t.name}`).join(" ")}`);
      }
      if (rightTenants.length > 0) {
        parts.push(`右: ${rightTenants.map(t => `${t.icon}${t.name}`).join(" ")}`);
      }
      landmarks.textContent = parts.join("  ");
      landmarks.style.display = "block";
    } else {
      landmarks.style.display = "none";
    }

    // ボタン状態
    prevBtn.disabled = currentStep === 0;
    nextBtn.disabled = currentStep === steps.length - 1;

    // プログレスバー
    progressBar.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
  }

  function goToStep(idx: number) {
    if (idx < 0 || idx >= steps.length) return;
    currentStep = idx;
    render();

    // カメラ移動のためのノードを取得
    const step = steps[currentStep];
    const startNode = path[step.pathStartIdx];
    const nextIdx = Math.min(step.pathStartIdx + 3, step.pathEndIdx);
    const nextNode = path[nextIdx];
    onStepChange(currentStep, startNode, nextNode);
  }

  prevBtn.addEventListener("click", () => goToStep(currentStep - 1));
  nextBtn.addEventListener("click", () => goToStep(currentStep + 1));

  // キーボードショートカット
  function handleKey(e: KeyboardEvent) {
    if (bar.style.display === "none") return;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      goToStep(currentStep - 1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      goToStep(currentStep + 1);
    }
  }
  document.addEventListener("keydown", handleKey);

  // 初期描画
  render();

  return {
    show() {
      bar.style.display = "block";
      currentStep = 0;
      render();
    },
    hide() {
      bar.style.display = "none";
    },
    destroy() {
      document.removeEventListener("keydown", handleKey);
      bar.remove();
    },
    goToStep,
  };
}

/**
 * ステップ付近のテナントを検出し、左右を判定
 */
function findNearbyTenants(
  step: RouteStep,
  path: NetNode[],
  tenants: RenderedTenant[],
): NearbyTenant[] {
  if (step.type !== "walk" || tenants.length === 0) return [];

  // ステップの中間地点を取得
  const midIdx = Math.floor((step.pathStartIdx + step.pathEndIdx) / 2);
  const midNode = path[midIdx];
  const midPos = new THREE.Vector3(midNode.x, midNode.y, -midNode.z);

  // 進行方向ベクトル（XZ平面）
  const startNode = path[step.pathStartIdx];
  const endNode = path[step.pathEndIdx];
  const travelDir = new THREE.Vector3(
    endNode.x - startNode.x,
    0,
    -(endNode.z - startNode.z),
  ).normalize();

  const maxDist = 15; // 15m以内
  const result: NearbyTenant[] = [];

  for (const rt of tenants) {
    if (rt.floorKey !== step.floor) continue;

    const tenantPos = rt.worldPos;
    const dist = midPos.distanceTo(new THREE.Vector3(tenantPos.x, midPos.y, tenantPos.z));
    if (dist > maxDist) continue;

    // 左右判定: 進行方向との外積のY成分
    const toTenant = new THREE.Vector3(
      tenantPos.x - midPos.x,
      0,
      tenantPos.z - midPos.z,
    ).normalize();
    const cross = travelDir.x * toTenant.z - travelDir.z * toTenant.x;
    const side: "left" | "right" = cross > 0 ? "left" : "right";

    // 店名を短縮
    const shortName = rt.store.name.length > 8 ? rt.store.name.slice(0, 8) + "…" : rt.store.name;

    result.push({
      name: shortName,
      icon: rt.store.icon,
      side,
      dist,
    });
  }

  // 距離順にソート
  result.sort((a, b) => a.dist - b.dist);
  return result.slice(0, 4); // 最大4店舗
}
