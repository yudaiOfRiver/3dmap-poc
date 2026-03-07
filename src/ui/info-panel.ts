import type { POIEntry } from "../scene/poi-layer";

const FLOOR_LABELS: Record<string, string> = {
  B3: "地下3階",
  B2: "地下2階",
  B1: "地下1階",
  "0": "地上階",
  "1": "1階",
  "2": "2階",
  "3": "3階",
  "4": "4階",
};

/**
 * 施設詳細パネルを表示
 */
export function showDetail(entry: POIEntry) {
  const panel = document.getElementById("detail-panel")!;
  const floorLabel = FLOOR_LABELS[entry.floorKey] || entry.floorKey;

  panel.innerHTML = `
    <div class="detail-header">
      <span class="detail-title">${entry.label}</span>
      <button class="detail-close" id="detail-close-btn">&times;</button>
    </div>
    <div class="detail-body">
      <div class="detail-row"><span class="detail-key">種別</span><span>${entry.categoryLabel}</span></div>
      <div class="detail-row"><span class="detail-key">階層</span><span>${floorLabel}</span></div>
      <div class="detail-row"><span class="detail-key">エリア</span><span>${entry.facility.area}</span></div>
    </div>
  `;
  panel.style.display = "block";

  document.getElementById("detail-close-btn")!.addEventListener("click", () => {
    panel.style.display = "none";
  });
}

export function hideDetail() {
  document.getElementById("detail-panel")!.style.display = "none";
}
