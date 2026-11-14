export interface GaiaStar {
  id: string;
  raDeg: number;
  decDeg: number;
  pmRaMasYr: number;
  pmDecMasYr: number;
  gMag: number;
}

export const GAIA_EPOCH_YEAR = 2016.0;
const MAS_PER_DEG = 3.6e6;

export function gaiaPositionAt(star: GaiaStar, year: number): { raDeg: number; decDeg: number } {
  const years = year - GAIA_EPOCH_YEAR;
  return {
    raDeg: star.raDeg + (star.pmRaMasYr * years) / MAS_PER_DEG / Math.cos((star.decDeg * Math.PI) / 180),
    decDeg: star.decDeg + (star.pmDecMasYr * years) / MAS_PER_DEG,
  };
}

export function totalMotionMasYr(star: GaiaStar): number {
  return Math.hypot(star.pmRaMasYr, star.pmDecMasYr);
}

export async function fetchGaiaStars(raDeg: number, decDeg: number, radiusDeg: number, signal?: AbortSignal): Promise<GaiaStar[]> {
  const params = new URLSearchParams({ ra: raDeg.toFixed(4), dec: decDeg.toFixed(4), radius: radiusDeg.toFixed(3) });
  const response = await fetch(`/api/gaia?${params}`, { signal });
  if (!response.ok) throw new Error("The Gaia catalog did not respond, so known stars are not marked.");
  return (await response.json()) as GaiaStar[];
}
