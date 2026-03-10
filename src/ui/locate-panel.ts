import type { POIEntry } from "../scene/poi-layer";
import type { PlacedTenant } from "../data/tenant-loader";
import * as THREE from "three";

export interface LocateResult {
  area: string;
  floorKey: string;
  position: THREE.Vector3;
  matchedPOIs: POIEntry[];
  score: number;
}

export type LocateCallback = (result: LocateResult) => void;

export function setupLocatePanel(
  allPOIs: POIEntry[],
  onLocate: LocateCallback,
  tenants?: PlacedTenant[],
): {
  clearMarker: () => void;
} {
  const ui = document.getElementById("ui")!;

  // パネル要素を動的生成
  const panel = document.createElement("div");
  panel.id = "locate-panel";
  panel.innerHTML = `
    <div class="locate-header" id="locate-toggle">
      <span>\u{1F4CD} 現在地を特定</span>
      <span class="locate-arrow">\u25B6</span>
    </div>
    <div class="locate-body" style="display:none">
      <input type="text" id="locate-input" placeholder="周りに何が見えますか？（例: JR改札 エスカレーター）" autocomplete="off">
      <button id="locate-search">探す</button>
      <div id="locate-results"></div>
    </div>
  `;
  panel.style.pointerEvents = "auto";
  ui.appendChild(panel);

  // ヘッダークリックで開閉
  const toggle = panel.querySelector("#locate-toggle")!;
  const body = panel.querySelector(".locate-body") as HTMLElement;
  const arrow = panel.querySelector(".locate-arrow")!;
  toggle.addEventListener("click", () => {
    const open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
    arrow.textContent = open ? "\u25B6" : "\u25BC";
  });

  /**
   * キーワード検索で位置候補を返す
   */
  function searchLocation(query: string): LocateResult[] {
    // キーワード分割（スペース、句読点、助詞を区切り）
    const keywords = query
      .split(/[\s,、。．・　]+/)
      .map((k) => k.replace(/[のでがにをはと]$/g, "").trim())
      .filter((k) => k.length > 0);

    if (keywords.length === 0) return [];

    // 各POIに対してマッチするキーワードを検出
    const poiMatches: { poi: POIEntry; matchedKeywords: Set<string> }[] = [];

    for (const poi of allPOIs) {
      const searchTarget =
        `${poi.label} ${poi.categoryLabel} ${poi.facility.area}`.toLowerCase();
      const matched = new Set<string>();
      for (const kw of keywords) {
        if (searchTarget.includes(kw.toLowerCase())) {
          matched.add(kw);
        }
      }
      if (matched.size > 0) {
        poiMatches.push({ poi, matchedKeywords: matched });
      }
    }

    // テナント情報もマッチング
    if (tenants) {
      for (const tenant of tenants) {
        const searchTarget =
          `${tenant.store.name} ${tenant.store.area} ${tenant.store.type}`.toLowerCase();
        const matched = new Set<string>();
        for (const kw of keywords) {
          if (searchTarget.includes(kw.toLowerCase())) {
            matched.add(kw);
          }
        }
        if (matched.size > 0) {
          // テナントを仮想POIとして追加
          const virtualPOI: POIEntry = {
            sprite: null as unknown as import("three").Sprite,
            facility: {
              geometry: { type: "Point", coordinates: [tenant.position.x, -tenant.position.z] },
              category: "TENANT",
              area: tenant.store.area,
              name: tenant.store.name,
            },
            floorKey: tenant.floorKey,
            worldPos: tenant.position,
            label: `${tenant.store.area} - ${tenant.store.name}`,
            categoryLabel: tenant.store.type,
          };
          poiMatches.push({ poi: virtualPOI, matchedKeywords: matched });
        }
      }
    }

    // (area, floorKey) でグループ化
    const groups = new Map<
      string,
      { pois: POIEntry[]; keywords: Set<string> }
    >();
    for (const { poi, matchedKeywords } of poiMatches) {
      const key = `${poi.facility.area}__${poi.floorKey}`;
      if (!groups.has(key)) {
        groups.set(key, { pois: [], keywords: new Set() });
      }
      const g = groups.get(key)!;
      g.pois.push(poi);
      for (const kw of matchedKeywords) g.keywords.add(kw);
    }

    // スコア計算 & 結果生成
    const results: LocateResult[] = [];
    for (const [, group] of groups) {
      // 重心計算
      const center = new THREE.Vector3();
      for (const poi of group.pois) {
        center.add(poi.worldPos);
      }
      center.divideScalar(group.pois.length);

      results.push({
        area: group.pois[0].facility.area,
        floorKey: group.pois[0].floorKey,
        position: center,
        matchedPOIs: group.pois,
        score: group.keywords.size,
      });
    }

    // スコア降順、同スコアならPOI数多い順
    results.sort(
      (a, b) =>
        b.score - a.score || b.matchedPOIs.length - a.matchedPOIs.length,
    );

    return results.slice(0, 5);
  }

  /**
   * 候補を表示する
   */
  function showResults(results: LocateResult[]): void {
    const resultsDiv = panel.querySelector("#locate-results") as HTMLElement;
    if (results.length === 0) {
      resultsDiv.innerHTML =
        '<div class="locate-no-result">該当する場所が見つかりません</div>';
      return;
    }

    resultsDiv.innerHTML = "";
    for (const result of results) {
      const div = document.createElement("div");
      div.className = "locate-candidate";

      // マッチしたPOIのカテゴリをユニークに列挙（最大4つ）
      const matchedLabels = [
        ...new Set(result.matchedPOIs.map((p) => p.categoryLabel)),
      ].slice(0, 4);

      div.innerHTML = `
        <div class="locate-candidate-header">
          <span class="locate-area">${result.area}</span>
          <span class="locate-floor">${result.floorKey}F</span>
          <span class="locate-score">一致: ${result.score}件</span>
        </div>
        <div class="locate-candidate-pois">${matchedLabels.join(" / ")}</div>
      `;
      div.addEventListener("click", () => {
        onLocate(result);
        // 選択状態のハイライト
        resultsDiv
          .querySelectorAll(".locate-candidate")
          .forEach((el) => el.classList.remove("selected"));
        div.classList.add("selected");
      });
      resultsDiv.appendChild(div);
    }
  }

  // 検索ボタン & Enterキー
  const input = panel.querySelector("#locate-input") as HTMLInputElement;
  const searchBtn = panel.querySelector("#locate-search") as HTMLButtonElement;

  function doSearch(): void {
    const q = input.value.trim();
    if (!q) return;
    const results = searchLocation(q);
    showResults(results);
  }

  searchBtn.addEventListener("click", doSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });

  return {
    clearMarker() {
      // main.ts側でマーカー削除を管理
    },
  };
}
