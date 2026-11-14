import { gaiaPositionAt, totalMotionMasYr, type GaiaStar } from "./gaia";
import { loadMoverModel, type ModelMetrics } from "./moverModel";
import { fillSaturatedCores, stretchFor } from "./render";
import { gridPixelToSky, median, type Grid } from "./resample";
import { mjdToYear } from "./target";

const DETECTION_SIGMA = 6;
const PEAK_HALF = 2;
const CENTROID_HALF = 3;
const STAMP_HALF = 7;
const EDGE_MARGIN = 12;
const MIN_SHIFT_PX = 0.5;
const STATIC_SHIFT_PX = 1;
const GAIA_MATCH_ARCSEC = 9;
const CUBIC_A = -0.75;
const DUPLICATE_RADIUS_PX = 5;
const GAIA_DISAGREEMENT_ARCSEC_YR = 1;
const GAIA_DISAGREEMENT_FRACTION = 0.5;

export interface DetectedSource {
  x: number;
  y: number;
  snr: number;
}

export interface MoverCandidate {
  id: string;
  raDeg: number;
  decDeg: number;
  probability: number;
  /** Motion between the first and last pass as [east, north] in arcseconds. */
  motionArcsec: [number, number];
  speedArcsecYr: number;
  snr: number;
  gaia: GaiaStar | null;
  isMover: boolean;
  /** The image shows a shift, but Gaia's measured motion for this star rules it out. */
  ruledOutByGaia: boolean;
}

export interface MoverReport {
  candidates: MoverCandidate[];
  sourcesChecked: number;
  baselineYears: number;
  metrics: ModelMetrics;
}

function noiseSigma(frame: Float32Array): number {
  const finite: number[] = [];
  for (const value of frame) if (Number.isFinite(value)) finite.push(value);
  const center = median([...finite]);
  return 1.4826 * median(finite.map((value) => Math.abs(value - center))) || 1e-6;
}

export function detectSources(frame: Float32Array, size: number): DetectedSource[] {
  const sigma = noiseSigma(frame);
  const at = (col: number, row: number) => (Number.isFinite(frame[row * size + col]) ? frame[row * size + col] : 0);
  const sources: DetectedSource[] = [];
  for (let row = EDGE_MARGIN; row < size - EDGE_MARGIN; row++) {
    for (let col = EDGE_MARGIN; col < size - EDGE_MARGIN; col++) {
      const peak = at(col, row);
      if (peak <= DETECTION_SIGMA * sigma || !isLocalMaximum(at, col, row, peak)) continue;
      let total = 0;
      let sumX = 0;
      let sumY = 0;
      for (let dy = -CENTROID_HALF; dy <= CENTROID_HALF; dy++) {
        for (let dx = -CENTROID_HALF; dx <= CENTROID_HALF; dx++) {
          const value = Math.max(0, at(col + dx, row + dy));
          total += value;
          sumX += value * dx;
          sumY += value * dy;
        }
      }
      if (total > 0) sources.push({ x: col + sumX / total, y: row + sumY / total, snr: peak / sigma });
    }
  }
  return sources;
}

function dropDuplicates(sources: DetectedSource[]): DetectedSource[] {
  const brightestFirst = [...sources].sort((p, q) => q.snr - p.snr);
  return brightestFirst.filter(
    (source, i) => !brightestFirst.slice(0, i).some((other) => Math.hypot(other.x - source.x, other.y - source.y) < DUPLICATE_RADIUS_PX),
  );
}

function isLocalMaximum(at: (col: number, row: number) => number, col: number, row: number, peak: number): boolean {
  for (let dy = -PEAK_HALF; dy <= PEAK_HALF; dy++) {
    for (let dx = -PEAK_HALF; dx <= PEAK_HALF; dx++) {
      const other = at(col + dx, row + dy);
      if (other > peak || (other === peak && (dy < 0 || (dy === 0 && dx < 0)))) return false;
    }
  }
  return true;
}

function cubicWeights(t: number): [number, number, number, number] {
  const near = (x: number) => ((CUBIC_A + 2) * x - (CUBIC_A + 3)) * x * x + 1;
  const far = (x: number) => ((CUBIC_A * x - 5 * CUBIC_A) * x + 8 * CUBIC_A) * x - 4 * CUBIC_A;
  return [far(t + 1), near(t), near(1 - t), far(2 - t)];
}

function sampleStamp(frame: Float32Array, size: number, x: number, y: number): Float32Array {
  const side = 2 * STAMP_HALF + 1;
  const out = new Float32Array(side * side);
  const col0 = Math.floor(x);
  const row0 = Math.floor(y);
  const wx = cubicWeights(x - col0);
  const wy = cubicWeights(y - row0);
  const clamp = (v: number) => Math.min(size - 1, Math.max(0, v));
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      let sum = 0;
      for (let n = 0; n < 4; n++) {
        const row = clamp(row0 + j - STAMP_HALF + n - 1);
        for (let m = 0; m < 4; m++) {
          const value = frame[row * size + clamp(col0 + i - STAMP_HALF + m - 1)];
          if (Number.isFinite(value)) sum += value * wx[m] * wy[n];
        }
      }
      out[j * side + i] = sum;
    }
  }
  return out;
}

