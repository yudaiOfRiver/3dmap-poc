import Fuse from "fuse.js";
import type { POIEntry } from "../scene/poi-layer";

export interface SearchableItem {
  id: number;
  label: string;
  categoryLabel: string;
  area: string;
  floorKey: string;
  poiEntry: POIEntry;
}

let fuse: Fuse<SearchableItem> | null = null;
let items: SearchableItem[] = [];

/**
 * 検索インデックスを構築
 */
export function buildSearchIndex(poiEntries: POIEntry[]) {
  items = poiEntries.map((entry, i) => ({
    id: i,
    label: entry.label,
    categoryLabel: entry.categoryLabel,
    area: entry.facility.area,
    floorKey: entry.floorKey,
    poiEntry: entry,
  }));

  fuse = new Fuse(items, {
    keys: [
      { name: "label", weight: 0.5 },
      { name: "categoryLabel", weight: 0.3 },
      { name: "area", weight: 0.2 },
    ],
    threshold: 0.4,
    includeScore: true,
  });
}

/**
 * 検索実行
 */
export function search(query: string, limit = 20): SearchableItem[] {
  if (!fuse || !query.trim()) return [];
  return fuse.search(query, { limit }).map((r) => r.item);
}

/**
 * 全アイテムを返す（カテゴリフィルタ用）
 */
export function getAllItems(): SearchableItem[] {
  return items;
}
