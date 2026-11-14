import type { Wcs } from "./wcs";

export const BUCKET_URL = "https://nasa-irsa-spherex.s3.amazonaws.com/";
export const DETECTOR_SIZE = 2040;
export const NATIVE_SCALE_ARCSEC = 6.15;
export const PIXEL_SOLID_ANGLE_SR = 8.9e-10;
export const KEY_PATTERN = /^(dr1|qr3)\/level2\/[A-Za-z0-9_\-]+\/[A-Za-z0-9_\-]+\/[1-6]\/level2_[A-Za-z0-9_\-]+\.fits$/;
export const MAX_CUTOUTS_PER_REQUEST = 32;
export const MAX_HALF_SIZE = 64;

export interface Band {
  detector: number;
  label: string;
  minMicron: number;
  maxMicron: number;
}

export const BANDS: Band[] = [
  { detector: 1, label: "Band 1", minMicron: 0.75, maxMicron: 1.11 },
  { detector: 2, label: "Band 2", minMicron: 1.1, maxMicron: 1.65 },
  { detector: 3, label: "Band 3", minMicron: 1.63, maxMicron: 2.44 },
  { detector: 4, label: "Band 4", minMicron: 2.4, maxMicron: 3.85 },
  { detector: 5, label: "Band 5", minMicron: 3.81, maxMicron: 4.44 },
  { detector: 6, label: "Band 6", minMicron: 4.4, maxMicron: 5.01 },
];

export interface CutoutRequestItem {
  key: string;
  x: number;
  y: number;
}

export interface CutoutMeta {
  key: string;
  x0: number;
  y0: number;
  size: number;
  wcs: Wcs;
  psfFwhmArcsec: number;
  mjd: number;
}

export interface CutoutBatch {
  metas: (CutoutMeta | null)[];
  pixels: Float32Array;
}

export function decodeCutoutBatch(buffer: ArrayBuffer): CutoutBatch {
  const view = new DataView(buffer);
  const metaLength = view.getUint32(0, true);
  const metaBytes = new Uint8Array(buffer, 4, metaLength);
  const metas = JSON.parse(new TextDecoder().decode(metaBytes)) as (CutoutMeta | null)[];
  const dataStart = Math.ceil((4 + metaLength) / 4) * 4;
  return { metas, pixels: new Float32Array(buffer.slice(dataStart)) };
}
