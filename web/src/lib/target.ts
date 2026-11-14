export interface Target {
  name: string;
  raDeg: number;
  decDeg: number;
  pmRaMasYr: number;
  pmDecMasYr: number;
  epochYear: number;
}

export const SPHEREX_MID_YEAR = 2026.0;
export const CATALOG_EPOCH_YEAR = 2000.0;
const MAS_PER_DEG = 3.6e6;

const NUMBER = "[-+]?\\d+(?:\\.\\d+)?";
const DECIMAL_PAIR = new RegExp(`^\\s*(${NUMBER})\\s*[,\\s]\\s*(${NUMBER})\\s*$`);
const SEXAGESIMAL = new RegExp(
  `^\\s*(\\d{1,2})[h:\\s]\\s*(\\d{1,2})[m:\\s]\\s*(\\d+(?:\\.\\d+)?)s?\\s*,?\\s*([-+]?)(\\d{1,2})[d°:\\s]\\s*(\\d{1,2})[m':\\s]\\s*(\\d+(?:\\.\\d+)?)[s"]?\\s*$`,
  "i",
);

export function parseCoordinates(text: string): { raDeg: number; decDeg: number } | null {
  const decimal = DECIMAL_PAIR.exec(text);
  if (decimal) {
    const raDeg = Number(decimal[1]);
    const decDeg = Number(decimal[2]);
    return raDeg >= 0 && raDeg < 360 && Math.abs(decDeg) <= 90 ? { raDeg, decDeg } : null;
  }
  const sexagesimal = SEXAGESIMAL.exec(text);
  if (!sexagesimal) return null;
  const [, h, m, s, sign, d, arcmin, arcsec] = sexagesimal;
  const raDeg = (Number(h) + Number(m) / 60 + Number(s) / 3600) * 15;
  const decDeg = (sign === "-" ? -1 : 1) * (Number(d) + Number(arcmin) / 60 + Number(arcsec) / 3600);
  return raDeg < 360 && Math.abs(decDeg) <= 90 ? { raDeg, decDeg } : null;
}

export function positionAtYear(target: Target, year: number): { raDeg: number; decDeg: number } {
  const years = year - target.epochYear;
  const decDeg = target.decDeg + (target.pmDecMasYr * years) / MAS_PER_DEG;
  const raDeg = target.raDeg + (target.pmRaMasYr * years) / MAS_PER_DEG / Math.cos((target.decDeg * Math.PI) / 180);
  return { raDeg: ((raDeg % 360) + 360) % 360, decDeg };
}

export async function resolveTarget(text: string): Promise<Target> {
  const coordinates = parseCoordinates(text);
  if (coordinates) return { name: text.trim(), ...coordinates, pmRaMasYr: 0, pmDecMasYr: 0, epochYear: SPHEREX_MID_YEAR };
  const response = await fetch(`/api/resolve?name=${encodeURIComponent(text.trim())}`);
  if (response.status === 404) {
    throw new Error(`No object named "${text.trim()}" was found. Check the spelling, or enter RA and Dec in degrees.`);
  }
  if (!response.ok) throw new Error("The name lookup service did not respond. Enter RA and Dec in degrees instead.");
  return (await response.json()) as Target;
}

export function formatRa(raDeg: number): string {
  const hours = raDeg / 15;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const s = ((hours - h) * 60 - m) * 60;
  return `${pad(h)}h ${pad(m)}m ${s.toFixed(2).padStart(5, "0")}s`;
}

export function formatDec(decDeg: number): string {
  const sign = decDeg < 0 ? "−" : "+";
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d) * 60 - m) * 60;
  return `${sign}${pad(d)}° ${pad(m)}′ ${s.toFixed(1).padStart(4, "0")}″`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function mjdToDate(mjd: number): Date {
  return new Date((mjd - 40587) * 86400000);
}

export function mjdToYear(mjd: number): number {
  return 2000 + (mjd - 51544.5) / 365.25;
}
