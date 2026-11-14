import type { GaiaStar } from "@/lib/gaia";

const GAIA_TAP_URL = "https://gea.esac.esa.int/tap-server/tap/sync";
const MAX_RADIUS_DEG = 0.25;
const MAX_STARS = 400;
const FAINT_LIMIT_MAG = 19;

function readNumber(params: URLSearchParams, name: string, min: number, max: number): number | null {
  const value = Number(params.get(name));
  return params.has(name) && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const ra = readNumber(params, "ra", 0, 360);
  const dec = readNumber(params, "dec", -90, 90);
  const radius = readNumber(params, "radius", 0.001, MAX_RADIUS_DEG);
  if (ra === null || dec === null || radius === null) {
    return Response.json({ error: "Send ra, dec and a radius of up to 0.25 degrees." }, { status: 400 });
  }
  const query =
    `SELECT TOP ${MAX_STARS} source_id, ra, dec, pmra, pmdec, phot_g_mean_mag FROM gaiadr3.gaia_source ` +
    `WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${radius})) ` +
    `AND phot_g_mean_mag < ${FAINT_LIMIT_MAG} ORDER BY phot_g_mean_mag`;
  const url = `${GAIA_TAP_URL}?${new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "json", QUERY: query })}`;
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!upstream.ok) throw new Error(`Gaia archive returned ${upstream.status}`);
    const { data } = (await upstream.json()) as { data: (string | number | null)[][] };
    const stars: GaiaStar[] = data.map(([id, raDeg, decDeg, pmRa, pmDec, gMag]) => ({
      id: String(id),
      raDeg: Number(raDeg),
      decDeg: Number(decDeg),
      pmRaMasYr: Number(pmRa ?? 0),
      pmDecMasYr: Number(pmDec ?? 0),
      gMag: Number(gMag),
    }));
    return Response.json(stars, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch (error) {
    console.error("gaia: catalog query failed", error);
    return Response.json({ error: "The Gaia catalog did not respond." }, { status: 502 });
  }
}
