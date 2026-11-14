import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from astropy.io import fits

BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
KEY = "dr1/spectral_wcs/cal-swcs-v5-2026-191/{d}/spectral_wcs_D{d}_spx_cal-swcs-v5-2026-191.fits"
DATA_DIR = Path(__file__).resolve().parents[2] / "data"
GRID = 52
DETECTOR_SIZE = 2040


def main() -> None:
    out_path = Path(sys.argv[1])
    step = (DETECTOR_SIZE - 1) / (GRID - 1)
    sample = np.round(np.arange(GRID) * step).astype(int)
    detectors = {}
    for d in range(1, 7):
        local = DATA_DIR / f"spectral_wcs_D{d}.fits"
        if not local.exists():
            urllib.request.urlretrieve(BUCKET + KEY.format(d=d), local)
        with fits.open(local) as hdul:
            images = [h for h in hdul if h.data is not None and h.data.ndim == 2]
            print(d, [(h.name, h.data.shape) for h in images], flush=True)
            wave = images[0].data[np.ix_(sample, sample)]
        detectors[str(d)] = [round(float(v), 5) for v in wave.ravel()]
    out_path.write_text(json.dumps({"grid": GRID, "step": step, "detectors": detectors}))


if __name__ == "__main__":
    main()
