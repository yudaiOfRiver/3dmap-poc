import * as THREE from "three";

const STORAGE_KEY = "3dmap-theme";

type Theme = "dark" | "light";

const SCENE_COLORS: Record<Theme, { bg: number; fog: number; grid1: number; grid2: number }> = {
  dark: { bg: 0x0b1a2d, fog: 0x0b1a2d, grid1: 0x1a3a5c, grid2: 0x112840 },
  light: { bg: 0xe8eef4, fog: 0xe8eef4, grid1: 0xc0cdd8, grid2: 0xd0dbe5 },
};

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function setupThemeToggle(
  scene: THREE.Scene,
  requestRender: () => void,
): void {
  const theme = getStoredTheme();
  applyTheme(theme);
  applySceneColors(scene, theme);

  const btn = document.getElementById("theme-toggle");
  if (!btn) return;

  updateIcon(btn, theme);

  btn.addEventListener("click", () => {
    const next: Theme =
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "light"
        : "dark";
    applyTheme(next);
    applySceneColors(scene, next);
    updateIcon(btn, next);
    requestRender();
  });
}

function applySceneColors(scene: THREE.Scene, theme: Theme) {
  const c = SCENE_COLORS[theme];
  (scene.background as THREE.Color).set(c.bg);
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.set(c.fog);
  }
  // Update grid
  scene.children.forEach((child) => {
    if (child instanceof THREE.GridHelper) {
      const mat = (child as THREE.GridHelper).material;
      if (Array.isArray(mat)) {
        (mat[0] as THREE.LineBasicMaterial).color.set(c.grid1);
        (mat[1] as THREE.LineBasicMaterial).color.set(c.grid2);
      }
    }
  });
}

function updateIcon(btn: HTMLElement, theme: Theme) {
  btn.textContent = theme === "dark" ? "☀" : "🌙";
  btn.title = theme === "dark" ? "ライトモードに切替" : "ダークモードに切替";
}
