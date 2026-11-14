import { DETECTOR_SIZE } from "./spherex";

const DEG = Math.PI / 180;
const EPOCH_GAP_DAYS = 45;
const MAX_EPOCH_SPAN_DAYS = 45;
const FOOTPRINT_RADIUS_DEG = 3;
const INDEX_BASE = process.env.NEXT_PUBLIC_INDEX_BASE ?? "/skyindex";

interface Manifest {
  ringDeg: number;
  rowBytes: number;
  dirs: string[];
  shards: string[];
  rows: number;
}

export interface Exposure {
  key: string;
  detector: number;
  mjd: number;
  x: number;
  y: number;
  epoch: number;
}

let manifestPromise: Promise<{ manifest: Manifest; shardSet: Set<string> }> | null = null;
const shardCache = new Map<string, Promise<ArrayBuffer>>();

function loadManifest() {
  manifestPromise ??= fetch(`${INDEX_BASE}/manifest.json`).then(async (response) => {
    if (!response.ok) throw new Error("The sky index could not be loaded. Reload the page to try again.");
    const manifest = (await response.json()) as Manifest;
    return { manifest, shardSet: new Set(manifest.shards) };
  });
  return manifestPromise;
}

function loadShard(name: string): Promise<ArrayBuffer> {
  let cached = shardCache.get(name);
  if (!cached) {
    cached = fetch(`${INDEX_BASE}/${name}.bin`)
      .then((response) => {
        if (!response.ok) throw new Error("Part of the sky index could not be loaded. Try again in a moment.");
        return response.arrayBuffer();
      })
      .catch((error: unknown) => {
        shardCache.delete(name);
        throw error;
      });
    shardCache.set(name, cached);
  }
  return cached;
}

function cellsInRing(ring: number, ringDeg: number): number {
  const center = -90 + (ring + 0.5) * ringDeg;
  return Math.max(1, Math.round((360 * Math.cos(center * DEG)) / ringDeg));
}

function nearbyShards(raDeg: number, decDeg: number, ringDeg: number): string[] {
  const ringCount = Math.round(180 / ringDeg);
  const ring = Math.min(ringCount - 1, Math.max(0, Math.floor((decDeg + 90) / ringDeg)));
  const names: string[] = [];
  for (let r = Math.max(0, ring - 1); r <= Math.min(ringCount - 1, ring + 1); r++) {
    const count = cellsInRing(r, ringDeg);
    const edgeDec = Math.min(89.999, Math.max(Math.abs(-90 + r * ringDeg), Math.abs(-90 + (r + 1) * ringDeg)));
    const reach = FOOTPRINT_RADIUS_DEG / Math.cos(edgeDec * DEG);
    if (reach >= 180) {
      for (let c = 0; c < count; c++) names.push(`${r}_${c}`);
      continue;
    }
    const width = 360 / count;
    const first = Math.floor((raDeg - reach) / width);
    const last = Math.floor((raDeg + reach) / width);
    const seen = new Set<number>();
    for (let c = first; c <= last; c++) seen.add(((c % count) + count) % count);
    seen.forEach((c) => names.push(`${r}_${c}`));
  }
  return names;
}

function buildKey(dir: string, obs: number, exposure: number, detector: number): string {
  const [release, week, version] = dir.split("|");
  const obsId = String(obs).padStart(4, "0");
  return `${release}/level2/${week}/${version}/${detector}/level2_${week}_${obsId}_${exposure}D${detector}_spx_${version}.fits`;
}

export async function indexedExposureCount(): Promise<number> {
  return (await loadManifest()).manifest.rows;
}

export async function findExposures(raDeg: number, decDeg: number, halfSizePx: number): Promise<Exposure[]> {
  const { manifest, shardSet } = await loadManifest();
  const names = nearbyShards(raDeg, decDeg, manifest.ringDeg).filter((name) => shardSet.has(name));
  const buffers = await Promise.all(names.map(loadShard));
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const sinDec = Math.sin(dec);
  const cosDec = Math.cos(dec);
  const found: Omit<Exposure, "epoch">[] = [];
  for (const buffer of buffers) {
    const view = new DataView(buffer);
    for (let offset = 0; offset + manifest.rowBytes <= buffer.byteLength; offset += manifest.rowBytes) {
      const ra0 = view.getFloat64(offset, true) * DEG;
      const dec0 = view.getFloat64(offset + 8, true) * DEG;
      const cosDra = Math.cos(ra - ra0);
      const cosC = Math.sin(dec0) * sinDec + Math.cos(dec0) * cosDec * cosDra;
      if (cosC < Math.cos(FOOTPRINT_RADIUS_DEG * DEG)) continue;
      const xi = (cosDec * Math.sin(ra - ra0)) / cosC / DEG;
      const eta = (Math.cos(dec0) * sinDec - Math.sin(dec0) * cosDec * cosDra) / cosC / DEG;
      const a = view.getFloat32(offset + 16, true);
      const b = view.getFloat32(offset + 20, true);
      const c = view.getFloat32(offset + 24, true);
      const d = view.getFloat32(offset + 28, true);
      const det = a * d - b * c;
      const x = view.getFloat32(offset + 32, true) - 1 + (d * xi - b * eta) / det;
      const y = view.getFloat32(offset + 36, true) - 1 + (-c * xi + a * eta) / det;
      const limit = DETECTOR_SIZE - 1 - halfSizePx;
      if (x < halfSizePx || y < halfSizePx || x > limit || y > limit) continue;
      const detector = view.getUint8(offset + 53);
      found.push({
        key: buildKey(manifest.dirs[view.getUint16(offset + 48, true)], view.getUint16(offset + 50, true), view.getUint8(offset + 52), detector),
        detector,
        mjd: view.getFloat64(offset + 40, true),
        x,
        y,
      });
    }
  }
  found.sort((p, q) => p.mjd - q.mjd);
  let epoch = 0;
  let epochStart = found.length ? found[0].mjd : 0;
  return found.map((exposure, i) => {
    const gap = i > 0 ? exposure.mjd - found[i - 1].mjd : 0;
    if (gap > EPOCH_GAP_DAYS || exposure.mjd - epochStart >= MAX_EPOCH_SPAN_DAYS) {
      epoch++;
      epochStart = exposure.mjd;
    }
    return { ...exposure, epoch };
  });
}
