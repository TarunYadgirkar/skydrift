export interface Stretch {
  low: number;
  high: number;
}

export type Palette = "plate" | "sky" | "difference";

const LOW_PERCENTILE = 0.25;
const HIGH_PERCENTILE = 0.997;
const ASINH_SOFTENING = 0.08;
const PLATE_LIGHT: [number, number, number] = [233, 237, 240];
const PLATE_DARK: [number, number, number] = [20, 32, 43];
const DIFF_NEGATIVE: [number, number, number] = [11, 110, 153];
const DIFF_POSITIVE: [number, number, number] = [196, 92, 0];

export function stretchFor(frames: (Float32Array | null)[]): Stretch {
  const values: number[] = [];
  for (const frame of frames) {
    if (!frame) continue;
    for (const value of frame) if (Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return { low: 0, high: 1 };
  values.sort((p, q) => p - q);
  const at = (fraction: number) => values[Math.min(values.length - 1, Math.floor(fraction * values.length))];
  const low = at(LOW_PERCENTILE);
  return { low, high: Math.max(at(HIGH_PERCENTILE), low + 1e-6) };
}

export function symmetricStretch(frame: Float32Array): Stretch {
  const magnitudes: number[] = [];
  for (const value of frame) if (Number.isFinite(value)) magnitudes.push(Math.abs(value));
  magnitudes.sort((p, q) => p - q);
  const high = magnitudes[Math.floor(0.995 * magnitudes.length)] || 1;
  return { low: -high, high };
}

function asinhScale(t: number): number {
  return Math.asinh(t / ASINH_SOFTENING) / Math.asinh(1 / ASINH_SOFTENING);
}

function mix(from: [number, number, number], to: [number, number, number], t: number): [number, number, number] {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
}

function colorFor(value: number, stretch: Stretch, palette: Palette): [number, number, number] {
  if (!Number.isFinite(value)) return palette === "sky" ? [38, 50, 61] : [214, 220, 225];
  if (palette === "difference") {
    const t = Math.max(-1, Math.min(1, value / stretch.high));
    const strength = asinhScale(Math.abs(t));
    return mix(PLATE_LIGHT, t < 0 ? DIFF_NEGATIVE : DIFF_POSITIVE, strength);
  }
  const t = asinhScale(Math.max(0, Math.min(1, (value - stretch.low) / (stretch.high - stretch.low))));
  return palette === "plate" ? mix(PLATE_LIGHT, PLATE_DARK, t) : mix(PLATE_DARK, [255, 255, 255], t);
}

export function paintFrame(
  context: CanvasRenderingContext2D,
  frame: Float32Array,
  size: number,
  stretch: Stretch,
  palette: Palette,
): void {
  const image = context.createImageData(size, size);
  for (let i = 0; i < frame.length; i++) {
    const [r, g, b] = colorFor(frame[i], stretch, palette);
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

export function subtractFrames(frame: Float32Array, reference: Float32Array): Float32Array {
  const out = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) out[i] = frame[i] - reference[i];
  return out;
}

export function addFrames(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames[0].length);
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    let count = 0;
    for (const frame of frames) {
      if (Number.isFinite(frame[i])) {
        sum += frame[i];
        count++;
      }
    }
    out[i] = count ? sum / count : NaN;
  }
  return out;
}
