/**
 * テナント表示モジュール（PLATEAU 3Dデータ対応）
 *
 * - 床ポリゴンをカラーオーバーレイで店舗範囲を明示
 * - モダンなピル型ラベル（グラデーション、影、アイコン）
 * - ラベルから床への接続線
 */
import * as THREE from "three";

// --- 公開型 ---

export interface TenantSurface {
  type: string;
  vertices: number[];
  indices: number[];
  centroid?: [number, number, number];
}

export interface TenantStore {
  name: string;
  area: string;
  floorKey: string;
  type: string;
  icon: string;
}

export interface RenderedTenant {
  store: TenantStore;
  floorKey: string;
  worldPos: THREE.Vector3;
  sprite: THREE.Sprite;
  overlayMesh: THREE.Mesh;
  group: THREE.Group;
}

// --- テナントタイプ → 色 ---

export const TYPE_COLORS: Record<string, string> = {
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

// --- 内部ユーティリティ ---

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function darken(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = 1 - factor;
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

function lighten(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.min(255, Math.round(r + (255 - r) * factor))},${Math.min(255, Math.round(g + (255 - g) * factor))},${Math.min(255, Math.round(b + (255 - b) * factor))})`;
}

// --- 床ポリゴンオーバーレイ ---

function createOverlayMesh(
  surface: TenantSurface,
  color: string,
): THREE.Mesh {
  const geom = new THREE.BufferGeometry();
  // 頂点をコピーして少し上にオフセット
  const verts = new Float32Array(surface.vertices.length);
  for (let i = 0; i < surface.vertices.length; i += 3) {
    verts[i] = surface.vertices[i];
    verts[i + 1] = surface.vertices[i + 1] + 0.08; // 8cm上
    verts[i + 2] = surface.vertices[i + 2];
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geom.setIndex(surface.indices.slice());
  geom.computeVertexNormals();

  const [r, g, b] = hexToRgb(color);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(r / 255, g / 255, b / 255),
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.layer = "tenant-overlay";

  // エッジアウトライン
  const edgeGeom = new THREE.EdgesGeometry(geom, 1);
  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(r / 255, g / 255, b / 255),
    transparent: true,
    opacity: 0.9,
    linewidth: 1,
  });
  const edges = new THREE.LineSegments(edgeGeom, edgeMat);
  mesh.add(edges);

  return mesh;
}

// --- 近接floorサーフェスをマージしてより大きな範囲を示す ---

function findNearbyFloorSurfaces(
  primarySurface: TenantSurface,
  allFloorSurfaces: TenantSurface[],
  maxCount: number,
  maxDist: number,
): TenantSurface[] {
  if (!primarySurface.centroid) return [primarySurface];
  const [cx, cy, cz] = primarySurface.centroid;

  // 距離でソートし、近い順にmaxCount件取得
  const ranked = allFloorSurfaces
    .filter((s) => s.centroid && s !== primarySurface)
    .map((s) => {
      const [sx, sy, sz] = s.centroid!;
      const dist = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2 + (sz - cz) ** 2);
      return { surface: s, dist };
    })
    .filter((r) => r.dist < maxDist)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxCount - 1)
    .map((r) => r.surface);

  return [primarySurface, ...ranked];
}

// --- モダンラベルSprite ---

const labelCache = new Map<string, THREE.SpriteMaterial>();

function createModernLabel(store: TenantStore): THREE.Sprite {
  const cacheKey = `${store.icon}_${store.type}_${store.name}`;
  let mat = labelCache.get(cacheKey);

  if (!mat) {
    const W = 512;
    const H = 144;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    const typeColor = TYPE_COLORS[store.type] ?? TYPE_COLORS.other;
    const pad = 12;
    const radius = 28;
    const x = pad;
    const y = pad;
    const w = W - pad * 2;
    const h = H - pad * 2;

    // ドロップシャドウ
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;

    // ピル型背景（グラデーション）
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, lighten(typeColor, 0.1));
    grad.addColorStop(1, darken(typeColor, 0.2));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();

    // 影をリセット
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // 微妙なボーダー
    ctx.strokeStyle = lighten(typeColor, 0.4);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, w - 2, h - 2, radius - 1);
    ctx.stroke();

    // アイコン背景（左側の丸い領域）
    const iconCx = x + 56;
    const iconCy = y + h / 2;
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.arc(iconCx, iconCy, 36, 0, Math.PI * 2);
    ctx.fill();

    // アイコン
    ctx.font = "48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(store.icon, iconCx, iconCy + 2);

    // セパレータ線
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 100, y + 16);
    ctx.lineTo(x + 100, y + h - 16);
    ctx.stroke();

    // 店名
    ctx.font = "bold 38px 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // テキストシャドウ
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    const nameText = store.name.length > 9 ? store.name.slice(0, 9) + "…" : store.name;
    ctx.fillText(nameText, x + 116, iconCy + 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(nameText, x + 115, iconCy);

    // カテゴリ小バッジ（右下）
    const badgeText = categoryBadge(store.type);
    if (badgeText) {
      ctx.font = "22px sans-serif";
      const bw = ctx.measureText(badgeText).width + 16;
      const bx = x + w - bw - 12;
      const by = y + h - 32;
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, 24, 12);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(badgeText, bx + bw / 2, by + 12);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    labelCache.set(cacheKey, mat);
  }

  const sprite = new THREE.Sprite(mat.clone());
  sprite.scale.set(16, 4.5, 1);
  sprite.userData.layer = "tenant-label";
  sprite.userData.tenantName = store.name;
  sprite.userData.tenantType = store.type;
  return sprite;
}

function categoryBadge(type: string): string {
  const map: Record<string, string> = {
    convenience: "コンビニ",
    cafe: "カフェ",
    restaurant: "レストラン",
    fastfood: "ファストフード",
    drugstore: "ドラッグストア",
    fashion: "ファッション",
    goods: "雑貨",
    book: "書店",
    beauty: "ビューティー",
    service: "サービス",
    food: "フード",
  };
  return map[type] || "";
}

// --- 接続線 ---

function createConnectingLine(
  floorPos: THREE.Vector3,
  labelPos: THREE.Vector3,
  color: string,
): THREE.Line {
  const [r, g, b] = hexToRgb(color);
  const geom = new THREE.BufferGeometry().setFromPoints([
    floorPos.clone(),
    labelPos.clone(),
  ]);
  const mat = new THREE.LineDashedMaterial({
    color: new THREE.Color(r / 255, g / 255, b / 255),
    transparent: true,
    opacity: 0.4,
    dashSize: 0.8,
    gapSize: 0.5,
    linewidth: 1,
  });
  const line = new THREE.Line(geom, mat);
  line.computeLineDistances();
  return line;
}

// --- メインレンダー関数 ---

export interface AreaZone {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export interface RenderTenantsOptions {
  hashFn: (name: string) => number;
  normalizeFloorKey?: (key: string, area: string) => string;
  areaMap?: Record<string, string>;
  areaZones?: Record<string, AreaZone>;  // エリア→空間ゾーン制約
  labelHeight?: number;       // ラベルのY高さオフセット（デフォルト3.5）
  mergeNearby?: number;       // 近接ポリゴン数（デフォルト4）
  mergeRadius?: number;       // マージ半径（デフォルト8m）
}

export function renderTenants(
  stores: TenantStore[],
  floorEntries: Array<{ key: string; surfaces: TenantSurface[]; y: number }>,
  floorGroups: Map<string, THREE.Group>,
  options: RenderTenantsOptions,
): RenderedTenant[] {
  const result: RenderedTenant[] = [];
  const labelHeight = options.labelHeight ?? 3.5;
  const mergeNearby = options.mergeNearby ?? 4;
  const mergeRadius = options.mergeRadius ?? 8;

  // フロアキー → floorサーフェスリスト
  const floorSurfaceMap = new Map<string, TenantSurface[]>();
  for (const entry of floorEntries) {
    floorSurfaceMap.set(
      entry.key,
      entry.surfaces.filter((s) => s.type === "floor" && s.centroid),
    );
  }

  // 使用済みサーフェスを追跡（重複割当防止）
  const usedSurfaces = new Set<TenantSurface>();

  for (const store of stores) {
    const floorKey = options.normalizeFloorKey
      ? options.normalizeFloorKey(store.floorKey, store.area)
      : store.floorKey;
    const floorGroup = floorGroups.get(floorKey);
    if (!floorGroup) continue;

    const floorSurfaces = floorSurfaceMap.get(floorKey);
    if (!floorSurfaces || floorSurfaces.length === 0) continue;

    // 未使用のサーフェスからハッシュで選択
    let available = floorSurfaces.filter((s) => !usedSurfaces.has(s));
    if (available.length === 0) continue;

    // エリアゾーンが指定されていればゾーン内に絞る
    const zone = options.areaZones?.[store.area];
    if (zone && available.length > 0) {
      const zoned = available.filter((s) => {
        if (!s.centroid) return false;
        const [x, , z] = s.centroid;
        return x >= zone.xMin && x <= zone.xMax && z >= zone.zMin && z <= zone.zMax;
      });
      if (zoned.length > 0) available = zoned;
    }

    const idx = Math.abs(options.hashFn(store.name)) % available.length;
    const primarySurface = available[idx];
    usedSurfaces.add(primarySurface);

    const typeColor = TYPE_COLORS[store.type] ?? TYPE_COLORS.other;

    // 近接サーフェスをマージしてより広い範囲を示す
    const nearbySurfaces = findNearbyFloorSurfaces(
      primarySurface,
      available,
      mergeNearby,
      mergeRadius,
    );
    for (const ns of nearbySurfaces) usedSurfaces.add(ns);

    // グループ
    const tenantGroup = new THREE.Group();

    // 各サーフェスにオーバーレイ
    for (const surface of nearbySurfaces) {
      const overlay = createOverlayMesh(surface, typeColor);
      overlay.userData.tenantName = store.name;
      overlay.userData.tenantType = store.type;
      overlay.userData.tenantArea = options.areaMap?.[store.area] ?? store.area;
      tenantGroup.add(overlay);
    }

    // ラベル位置
    const [cx, cy, cz] = primarySurface.centroid!;
    const floorPos = new THREE.Vector3(cx, cy + 0.1, cz);
    const labelPos = new THREE.Vector3(cx, cy + labelHeight, cz);

    // ラベルSprite
    const sprite = createModernLabel(store);
    sprite.position.copy(labelPos);
    tenantGroup.add(sprite);

    // 接続線
    const line = createConnectingLine(floorPos, labelPos, typeColor);
    tenantGroup.add(line);

    floorGroup.add(tenantGroup);

    result.push({
      store,
      floorKey,
      worldPos: labelPos.clone(),
      sprite,
      overlayMesh: tenantGroup.children[0] as THREE.Mesh,
      group: tenantGroup,
    });
  }

  return result;
}
