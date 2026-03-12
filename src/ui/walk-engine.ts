import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getNodeById, getNeighbors, getLink } from "../data/network";
import type { NetNode } from "../data/network";

export interface WalkController {
  start(nodeId: number): void;
  stop(): void;
  isActive(): boolean;
}

interface WalkState {
  currentNodeId: number;
  isMoving: boolean;
  animationId: number | null;
}

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 12; // m/s

/**
 * 分岐ノード判定: 接続数3以上、またはフロアが変わる接続がある
 */
function isJunction(nodeId: number): boolean {
  const neighbors = getNeighbors(nodeId);
  if (neighbors.length >= 3) return true;
  if (neighbors.length <= 1) return true; // 行き止まりも停止
  // 2接続でもルートタイプが変わる場合（階段→通路など）
  const types = new Set(neighbors.map(n => getLink(n.linkIdx).routeType));
  if (types.size > 1) return true;
  return false;
}

/**
 * currentNodeからdirectionNodeの方向に進み、次の分岐ノードまでのパスを取得
 */
function findPathToNextJunction(
  startId: number,
  firstStepId: number,
): NetNode[] {
  const path: NetNode[] = [getNodeById(startId)!];
  let prev = startId;
  let current = firstStepId;

  while (true) {
    const node = getNodeById(current);
    if (!node) break;
    path.push(node);

    if (isJunction(current)) break;

    // 2接続の中間ノード: 来た方向と逆に進む
    const neighbors = getNeighbors(current);
    const next = neighbors.find(n => n.to !== prev);
    if (!next) break;

    prev = current;
    current = next.to;
  }

  return path;
}

/**
 * 分岐ノードから各方向への情報を取得
 */
export interface DirectionInfo {
  neighborId: number;       // 最初の1歩先のノード
  targetJunctionId: number; // 到達する分岐ノード
  angle: number;            // XZ平面上の角度(rad)
  direction: THREE.Vector3; // 方向ベクトル
  distance: number;         // 距離
  routeType: number;        // リンクタイプ
  floor: string;            // 先のフロア
}

export function getDirections(nodeId: number, negateZ: boolean): DirectionInfo[] {
  const node = getNodeById(nodeId);
  if (!node) return [];

  const neighbors = getNeighbors(nodeId);
  const directions: DirectionInfo[] = [];

  for (const nb of neighbors) {
    const nbNode = getNodeById(nb.to);
    if (!nbNode) continue;

    const link = getLink(nb.linkIdx);
    const path = findPathToNextJunction(nodeId, nb.to);
    const targetNode = path[path.length - 1];

    const dx = nbNode.x - node.x;
    const dz = negateZ ? -(nbNode.z - node.z) : (nbNode.z - node.z);
    const angle = Math.atan2(dz, dx);
    const dir = new THREE.Vector3(dx, 0, dz).normalize();

    // パス全体の距離を計算
    let dist = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      dist += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2);
    }

    directions.push({
      neighborId: nb.to,
      targetJunctionId: targetNode.id,
      angle,
      direction: dir,
      distance: Math.round(dist),
      routeType: link.routeType,
      floor: nbNode.floor,
    });
  }

  return directions;
}

/**
 * ウォークエンジン
 */
