export interface FloorInfo {
  key: string;
  ordinal: number;
  y: number;
  label: string;
}

export interface SpaceFeature {
  geometry: GeoPolygon;
  category: string;
  group: string;
  area: string;
  name?: string;
}

export interface FixtureFeature {
  geometry: GeoPolygon;
  category: string;
  area: string;
}

export interface FloorPolygon {
  geometry: GeoPolygon;
  area: string;
}

export interface FacilityFeature {
  geometry: { type: "Point"; coordinates: [number, number] };
  category: string;
  area: string;
  name?: string;
}

export interface DrawingFeature {
  geometry: { type: "LineString"; coordinates: [number, number][] };
  area: string;
}

export interface GeoPolygon {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

export interface FloorData {
  ordinal: number;
  y: number;
  spaces: SpaceFeature[];
  fixtures: FixtureFeature[];
  floors: FloorPolygon[];
  drawings: DrawingFeature[];
  facilities: FacilityFeature[];
}

const cache = new Map<string, FloorData>();

export async function loadFloorIndex(): Promise<FloorInfo[]> {
  const res = await fetch("./data/floors/index.json");
  return res.json();
}

export async function loadFloorData(key: string): Promise<FloorData> {
  const cached = cache.get(key);
  if (cached) return cached;

  const res = await fetch(`./data/floors/${key}.json`);
  const data: FloorData = await res.json();
  cache.set(key, data);
  return data;
}
