/**
 * 歩行ネットワークのロード・経路探索
 *
 * network.json形式:
 *   nodes: [id, x, y, z, floor][]
 *   links: [startId, endId, distance, cost, routeType][]
 */

export interface NetNode {
  id: number;
  x: number;
  y: number;
  z: number;
  floor: string;
}

export interface NetLink {
  startId: number;
  endId: number;
  distance: number;
  cost: number;
  routeType: number; // 1=通常, 4=階段, 5=エスカ, 6=EV
}

export interface RouteResult {
  path: NetNode[];
  totalDistance: number;
  totalCost: number;
}

let nodes: NetNode[] = [];
let links: NetLink[] = [];
let adjacency: Map<number, { to: number; cost: number; linkIdx: number }[]> = new Map();

export async function loadNetwork(path = "./data/network.json"): Promise<void> {
  const res = await fetch(path);
  const data = await res.json();

  nodes = data.nodes.map((n: number[]) => ({
    id: n[0],
    x: n[1],
    y: n[2],
    z: n[3],
    floor: String(n[4]),
  }));

  links = data.links.map((l: number[]) => ({
    startId: l[0],
    endId: l[1],
    distance: l[2],
    cost: l[3],
    routeType: l[4],
  }));

  // 隣接リスト構築（双方向）
  adjacency = new Map();
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (!adjacency.has(link.startId)) adjacency.set(link.startId, []);
    if (!adjacency.has(link.endId)) adjacency.set(link.endId, []);
    adjacency.get(link.startId)!.push({ to: link.endId, cost: link.cost, linkIdx: i });
    adjacency.get(link.endId)!.push({ to: link.startId, cost: link.cost, linkIdx: i });
  }
}

export function getNodes(): NetNode[] {
  return nodes;
}

/**
 * 指定座標に最も近いノードを検索
 */
export function findNearestNode(x: number, y: number, z: number): NetNode | null {
  if (nodes.length === 0) return null;

  let best: NetNode | null = null;
  let bestDist = Infinity;

  for (const node of nodes) {
    const dx = node.x - x;
    const dy = node.y - y;
    const dz = node.z - z;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  }
  return best;
}

export interface RouteOptions {
  avoidStairs?: boolean;
}

export interface RouteStep {
  floor: string;
  type: "walk" | "stairs" | "escalator" | "elevator";
  distance: number;
  pathStartIdx: number;
  pathEndIdx: number;
}

function routeTypeToStep(rt: number): RouteStep["type"] {
  if (rt === 4) return "stairs";
  if (rt === 5) return "escalator";
  if (rt === 6) return "elevator";
  return "walk";
}

/**
 * 経路結果からフロア別ステップを生成
 */
export function buildRouteSteps(result: RouteResult): RouteStep[] {
  const steps: RouteStep[] = [];
  const path = result.path;
  if (path.length < 2) return steps;

  let currentFloor = path[0].floor;
  let currentType: RouteStep["type"] = "walk";
  let currentDist = 0;
  let stepStartIdx = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const neighbors = adjacency.get(path[i].id);
    const edge = neighbors?.find((e) => e.to === path[i + 1].id);
    const link = edge ? links[edge.linkIdx] : null;
    const segType = link ? routeTypeToStep(link.routeType) : "walk";
    const segDist = link ? link.distance : 0;

    if (segType !== currentType || path[i + 1].floor !== currentFloor) {
      if (currentDist > 0 || currentType !== "walk") {
        steps.push({ floor: currentFloor, type: currentType, distance: Math.round(currentDist), pathStartIdx: stepStartIdx, pathEndIdx: i });
      }
      stepStartIdx = i;
      currentFloor = path[i + 1].floor;
      currentType = segType;
      currentDist = segDist;
    } else {
      currentDist += segDist;
    }
  }
  if (currentDist > 0 || currentType !== "walk") {
    steps.push({ floor: currentFloor, type: currentType, distance: Math.round(currentDist), pathStartIdx: stepStartIdx, pathEndIdx: path.length - 1 });
  }

  return steps;
}

/**
 * A*経路探索
 */
export function findRoute(startId: number, endId: number, options?: RouteOptions): RouteResult | null {
  if (!adjacency.has(startId) || !adjacency.has(endId)) return null;

  const avoidStairs = options?.avoidStairs ?? false;

  const endNode = nodes.find((n) => n.id === endId);
  if (!endNode) return null;

  // ヒューリスティック: 3D距離
  function heuristic(nodeId: number): number {
    const n = nodes[nodeId];
    if (!n) return 0;
    const dx = n.x - endNode.x;
    const dy = n.y - endNode.y;
    const dz = n.z - endNode.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // A* implementation with binary heap
  const gScore = new Map<number, number>();
  const fScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();

  gScore.set(startId, 0);
  fScore.set(startId, heuristic(startId));

  // Simple priority queue (array-based, sufficient for ~2000 nodes)
  const openSet: number[] = [startId];
  const inOpen = new Set<number>([startId]);
  const closed = new Set<number>();

  while (openSet.length > 0) {
    // Pop lowest fScore
    openSet.sort((a, b) => (fScore.get(a) ?? Infinity) - (fScore.get(b) ?? Infinity));
    const current = openSet.shift()!;
    inOpen.delete(current);

    if (current === endId) {
      // パス復元
      const path: NetNode[] = [];
      let c: number | undefined = endId;
      while (c !== undefined) {
        path.unshift(nodes[c]);
        c = cameFrom.get(c);
      }

      let totalDistance = 0;
      let totalCost = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const neighbors = adjacency.get(path[i].id);
        if (neighbors) {
          const edge = neighbors.find((e) => e.to === path[i + 1].id);
          if (edge) {
            totalDistance += links[edge.linkIdx].distance;
            totalCost += edge.cost;
          }
        }
      }

      return { path, totalDistance: Math.round(totalDistance), totalCost: Math.round(totalCost) };
    }

    closed.add(current);

    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const edge of neighbors) {
      if (closed.has(edge.to)) continue;

      // バリアフリーモード: 階段(routeType===4)をスキップ
      if (avoidStairs && links[edge.linkIdx].routeType === 4) continue;

      const tentativeG = (gScore.get(current) ?? Infinity) + edge.cost;
      if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
        cameFrom.set(edge.to, current);
        gScore.set(edge.to, tentativeG);
        fScore.set(edge.to, tentativeG + heuristic(edge.to));

        if (!inOpen.has(edge.to)) {
          openSet.push(edge.to);
          inOpen.add(edge.to);
        }
      }
    }
  }

  return null; // 到達不能
}