export function createWalkEngine(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  requestRender: () => void,
  negateZ: boolean,
  onArriveAtJunction: (nodeId: number, directions: DirectionInfo[]) => void,
  onFloorChange?: (floor: string) => void,
): WalkController {
  const state: WalkState = {
    currentNodeId: -1,
    isMoving: false,
    animationId: null,
  };

  function posFromNode(n: NetNode): THREE.Vector3 {
    return new THREE.Vector3(n.x, n.y + EYE_HEIGHT, negateZ ? -n.z : n.z);
  }

  function start(nodeId: number) {
    state.currentNodeId = nodeId;
    state.isMoving = false;

    const node = getNodeById(nodeId);
    if (!node) return;

    // カメラを初期位置に移動
    const pos = posFromNode(node);
    camera.position.copy(pos);

    // 最初の方向を見る
    const dirs = getDirections(nodeId, negateZ);
    if (dirs.length > 0) {
      const lookAt = pos.clone().add(dirs[0].direction.clone().multiplyScalar(8));
      lookAt.y = pos.y;
      controls.target.copy(lookAt);
    }
    controls.update();
    requestRender();

    onArriveAtJunction(nodeId, dirs);
  }

  function walkTo(neighborId: number) {
    if (state.isMoving) return;

    const path = findPathToNextJunction(state.currentNodeId, neighborId);
    if (path.length < 2) return;

    state.isMoving = true;

    // パスポイントをThree.js座標に変換
    const points = path.map(n => posFromNode(n));

    // 各セグメントの累積距離
    const segDist: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      segDist.push(segDist[i - 1] + points[i - 1].distanceTo(points[i]));
    }
    const totalDist = segDist[segDist.length - 1];
    const duration = (totalDist / WALK_SPEED) * 1000; // ms

    const startTime = performance.now();

    function animate() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      // easeInOutQuad
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

      const traveled = ease * totalDist;

      // どのセグメント上か
      let segIdx = 0;
      for (let i = 1; i < segDist.length; i++) {
        if (segDist[i] >= traveled) {
          segIdx = i - 1;
          break;
        }
        segIdx = i - 1;
      }

      const segStart = segDist[segIdx];
      const segEnd = segDist[segIdx + 1] ?? segDist[segIdx];
      const segLen = segEnd - segStart;
      const localT = segLen > 0 ? (traveled - segStart) / segLen : 0;

      const pos = new THREE.Vector3().lerpVectors(points[segIdx], points[segIdx + 1] ?? points[segIdx], localT);
      camera.position.copy(pos);

      // 視線: 少し先を見る
      const lookAhead = Math.min(traveled + 8, totalDist);
      let lookSegIdx = segIdx;
      for (let i = segIdx; i < segDist.length - 1; i++) {
        if (segDist[i + 1] >= lookAhead) {
          lookSegIdx = i;
          break;
        }
        lookSegIdx = i;
      }
      const lookSegStart = segDist[lookSegIdx];
      const lookSegEnd = segDist[lookSegIdx + 1] ?? segDist[lookSegIdx];
      const lookSegLen = lookSegEnd - lookSegStart;
      const lookLocalT = lookSegLen > 0 ? (lookAhead - lookSegStart) / lookSegLen : 1;
      const lookAt = new THREE.Vector3().lerpVectors(
        points[lookSegIdx],
        points[lookSegIdx + 1] ?? points[lookSegIdx],
        Math.min(lookLocalT, 1),
      );
      lookAt.y = pos.y;
      controls.target.copy(lookAt);
      controls.update();
      requestRender();

      // フロア変化チェック
      if (onFloorChange && segIdx < path.length) {
        const curFloor = path[segIdx].floor;
        if (segIdx > 0 && curFloor !== path[segIdx - 1].floor) {
          onFloorChange(curFloor);
        }
      }

      if (t < 1) {
        state.animationId = requestAnimationFrame(animate);
      } else {
        // 到着
        state.isMoving = false;
        state.animationId = null;
        const lastNode = path[path.length - 1];
        state.currentNodeId = lastNode.id;

        if (onFloorChange) onFloorChange(lastNode.floor);

        const dirs = getDirections(lastNode.id, negateZ);
        onArriveAtJunction(lastNode.id, dirs);
      }
    }

    state.animationId = requestAnimationFrame(animate);
  }

  function stop() {
    if (state.animationId !== null) {
      cancelAnimationFrame(state.animationId);
      state.animationId = null;
    }
    state.isMoving = false;
    state.currentNodeId = -1;
  }

  // walkToをexportするため、onArriveAtJunctionコールバックから呼べるようにする
  (window as any).__walkTo = walkTo;

  return {
    start,
    stop,
    isActive: () => state.currentNodeId !== -1,
  };
}

/** 外部からwalkToを呼ぶ */
export function triggerWalkTo(neighborId: number): void {
  const fn = (window as any).__walkTo;
  if (fn) fn(neighborId);
}
