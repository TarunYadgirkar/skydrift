import {
  BUCKET_URL,
  DETECTOR_SIZE,
  KEY_PATTERN,
  MAX_CUTOUTS_PER_REQUEST,
  MAX_HALF_SIZE,
  type CutoutMeta,
  type CutoutRequestItem,
} from "@/lib/spherex";
import { wcsFromCards } from "@/lib/wcs";

const CARD = 80;
const BLOCK = 2880;
const HEADER_BYTES = 31680;
const LONG_HEADER_BYTES = 60480;
const BYTES_PER_PIXEL = 4;
const RETRIES = 3;

interface ParsedHeader {
  cards: Map<string, number>;
  dataOffset: number;
}

async function readRange(key: string, start: number, end: number): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(BUCKET_URL + key, { headers: { Range: `bytes=${start}-${end}` } });
      if (!response.ok) throw new Error(`Bucket returned ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (attempt === RETRIES - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    }
  }
}

function headerEnd(raw: Uint8Array, start: number): number {
  for (let offset = start; offset + 8 <= raw.length; offset += CARD) {
    if (raw[offset] === 69 && raw[offset + 1] === 78 && raw[offset + 2] === 68 && raw[offset + 3] === 32) {
      return (Math.floor(offset / BLOCK) + 1) * BLOCK;
    }
  }
  return -1;
}

function parseHeader(raw: Uint8Array): ParsedHeader | null {
  const primaryEnd = headerEnd(raw, 0);
  const imageEnd = primaryEnd < 0 ? -1 : headerEnd(raw, primaryEnd);
  if (imageEnd < 0) return null;
  const text = new TextDecoder("ascii").decode(raw.subarray(primaryEnd, imageEnd));
  const cards = new Map<string, number>();
  for (let offset = 0; offset < text.length; offset += CARD) {
    const card = text.slice(offset, offset + CARD);
    if (card[8] !== "=") continue;
    const value = Number(card.slice(10).split("/")[0].trim());
    if (Number.isFinite(value)) cards.set(card.slice(0, 8).trim(), value);
  }
  return { cards, dataOffset: imageEnd };
}

async function loadHeader(key: string): Promise<ParsedHeader> {
  const parsed =
    parseHeader(await readRange(key, 0, HEADER_BYTES - 1)) ??
    parseHeader(await readRange(key, 0, LONG_HEADER_BYTES - 1));
  if (!parsed) throw new Error("FITS header is longer than expected");
  return parsed;
}

async function cutOne(item: CutoutRequestItem, half: number): Promise<{ meta: CutoutMeta; pixels: Uint8Array }> {
  const { cards, dataOffset } = await loadHeader(item.key);
  const size = 2 * half;
  const clampStart = (center: number) => Math.min(Math.max(Math.round(center) - half, 0), DETECTOR_SIZE - size);
  const x0 = clampStart(item.x);
  const y0 = clampStart(item.y);
  const rowBytes = DETECTOR_SIZE * BYTES_PER_PIXEL;
  const start = dataOffset + y0 * rowBytes;
  const rows = await readRange(item.key, start, start + size * rowBytes - 1);
  const pixels = new Uint8Array(size * size * BYTES_PER_PIXEL);
  for (let row = 0; row < size; row++) {
    const source = row * rowBytes + x0 * BYTES_PER_PIXEL;
    pixels.set(rows.subarray(source, source + size * BYTES_PER_PIXEL), row * size * BYTES_PER_PIXEL);
  }
  Buffer.from(pixels.buffer).swap32();
  const meta: CutoutMeta = {
    key: item.key,
    x0,
    y0,
    size,
    wcs: wcsFromCards(cards),
    psfFwhmArcsec: cards.get("PSF_FWHM") ?? 7,
    mjd: cards.get("MJD-AVG") ?? 0,
  };
  return { meta, pixels };
}

function isValidItem(value: unknown): value is CutoutRequestItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.key === "string" &&
    KEY_PATTERN.test(item.key) &&
    typeof item.x === "number" &&
    typeof item.y === "number" &&
    Number.isFinite(item.x) &&
    Number.isFinite(item.y)
  );
}

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const { items, half } = (body ?? {}) as { items?: unknown; half?: unknown };
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > MAX_CUTOUTS_PER_REQUEST ||
    !items.every(isValidItem) ||
    typeof half !== "number" ||
    !Number.isInteger(half) ||
    half < 4 ||
    half > MAX_HALF_SIZE
  ) {
    return Response.json({ error: "Send 1 to 32 cutout items and a half size from 4 to 64 pixels." }, { status: 400 });
  }

  const settled = await Promise.allSettled(items.map((item) => cutOne(item, half)));
  const failures = settled.filter((result) => result.status === "rejected");
  if (failures.length) console.error(`cutouts: ${failures.length}/${items.length} failed`, failures[0].reason);

  const metas = settled.map((result) => (result.status === "fulfilled" ? result.value.meta : null));
  const metaBytes = new TextEncoder().encode(JSON.stringify(metas));
  const dataStart = Math.ceil((4 + metaBytes.length) / 4) * 4;
  const stampBytes = (2 * half) ** 2 * BYTES_PER_PIXEL;
  const out = new Uint8Array(dataStart + items.length * stampBytes);
  new DataView(out.buffer).setUint32(0, metaBytes.length, true);
  out.set(metaBytes, 4);
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") out.set(result.value.pixels, dataStart + index * stampBytes);
  });
  return new Response(out, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
}
