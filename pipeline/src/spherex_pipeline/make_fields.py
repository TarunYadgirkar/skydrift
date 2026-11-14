"""Download epoch-stacked SPHEREx frames for random sky positions (training and validation fields)."""
import argparse
import asyncio
from pathlib import Path

import numpy as np

from .cutout import fetch_cutouts
from .sky_index import SkyIndex
from .stack import Grid, median_stack, resample

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "fields"
HALF_SIZE_PX = 32
GRID_SIZE = 90
GRID_SCALE_ARCSEC = 3.075
MIN_EXPOSURES_PER_EPOCH = 4
BANDS = (2, 3, 4, 5)


def stack_field(index: SkyIndex, ra: float, dec: float, band: int) -> dict | None:
    exposures = [e for e in index.find(ra, dec, HALF_SIZE_PX) if e.detector == band]
    epochs = sorted({e.epoch for e in exposures})
    usable = [k for k in epochs if sum(e.epoch == k for e in exposures) >= MIN_EXPOSURES_PER_EPOCH]
    if len(usable) < 2:
        return None
    exposures = [e for e in exposures if e.epoch in usable]
    cutouts = asyncio.run(fetch_cutouts(exposures, HALF_SIZE_PX))
    grid = Grid(ra, dec, GRID_SIZE, GRID_SCALE_ARCSEC)
    sky = grid.sky()
    frames, mjds, fwhm = [], [], []
    for k in usable:
        members = [c for c in cutouts if c.exposure.epoch == k]
        resampled = [r for r in (resample(c, grid, sky) for c in members) if r is not None]
        if len(resampled) < MIN_EXPOSURES_PER_EPOCH:
            return None
        frames.append(median_stack(resampled))
        mjds.append(np.mean([c.exposure.mjd for c in members]))
        fwhm.append(np.median([c.psf_fwhm_arcsec for c in members]))
    return {"frames": np.stack(frames).astype(np.float32), "mjd": np.array(mjds), "fwhm": np.array(fwhm), "ra": ra, "dec": dec, "band": band}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--positions", type=Path, help="CSV of name,ra,dec to fetch instead of random positions")
    parser.add_argument("--out", type=Path, default=DATA_DIR)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    index = SkyIndex()
    rng = np.random.default_rng(args.seed)

    if args.positions:
        rows = [line.split(",") for line in args.positions.read_text().splitlines()[1:] if line.strip()]
        jobs = [(name, float(ra), float(dec), band) for name, ra, dec in rows for band in BANDS]
    else:
        jobs = []

    saved = 0
    attempt = 0
    while saved < args.count and (not args.positions or attempt < len(jobs)):
        if args.positions:
            name, ra, dec, band = jobs[attempt]
        else:
            ra = float(rng.uniform(0, 360))
            dec = float(np.degrees(np.arcsin(rng.uniform(-1, 1))))
            band = int(rng.choice(BANDS))
            name = f"s{args.seed}_{attempt:05d}"
        attempt += 1
        path = args.out / f"{name}_b{band}.npz"
        if path.exists():
            saved += 1
            continue
        try:
            field = stack_field(index, ra, dec, band)
        except Exception as error:  # network hiccups should not stop a long run
            print(f"skip {name}: {error}", flush=True)
            continue
        if field is None:
            continue
        np.savez_compressed(path, **field)
        saved += 1
        if saved % 20 == 0:
            print(f"{saved} fields after {attempt} attempts", flush=True)
    print(f"done: {saved} fields", flush=True)


if __name__ == "__main__":
    main()
