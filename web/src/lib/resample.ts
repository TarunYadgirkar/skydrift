import type { CutoutMeta } from "./spherex";
import { worldToPixel } from "./wcs";

const DEG = Math.PI / 180;
const MIN_COVERAGE = 0.6;

export interface Grid {
  raDeg: number;
  decDeg: number;
  size: number;
  scaleArcsec: number;
}

export interface Stamp {
  meta: CutoutMeta;
  pixels: Float32Array;
  detector: number;
  epoch: number;
}

export interface GridSky {
  ra: Float64Array;
  dec: Float64Array;
}

export function gridSky(grid: Grid): GridSky {
  const { size } = grid;
  const half = (size - 1) / 2;
  const step = (grid.scaleArcsec / 3600) * DEG;
  const ra0 = grid.raDeg * DEG;
  const dec0 = grid.decDeg * DEG;
  const ra = new Float64Array(size * size);
  const dec = new Float64Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const xi = -(col - half) * step;
      const eta = (half - row) * step;
      const rho = Math.hypot(xi, eta);
      const c = Math.atan(rho);
      const i = row * size + col;
      if (rho === 0) {
        ra[i] = grid.raDeg;
        dec[i] = grid.decDeg;
        continue;
      }
      dec[i] = Math.asin(Math.cos(c) * Math.sin(dec0) + (eta * Math.sin(c) * Math.cos(dec0)) / rho) / DEG;
      ra[i] = (ra0 + Math.atan2(xi * Math.sin(c), rho * Math.cos(dec0) * Math.cos(c) - eta * Math.sin(dec0) * Math.sin(c))) / DEG;
    }
  }
  return { ra, dec };
}

export function gridPixelToSky(grid: Grid, col: number, row: number): [number, number] {
  const half = (grid.size - 1) / 2;
  const step = (grid.scaleArcsec / 3600) * DEG;
  const xi = -(col - half) * step;
  const eta = (half - row) * step;
  const dec0 = grid.decDeg * DEG;
  const rho = Math.hypot(xi, eta);
  if (rho === 0) return [grid.raDeg, grid.decDeg];
  const c = Math.atan(rho);
  const dec = Math.asin(Math.cos(c) * Math.sin(dec0) + (eta * Math.sin(c) * Math.cos(dec0)) / rho);
  const ra = grid.raDeg * DEG + Math.atan2(xi * Math.sin(c), rho * Math.cos(dec0) * Math.cos(c) - eta * Math.sin(dec0) * Math.sin(c));
  return [ra / DEG, dec / DEG];
}

export function skyToGridPixel(grid: Grid, raDeg: number, decDeg: number): [number, number] {
  const half = (grid.size - 1) / 2;
  const step = (grid.scaleArcsec / 3600) * DEG;
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const ra0 = grid.raDeg * DEG;
  const dec0 = grid.decDeg * DEG;
  const cosC = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
  const xi = (Math.cos(dec) * Math.sin(ra - ra0)) / cosC;
  const eta = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / cosC;
  return [half - xi / step, half - eta / step];
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  values.sort((p, q) => p - q);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export function stampBackground(pixels: Float32Array): number {
  const finite: number[] = [];
  for (const value of pixels) if (Number.isFinite(value)) finite.push(value);
  return median(finite);
}

export function resampleStamp(stamp: Stamp, sky: GridSky): Float32Array | null {
  const { meta, pixels } = stamp;
  const project = worldToPixel(meta.wcs);
  const background = stampBackground(pixels);
  const out = new Float32Array(sky.ra.length);
  let covered = 0;
  for (let i = 0; i < out.length; i++) {
    const [px, py] = project(sky.ra[i], sky.dec[i]);
    const x = px - meta.x0;
    const y = py - meta.y0;
    const col = Math.floor(x);
    const row = Math.floor(y);
    if (col < 0 || row < 0 || col >= meta.size - 1 || row >= meta.size - 1) {
      out[i] = NaN;
      continue;
    }
    const fx = x - col;
    const fy = y - row;
    const base = row * meta.size + col;
    const value =
      pixels[base] * (1 - fx) * (1 - fy) +
      pixels[base + 1] * fx * (1 - fy) +
      pixels[base + meta.size] * (1 - fx) * fy +
      pixels[base + meta.size + 1] * fx * fy;
    out[i] = value - background;
    if (Number.isFinite(out[i])) covered++;
  }
  return covered / out.length >= MIN_COVERAGE ? out : null;
}

export function medianStack(frames: Float32Array[]): Float32Array {
  const length = frames[0].length;
  const out = new Float32Array(length);
  const column: number[] = [];
  for (let i = 0; i < length; i++) {
    column.length = 0;
    for (const frame of frames) if (Number.isFinite(frame[i])) column.push(frame[i]);
    out[i] = median(column);
  }
  return out;
}
