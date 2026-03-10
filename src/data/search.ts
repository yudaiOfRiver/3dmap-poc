import Fuse from "fuse.js";
import type * as THREE from "three";
import type { POIEntry } from "../scene/poi-layer";
import type { PlacedTenant } from "./tenant-loader";

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
 * 検索インデックスを構築（テナント情報も統合）
 */
export function buildSearchIndex(poiEntries: POIEntry[], tenants?: PlacedTenant[]) {
  items = poiEntries.map((entry, i) => ({
    id: i,
    label: entry.label,
    categoryLabel: entry.categoryLabel,
    area: entry.facility.area,
    floorKey: entry.floorKey,
    poiEntry: entry,
  }));

  // テナントを仮想POIEntryとして追加
  if (tenants) {
    for (const tenant of tenants) {
      const virtualPOI: POIEntry = {
        sprite: null as unknown as THREE.Sprite,
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
      items.push({
        id: items.length,
        label: virtualPOI.label,
        categoryLabel: tenant.store.name,
        area: tenant.store.area,
        floorKey: tenant.floorKey,
        poiEntry: virtualPOI,
      });
    }
  }

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
