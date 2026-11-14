import { CATALOG_EPOCH_YEAR, type Target } from "@/lib/target";

const SESAME_URL = "https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?";
const MAX_NAME_LENGTH = 80;
const NAME_PATTERN = /^[\p{L}\p{N} .+\-_'*()\[\]]+$/u;

function tagValue(xml: string, tag: string): number | null {
  const match = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
}

export async function GET(request: Request): Promise<Response> {
  const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
  if (!name || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
    return Response.json({ error: "Enter an object name of up to 80 letters, digits and spaces." }, { status: 400 });
  }
  let xml: string;
  try {
    const upstream = await fetch(SESAME_URL + encodeURIComponent(name), { signal: AbortSignal.timeout(15000) });
    if (!upstream.ok) throw new Error(`Sesame returned ${upstream.status}`);
    xml = await upstream.text();
  } catch (error) {
    console.error("resolve: name lookup failed", error);
    return Response.json({ error: "The name lookup service did not respond." }, { status: 502 });
  }
  const raDeg = tagValue(xml, "jradeg");
  const decDeg = tagValue(xml, "jdedeg");
  if (raDeg === null || decDeg === null) return Response.json({ error: "No object with that name." }, { status: 404 });
  const target: Target = {
    name,
    raDeg,
    decDeg,
    pmRaMasYr: tagValue(xml, "pmRA") ?? 0,
    pmDecMasYr: tagValue(xml, "pmDE") ?? 0,
    epochYear: CATALOG_EPOCH_YEAR,
  };
  return Response.json(target, { headers: { "Cache-Control": "public, max-age=86400" } });
}
