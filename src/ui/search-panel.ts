import { search, type SearchableItem } from "../data/search";

export type SearchSelectCallback = (item: SearchableItem) => void;

/**
 * 検索UIを構築
 */
export function setupSearchPanel(onSelect: SearchSelectCallback) {
  const container = document.getElementById("search-container")!;
  const input = container.querySelector<HTMLInputElement>("#search-input")!;
  const results = container.querySelector<HTMLDivElement>("#search-results")!;
  const clearBtn = container.querySelector<HTMLButtonElement>("#search-clear")!;

  let debounceTimer: ReturnType<typeof setTimeout>;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value;
    clearBtn.style.display = q ? "block" : "none";

    debounceTimer = setTimeout(() => {
      if (!q.trim()) {
        results.innerHTML = "";
        results.style.display = "none";
        return;
      }
      const hits = search(q);
      renderResults(hits);
    }, 150);
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.style.display = "none";
    results.innerHTML = "";
    results.style.display = "none";
    input.focus();
  });

  // 外側クリックで閉じる
  document.addEventListener("pointerdown", (e) => {
    if (!container.contains(e.target as Node)) {
      results.style.display = "none";
    }
  });

  // inputフォーカスで再表示
  input.addEventListener("focus", () => {
    if (results.children.length > 0) {
      results.style.display = "block";
    }
  });

  function renderResults(items: SearchableItem[]) {
    results.innerHTML = "";
    if (items.length === 0) {
      results.innerHTML = '<div class="search-result-item no-result">該当なし</div>';
      results.style.display = "block";
      return;
    }

    for (const item of items) {
      const div = document.createElement("div");
      div.className = "search-result-item";

      const badge = document.createElement("span");
      badge.className = "search-badge";
      badge.textContent = item.poiEntry.floorKey.replace("B", "B") + "F";

      const text = document.createElement("span");
      text.className = "search-text";
      text.textContent = item.label;

      div.appendChild(badge);
      div.appendChild(text);

      div.addEventListener("click", () => {
        onSelect(item);
        results.style.display = "none";
        input.value = item.label;
        input.blur();
      });

      results.appendChild(div);
    }
    results.style.display = "block";
  }
}
