export interface Wcs {
  crval: [number, number];
  crpix: [number, number];
  cd: [number, number, number, number];
  ap: number[][];
  bp: number[][];
}

const DEG = Math.PI / 180;

export function wcsFromCards(cards: Map<string, number>): Wcs {
  const need = (key: string): number => {
    const value = cards.get(key);
    if (value === undefined) throw new Error(`FITS header is missing ${key}`);
    return value;
  };
  const cdelt1 = cards.get("CDELT1") ?? 1;
  const cdelt2 = cards.get("CDELT2") ?? 1;
  return {
    crval: [need("CRVAL1"), need("CRVAL2")],
    crpix: [need("CRPIX1"), need("CRPIX2")],
    cd: [need("PC1_1") * cdelt1, need("PC1_2") * cdelt1, need("PC2_1") * cdelt2, need("PC2_2") * cdelt2],
    ap: sipMatrix(cards, "AP"),
    bp: sipMatrix(cards, "BP"),
  };
}

function sipMatrix(cards: Map<string, number>, prefix: string): number[][] {
  const order = cards.get(`${prefix}_ORDER`) ?? 0;
  return Array.from({ length: order + 1 }, (_, p) =>
    Array.from({ length: order + 1 }, (_, q) => cards.get(`${prefix}_${p}_${q}`) ?? 0),
  );
}

function sipSum(matrix: number[][], u: number, v: number): number {
  let total = 0;
  let up = 1;
  for (const row of matrix) {
    let vq = 1;
    for (const coefficient of row) {
      total += coefficient * up * vq;
      vq *= v;
    }
    up *= u;
  }
  return total;
}

export interface Projector {
  (raDeg: number, decDeg: number): [number, number];
}

export function worldToPixel(wcs: Wcs): Projector {
  const ra0 = wcs.crval[0] * DEG;
  const dec0 = wcs.crval[1] * DEG;
  const sin0 = Math.sin(dec0);
  const cos0 = Math.cos(dec0);
  const [a, b, c, d] = wcs.cd;
  const det = a * d - b * c;
  return (raDeg, decDeg) => {
    const ra = raDeg * DEG;
    const dec = decDeg * DEG;
    const sinDec = Math.sin(dec);
    const cosDec = Math.cos(dec);
    const cosDra = Math.cos(ra - ra0);
    const cosC = sin0 * sinDec + cos0 * cosDec * cosDra;
    const xi = (cosDec * Math.sin(ra - ra0)) / cosC / DEG;
    const eta = (cos0 * sinDec - sin0 * cosDec * cosDra) / cosC / DEG;
    const u = (d * xi - b * eta) / det;
    const v = (-c * xi + a * eta) / det;
    return [
      wcs.crpix[0] - 1 + u + sipSum(wcs.ap, u, v),
      wcs.crpix[1] - 1 + v + sipSum(wcs.bp, u, v),
    ];
  };
}
