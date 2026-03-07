import type { FloorInfo } from "../data/loader";

export type FloorChangeCallback = (activeFloors: Set<string>) => void;

/**
 * フロア切替UIを構築
 */
export function setupFloorSelector(
  floors: FloorInfo[],
  onChange: FloorChangeCallback,
): { activeFloors: Set<string> } {
  const panel = document.getElementById("floor-panel")!;
  const activeFloors = new Set(floors.map((f) => f.key));

  // 「全階」ボタン
  const allBtn = document.createElement("button");
  allBtn.className = "floor-btn active";
  allBtn.textContent = "全階";
  allBtn.addEventListener("click", () => {
    floors.forEach((f) => activeFloors.add(f.key));
    updateButtons();
    onChange(activeFloors);
  });
  panel.appendChild(allBtn);

  // 各フロアボタン（上→下の順）
  const sorted = [...floors].sort((a, b) => b.ordinal - a.ordinal);
  for (const floor of sorted) {
    const btn = document.createElement("button");
    btn.className = "floor-btn active";
    btn.textContent = floor.label;
    btn.dataset.floorKey = floor.key;
    btn.addEventListener("click", () => {
      if (activeFloors.size === 1 && activeFloors.has(floor.key)) {
        // 同じフロアを再クリック → 全表示
        floors.forEach((f) => activeFloors.add(f.key));
      } else {
        // そのフロアだけ表示
        activeFloors.clear();
        activeFloors.add(floor.key);
      }
      updateButtons();
      onChange(activeFloors);
    });
    panel.appendChild(btn);
  }

  function updateButtons() {
    const isAll = activeFloors.size === floors.length;
    allBtn.classList.toggle("active", isAll);
    document.querySelectorAll<HTMLButtonElement>(".floor-btn[data-floor-key]").forEach((btn) => {
      btn.classList.toggle("active", activeFloors.has(btn.dataset.floorKey!));
    });
  }

  return { activeFloors };
}
