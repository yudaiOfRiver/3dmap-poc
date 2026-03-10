import type { POIEntry } from "../scene/poi-layer";
import { search, type SearchableItem } from "../data/search";
import type { RouteStep } from "../data/network";

export interface RouteRequest {
  start: POIEntry;
  end: POIEntry;
  barrierFree: boolean;
}

export type RouteRequestCallback = (req: RouteRequest) => void;
export type RouteClearCallback = () => void;

/**
 * 経路検索UIを構築
 */
export function setupRoutePanel(
  onRoute: RouteRequestCallback,
  onClear: RouteClearCallback,
) {
  const panel = document.getElementById("route-panel")!;
  const startInput = panel.querySelector<HTMLInputElement>("#route-start")!;
  const endInput = panel.querySelector<HTMLInputElement>("#route-end")!;
  const startResults = panel.querySelector<HTMLDivElement>("#route-start-results")!;
  const endResults = panel.querySelector<HTMLDivElement>("#route-end-results")!;
  const goBtn = panel.querySelector<HTMLButtonElement>("#route-go")!;
  const clearBtn = panel.querySelector<HTMLButtonElement>("#route-clear")!;
  const resultInfo = panel.querySelector<HTMLDivElement>("#route-result")!;
  const barrierFreeCheck = panel.querySelector<HTMLInputElement>("#route-barrier-free");

  let selectedStart: POIEntry | null = null;
  let selectedEnd: POIEntry | null = null;

  function setupAutocomplete(
    input: HTMLInputElement,
    resultsDiv: HTMLDivElement,
    onSelect: (item: SearchableItem) => void,
  ) {
    let timer: ReturnType<typeof setTimeout>;

    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = input.value.trim();
        if (!q) {
          resultsDiv.innerHTML = "";
          resultsDiv.style.display = "none";
          return;
        }
        const hits = search(q, 8);
        if (hits.length === 0) {
          resultsDiv.innerHTML = '<div class="route-ac-item no-result">該当なし</div>';
          resultsDiv.style.display = "block";
          return;
        }
        resultsDiv.innerHTML = "";
        for (const item of hits) {
          const div = document.createElement("div");
          div.className = "route-ac-item";
          div.textContent = `[${item.floorKey}F] ${item.label}`;
          div.addEventListener("click", () => {
            onSelect(item);
            input.value = item.label;
            resultsDiv.style.display = "none";
          });
          resultsDiv.appendChild(div);
        }
        resultsDiv.style.display = "block";
      }, 150);
    });

    input.addEventListener("focus", () => {
      if (resultsDiv.children.length > 0) resultsDiv.style.display = "block";
    });
  }

  setupAutocomplete(startInput, startResults, (item) => {
    selectedStart = item.poiEntry;
    updateGoButton();
  });

  setupAutocomplete(endInput, endResults, (item) => {
    selectedEnd = item.poiEntry;
    updateGoButton();
  });

  // 外側クリックで候補閉じる
  document.addEventListener("pointerdown", (e) => {
    if (!panel.contains(e.target as Node)) {
      startResults.style.display = "none";
      endResults.style.display = "none";
    }
  });

  function updateGoButton() {
    goBtn.disabled = !selectedStart || !selectedEnd;
  }

  goBtn.addEventListener("click", () => {
    if (selectedStart && selectedEnd) {
      onRoute({
        start: selectedStart,
        end: selectedEnd,
        barrierFree: barrierFreeCheck?.checked ?? false,
      });
    }
  });

  clearBtn.addEventListener("click", () => {
    selectedStart = null;
    selectedEnd = null;
    startInput.value = "";
    endInput.value = "";
    resultInfo.style.display = "none";
    goBtn.disabled = true;
    onClear();
  });

  // B4: スワップボタン
  const swapBtn = panel.querySelector<HTMLButtonElement>("#route-swap");
  if (swapBtn) {
    swapBtn.addEventListener("click", () => {
      // 入力値の入替
      const tmpVal = startInput.value;
      startInput.value = endInput.value;
      endInput.value = tmpVal;

      // 選択状態の入替
      const tmpSelected = selectedStart;
      selectedStart = selectedEnd;
      selectedEnd = tmpSelected;

      updateGoButton();
    });
  }

  updateGoButton();

  function stepTypeLabel(type: RouteStep["type"]): string {
    switch (type) {
      case "stairs": return "階段";
      case "escalator": return "エスカレーター";
      case "elevator": return "エレベーター";
      default: return "通路";
    }
  }

  return {
    showResult(distance: number, floors: string[], steps?: RouteStep[]) {
      const minutes = Math.ceil(distance / 80); // 80m/min 歩行速度
      let html = `
        <span class="route-distance">${distance}m</span>
        <span class="route-time">約${minutes}分</span>
        <span class="route-floors">${floors.join(" → ")}</span>
      `;

      if (steps && steps.length > 0) {
        html += '<div class="route-steps">';
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          if (step.type === "walk") {
            html += `<div class="route-step"><span class="step-floor">${step.floor}F</span> 通路 ${step.distance}m</div>`;
          } else {
            html += `<div class="route-step-connector">↓ ${stepTypeLabel(step.type)}</div>`;
          }
        }
        html += '</div>';
      }

      resultInfo.innerHTML = html;
      resultInfo.style.display = "flex";
    },
    showError() {
      resultInfo.innerHTML = '<span class="route-error">経路が見つかりません</span>';
      resultInfo.style.display = "flex";
    },
  };
}
