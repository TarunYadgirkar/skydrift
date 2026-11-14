import { medianStack, resampleStamp, gridSky, type Grid, type Stamp } from "./resample";
import { findExposures, type Exposure } from "./skyIndex";
import { decodeCutoutBatch, NATIVE_SCALE_ARCSEC, type CutoutRequestItem } from "./spherex";

const BATCH_SIZE = 24;
const PARALLEL_BATCHES = 4;
const OVERSAMPLE = 2;
const USABLE_FRACTION = 0.7;

export interface EpochInfo {
  epoch: number;
  mjd: number;
  exposureCount: number;
}

export interface Session {
  grid: Grid;
  halfSizePx: number;
  exposures: Exposure[];
  epochs: EpochInfo[];
}

export interface BandFrames {
  detector: number;
  frames: (Float32Array | null)[];
  stamps: Stamp[];
}

export function gridFor(raDeg: number, decDeg: number, halfSizePx: number): Grid {
  const scaleArcsec = NATIVE_SCALE_ARCSEC / OVERSAMPLE;
  const size = Math.round(2 * halfSizePx * OVERSAMPLE * USABLE_FRACTION);
  return { raDeg, decDeg, size, scaleArcsec };
}

export async function openSession(raDeg: number, decDeg: number, halfSizePx: number): Promise<Session> {
  const exposures = await findExposures(raDeg, decDeg, halfSizePx);
  const epochCount = exposures.length ? exposures[exposures.length - 1].epoch + 1 : 0;
  const epochs: EpochInfo[] = Array.from({ length: epochCount }, (_, epoch) => {
    const members = exposures.filter((e) => e.epoch === epoch);
    return { epoch, mjd: members.reduce((sum, e) => sum + e.mjd, 0) / members.length, exposureCount: members.length };
  });
  return { grid: gridFor(raDeg, decDeg, halfSizePx), halfSizePx, exposures, epochs };
}

async function fetchBatch(items: Exposure[], half: number, signal: AbortSignal): Promise<Stamp[]> {
  const body: { items: CutoutRequestItem[]; half: number } = {
    items: items.map(({ key, x, y }) => ({ key, x, y })),
    half,
  };
  const response = await fetch("/api/cutouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error("SPHEREx images could not be fetched. Try again in a moment.");
  const { metas, pixels } = decodeCutoutBatch(await response.arrayBuffer());
  const stampLength = (2 * half) ** 2;
  const stamps: Stamp[] = [];
  metas.forEach((meta, i) => {
    if (!meta) return;
    stamps.push({
      meta,
      pixels: pixels.subarray(i * stampLength, (i + 1) * stampLength),
      detector: items[i].detector,
      epoch: items[i].epoch,
    });
  });
  return stamps;
}

export async function loadBand(
  session: Session,
  detector: number,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void,
): Promise<BandFrames> {
  const wanted = session.exposures.filter((e) => e.detector === detector);
  const batches: Exposure[][] = [];
  for (let i = 0; i < wanted.length; i += BATCH_SIZE) batches.push(wanted.slice(i, i + BATCH_SIZE));
  const stamps: Stamp[] = [];
  let loaded = 0;
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      stamps.push(...(await fetchBatch(batch, session.halfSizePx, signal)));
      loaded += batch.length;
      onProgress(loaded, wanted.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_BATCHES }, worker));
  return { detector, stamps, frames: stackEpochs(session, stamps) };
}

export function stackEpochs(session: Session, stamps: Stamp[]): (Float32Array | null)[] {
  const sky = gridSky(session.grid);
  return session.epochs.map(({ epoch }) => {
    const resampled = stamps
      .filter((stamp) => stamp.epoch === epoch)
      .map((stamp) => resampleStamp(stamp, sky))
      .filter((frame): frame is Float32Array => frame !== null);
    return resampled.length ? medianStack(resampled) : null;
  });
}