function buildInput(first: Float32Array, second: Float32Array): Float32Array {
  let scale = 1e-6;
  for (let i = 0; i < first.length; i++) scale = Math.max(scale, first[i], second[i]);
  const clampUnit = (v: number) => Math.min(1.5, Math.max(-0.5, v / scale));
  const input = new Float32Array(3 * first.length);
  for (let i = 0; i < first.length; i++) {
    const a = clampUnit(first[i]);
    const b = clampUnit(second[i]);
    input[i] = a;
    input[first.length + i] = b;
    input[2 * first.length + i] = b - a;
  }
  return input;
}

function matchGaia(stars: GaiaStar[], raDeg: number, decDeg: number, year: number): GaiaStar | null {
  let best: GaiaStar | null = null;
  let bestDistance = GAIA_MATCH_ARCSEC;
  const cosDec = Math.cos((decDeg * Math.PI) / 180);
  for (const star of stars) {
    const position = gaiaPositionAt(star, year);
    const distance = Math.hypot((position.raDeg - raDeg) * cosDec, position.decDeg - decDeg) * 3600;
    if (distance < bestDistance) {
      best = star;
      bestDistance = distance;
    }
  }
  return best;
}

export async function findMovers(
  grid: Grid,
  first: Float32Array,
  last: Float32Array,
  firstMjd: number,
  lastMjd: number,
  gaiaStars: GaiaStar[],
): Promise<MoverReport> {
  const model = await loadMoverModel();
  const baselineYears = (lastMjd - firstMjd) / 365.25;
  const firstFilled = capSaturatedCores(first, grid.size);
  const lastFilled = capSaturatedCores(last, grid.size);
  const sources = dropDuplicates(detectSources(firstFilled, grid.size));
  const raw = sources.map((source) => {
    const [logit, dx, dy] = model.predict(
      buildInput(sampleStamp(firstFilled, grid.size, source.x, source.y), sampleStamp(lastFilled, grid.size, source.x, source.y)),
    );
    return { source, probability: 1 / (1 + Math.exp(-logit)), dx, dy };
  });
  const still = raw.filter((r) => Math.hypot(r.dx, r.dy) < STATIC_SHIFT_PX);
  const offsetX = still.length ? median(still.map((r) => r.dx)) : 0;
  const offsetY = still.length ? median(still.map((r) => r.dy)) : 0;

  const candidates = raw.map(({ source, probability, dx, dy }): MoverCandidate => {
    const shiftX = dx - offsetX;
    const shiftY = dy - offsetY;
    const [raDeg, decDeg] = gridPixelToSky(grid, source.x, source.y);
    const motionArcsec: [number, number] = [-shiftX * grid.scaleArcsec, -shiftY * grid.scaleArcsec];
    const speedArcsecYr = Math.hypot(...motionArcsec) / baselineYears;
    const gaia = matchGaia(gaiaStars, raDeg, decDeg, mjdToYear(firstMjd));
    const shifted = probability > model.metrics.threshold && Math.hypot(shiftX, shiftY) >= MIN_SHIFT_PX;
    const ruledOutByGaia = shifted && gaia !== null && disagreesWithGaia(speedArcsecYr, gaia);
    return {
      id: `${raDeg.toFixed(5)}_${decDeg.toFixed(5)}`,
      raDeg,
      decDeg,
      probability,
      motionArcsec,
      speedArcsecYr,
      snr: source.snr,
      gaia,
      isMover: shifted && !ruledOutByGaia,
      ruledOutByGaia,
    };
  });
  candidates.sort((p, q) => Number(q.isMover) - Number(p.isMover) || q.probability - p.probability);
  return { candidates, sourcesChecked: sources.length, baselineYears, metrics: model.metrics };
}

function disagreesWithGaia(measuredArcsecYr: number, star: GaiaStar): boolean {
  const difference = Math.abs(measuredArcsecYr - gaiaSpeedArcsecYr(star));
  return difference > Math.max(GAIA_DISAGREEMENT_ARCSEC_YR, GAIA_DISAGREEMENT_FRACTION * measuredArcsecYr);
}

/** Saturated cores are missing pixels. Fill them with the frame's brightest value so the star is one solid blob. */
function capSaturatedCores(frame: Float32Array, size: number): Float32Array {
  let brightest = 0;
  for (const value of frame) if (Number.isFinite(value) && value > brightest) brightest = value;
  const filled = fillSaturatedCores(frame, size, stretchFor([frame]).high);
  for (let i = 0; i < filled.length; i++) if (filled[i] === Infinity) filled[i] = brightest;
  return filled;
}

export function gaiaSpeedArcsecYr(star: GaiaStar): number {
  return totalMotionMasYr(star) / 1000;
}
