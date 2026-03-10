import * as THREE from "three";
import type { FloorData, SpaceFeature } from "./loader";

export interface TenantStore {
  name: string;
  area: string;
  floorKey: string;
  type: string;
  icon: string;
}

export interface PlacedTenant {
  store: TenantStore;
  floorKey: string;
  position: THREE.Vector3;
}

// tenants.json のエリア名 → フロアデータのエリア名
const AREA_MAP: Record<string, string> = {
  サブナード: "サブナード",
  京王モール: "京王モール",
  京王モールアネックス: "京王",
  小田急エース: "小田急",
  JR新宿駅改札内: "JR改札",
  JR新宿駅新南改札: "JR新南改札",
  西武新宿駅: "西武",
  都営新宿西口駅: "都営西口",
  ルミネ新宿: "ルミネ",
  西口周辺: "西口周辺",
};

// floorKey正規化（tenants.json → フロアデータ）
function normalizeFloorKey(key: string, area: string): string {
  // サブナードはB2（tenants.jsonではB1と誤記）
  if (area === "サブナード") return "B2";
  // "2F" → "2", "1F" → "1" 等
  return key.replace(/F$/, "");
}

// B001ポリゴンの重心を計算
function computeCentroid(space: SpaceFeature): [number, number] {
  const coords = space.geometry.coordinates[0] as number[][];
  if (!coords || coords.length === 0) return [0, 0];
  let cx = 0,
    cz = 0;
  for (const [x, z] of coords) {
    cx += x;
    cz += z;
  }
  return [cx / coords.length, cz / coords.length];
}

/**
 * テナント情報をロードし、B001ポリゴンに配置
 */
export async function loadAndPlaceTenants(
  floorDataMap: Map<string, FloorData>,
): Promise<PlacedTenant[]> {
  const res = await fetch("./data/tenants.json");
  const data = await res.json();
  const stores: TenantStore[] = data.stores;

  // フロアデータからB001ポリゴンを (dataArea, floorKey) でグループ化
  const b001Map = new Map<string, { cx: number; cz: number; used: boolean }[]>();

  for (const [floorKey, floorData] of floorDataMap) {
    for (const space of floorData.spaces) {
      if (space.category !== "B001") continue;
      const area = space.area || "";
      const key = `${area}__${floorKey}`;
      if (!b001Map.has(key)) b001Map.set(key, []);
      const [cx, cz] = computeCentroid(space);
      b001Map.get(key)!.push({ cx, cz, used: false });
    }
  }

  const placed: PlacedTenant[] = [];

  for (const store of stores) {
    const dataArea = AREA_MAP[store.area] ?? store.area;
    const floorKey = normalizeFloorKey(store.floorKey, store.area);
    const key = `${dataArea}__${floorKey}`;
    const polygons = b001Map.get(key);

    if (!polygons || polygons.length === 0) continue;

    // 未使用のポリゴンを探す
    const available = polygons.find((p) => !p.used);
    if (!available) continue; // 全ポリゴンが埋まっている

    available.used = true;

    const floorData = floorDataMap.get(floorKey);
    const baseY = floorData?.y ?? 0;

    placed.push({
      store,
      floorKey,
      position: new THREE.Vector3(available.cx, baseY + 4.5, -available.cz),
    });
  }

  return placed;
}

// テナントタイプ → 色
const TYPE_COLORS: Record<string, string> = {
  convenience: "#44cc44",
  cafe: "#cc8844",
  restaurant: "#cc4444",
  fastfood: "#ff6644",
  drugstore: "#44aacc",
  fashion: "#cc44aa",
  goods: "#aaaa44",
  book: "#8888cc",
  beauty: "#cc88cc",
  service: "#6688aa",
  food: "#ff8844",
  other: "#888888",
};

const tenantTextureCache = new Map<string, THREE.SpriteMaterial>();

/**
 * テナント用のSpriteを生成
 */
export function createTenantSprite(tenant: PlacedTenant): THREE.Sprite {
  const { store } = tenant;
  const cacheKey = `${store.icon}_${store.type}_${store.name}`;
  let mat = tenantTextureCache.get(cacheKey);

  if (!mat) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;

    // 背景
    const color = TYPE_COLORS[store.type] ?? TYPE_COLORS.other;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 0, 256, 80);
    ctx.globalAlpha = 1;

    // アイコン
    ctx.font = "32px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(store.icon, 8, 40);

    // 店名
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "left";
    const name = store.name.length > 10 ? store.name.slice(0, 10) + "…" : store.name;
    ctx.fillText(name, 48, 40);

    const texture = new THREE.CanvasTexture(canvas);
    mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    tenantTextureCache.set(cacheKey, mat);
  }

  const sprite = new THREE.Sprite(mat.clone());
  sprite.position.copy(tenant.position);
  sprite.scale.set(14, 4.5, 1);
  sprite.userData.layer = "tenant";
  sprite.userData.tenantName = store.name;
  sprite.userData.tenantType = store.type;

  return sprite;
}
