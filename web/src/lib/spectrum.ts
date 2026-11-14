import { median, type Stamp } from "./resample";
import { DETECTOR_SIZE, PIXEL_SOLID_ANGLE_SR } from "./spherex";
import { worldToPixel } from "./wcs";

const APERTURE_RADIUS_PX = 2;
const ANNULUS_INNER_PX = 4;
const ANNULUS_OUTER_PX = 7;
const MJY_PER_SR_TO_MJY = PIXEL_SOLID_ANGLE_SR * 1e9;

interface WavelengthTable {
  grid: number;
  step: number;
  detectors: Record<string, number[]>;
}

export interface SpectrumPoint {
  micron: number;
  fluxMjy: number;
  epoch: number;
  detector: number;
}

let tablePromise: Promise<WavelengthTable> | null = null;

export function loadWavelengths(): Promise<WavelengthTable> {
  tablePromise ??= fetch("/wavelengths.json")
    .then((response) => {
      if (!response.ok) throw new Error("The wavelength calibration could not be loaded.");
      return response.json() as Promise<WavelengthTable>;
    })
    .catch((error: unknown) => {
      tablePromise = null;
      throw error;
    });
  return tablePromise;
}

function wavelengthAt(table: WavelengthTable, detector: number, x: number, y: number): number {
  const values = table.detectors[String(detector)];
  const gx = Math.min(table.grid - 1.001, Math.max(0, x / table.step));
  const gy = Math.min(table.grid - 1.001, Math.max(0, y / table.step));
  const col = Math.floor(gx);
  const row = Math.floor(gy);
  const fx = gx - col;
  const fy = gy - row;
  const base = row * table.grid + col;
  return (
    values[base] * (1 - fx) * (1 - fy) +
    values[base + 1] * fx * (1 - fy) +
    values[base + table.grid] * (1 - fx) * fy +
    values[base + table.grid + 1] * fx * fy
  );
}

function aperturePhotometry(stamp: Stamp, x: number, y: number): number | null {
  const { size } = stamp.meta;
  if (x < ANNULUS_OUTER_PX || y < ANNULUS_OUTER_PX || x > size - 1 - ANNULUS_OUTER_PX || y > size - 1 - ANNULUS_OUTER_PX) {
    return null;
  }
  let sum = 0;
  let area = 0;
  const sky: number[] = [];
  const reach = Math.ceil(ANNULUS_OUTER_PX);
  for (let row = Math.round(y) - reach; row <= Math.round(y) + reach; row++) {
    for (let col = Math.round(x) - reach; col <= Math.round(x) + reach; col++) {
      const value = stamp.pixels[row * size + col];
      const distance = Math.hypot(col - x, row - y);
      if (distance <= APERTURE_RADIUS_PX) {
        if (!Number.isFinite(value)) return null;
        sum += value;
        area++;
      } else if (distance >= ANNULUS_INNER_PX && distance <= ANNULUS_OUTER_PX && Number.isFinite(value)) {
        sky.push(value);
      }
    }
  }
  if (sky.length < 20) return null;
  return (sum - area * median(sky)) * MJY_PER_SR_TO_MJY;
}

export async function extractSpectrum(stamps: Stamp[], raDeg: number, decDeg: number): Promise<SpectrumPoint[]> {
  const table = await loadWavelengths();
  const points: SpectrumPoint[] = [];
  for (const stamp of stamps) {
    const [px, py] = worldToPixel(stamp.meta.wcs)(raDeg, decDeg);
    if (px < 0 || py < 0 || px > DETECTOR_SIZE - 1 || py > DETECTOR_SIZE - 1) continue;
    const fluxMjy = aperturePhotometry(stamp, px - stamp.meta.x0, py - stamp.meta.y0);
    if (fluxMjy === null) continue;
    points.push({ micron: wavelengthAt(table, stamp.detector, px, py), fluxMjy, epoch: stamp.epoch, detector: stamp.detector });
  }
  return points.sort((p, q) => p.micron - q.micron);
}
