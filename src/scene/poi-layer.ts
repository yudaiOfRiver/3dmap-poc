import * as THREE from "three";
import type { FacilityFeature } from "../data/loader";

// POIカテゴリ → 表示情報
const POI_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  F001: { icon: "🚹", color: "#66cccc", label: "トイレ(男性)" },
  F002: { icon: "🚺", color: "#cc66aa", label: "トイレ(女性)" },
  F003: { icon: "🚻", color: "#66cccc", label: "トイレ(共用)" },
  F004: { icon: "🚻", color: "#66cccc", label: "トイレ" },
  F005: { icon: "♿", color: "#66cccc", label: "多機能トイレ" },
  F006: { icon: "♿", color: "#66cccc", label: "多機能トイレ" },
  F007: { icon: "♿", color: "#66cccc", label: "多機能トイレ" },
  F008: { icon: "♿", color: "#66cccc", label: "多機能トイレ" },
  F011: { icon: "🔲", color: "#ff8866", label: "階段" },
  F012: { icon: "🔼", color: "#ffaa44", label: "エレベーター" },
  F013: { icon: "◤", color: "#ff8866", label: "エスカレーター" },
  F014: { icon: "⟋", color: "#ff8866", label: "スロープ" },
  F017: { icon: "🚪", color: "#88cc44", label: "出入口" },
  F018: { icon: "ℹ", color: "#44aaff", label: "案内所" },
  F020: { icon: "💺", color: "#aaaaaa", label: "待合室" },
  F021: { icon: "🍼", color: "#ffaacc", label: "授乳室" },
  F025: { icon: "🏪", color: "#ffaa44", label: "店舗" },
  F030: { icon: "🏧", color: "#44cc88", label: "ATM" },
  F031: { icon: "🔒", color: "#8888aa", label: "ロッカー" },
  F038: { icon: "🚌", color: "#44aaff", label: "バス停" },
  F101: { icon: "🎫", color: "#44cc88", label: "きっぷ売り場" },
  F106: { icon: "🚉", color: "#44cc88", label: "改札口" },
  F107: { icon: "🏪", color: "#ffaa44", label: "売店" },
  F108: { icon: "🚪", color: "#88cc44", label: "出口" },
};

// 非表示にするカテゴリ（階段は数が多すぎるので間引く）
const HIDDEN_CATEGORIES = new Set<string>();

export interface POIEntry {
  sprite: THREE.Sprite;
  facility: FacilityFeature;
  floorKey: string;
  worldPos: THREE.Vector3;
  label: string;
  categoryLabel: string;
}

/**
 * テクスチャキャッシュ付きでSprite用テクスチャを生成
 */
const textureCache = new Map<string, THREE.SpriteMaterial>();

function getPoiMaterial(icon: string, color: string): THREE.SpriteMaterial {
  const key = `${icon}_${color}`;
  const cached = textureCache.get(key);
  if (cached) return cached.clone();

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // 背景円
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  // アイコン文字
  ctx.font = `${size * 0.45}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(icon, size / 2, size / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
  });
  textureCache.set(key, mat);
  return mat.clone();
}

/**
 * POIスプライトを生成してグループに追加
 */
export function buildPOILayer(
  facilities: FacilityFeature[],
  floorKey: string,
  baseY: number,
): POIEntry[] {
  const entries: POIEntry[] = [];

  // F011（階段）の間引きカウンター
  const stairCount = new Map<string, number>(); // key: area
  const MAX_STAIRS_PER_AREA = 2;

  for (const fac of facilities) {
    if (HIDDEN_CATEGORIES.has(fac.category)) continue;

    // F011の間引き: 各エリアで最大2件のみ表示
    if (fac.category === "F011") {
      const key = fac.area || "unknown";
      const count = stairCount.get(key) ?? 0;
      if (count >= MAX_STAIRS_PER_AREA) continue;
      stairCount.set(key, count + 1);
    }

    const config = POI_CONFIG[fac.category];
    if (!config) continue;

    const [x, z] = fac.geometry.coordinates;
    const mat = getPoiMaterial(config.icon, config.color);
    const sprite = new THREE.Sprite(mat);

    const worldPos = new THREE.Vector3(x, baseY + 4.5, -z);
    sprite.position.copy(worldPos);
    sprite.scale.set(4, 4, 1);

    const name = fac.name || config.label;
    const label = `${fac.area} - ${name}`;

    entries.push({
      sprite,
      facility: fac,
      floorKey,
      worldPos,
      label,
      categoryLabel: config.label,
    });
  }

  return entries;
}

/**
 * POIカテゴリの日本語ラベルを取得
 */
export function getCategoryLabel(category: string): string {
  return POI_CONFIG[category]?.label || category;
}
