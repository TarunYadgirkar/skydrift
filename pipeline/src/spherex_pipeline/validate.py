"""Check the mover detector on real stars whose motion Gaia has measured."""
import json
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import torch

from .make_fields import GRID_SCALE_ARCSEC, GRID_SIZE, stack_field
from .movers import CROP_HALF, crop, detect_sources
from .sky_index import SkyIndex
from .train import MODEL_DIR, MoverNet, build_input, translate

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "data" / "validation.json"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
GAIA_EPOCH_YEAR = 2016.0
MIN_PM_MAS_YR = 1000
MAX_STARS = 140
BAND = 3
MATCH_RADIUS_PX = 3.0
MIN_SHIFT_PX = 0.5
STATIC_SHIFT_PX = 1.0
QUERY = (
    f"SELECT TOP 600 source_id, ra, dec, pmra, pmdec, phot_g_mean_mag FROM gaiadr3.gaia_source "
    f"WHERE pm > {MIN_PM_MAS_YR} AND phot_g_mean_mag BETWEEN 10.5 AND 15 ORDER BY random_index"
)


def gaia_fast_movers() -> list[dict]:
    url = GAIA_TAP + "?" + urllib.parse.urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": QUERY})
    rows = json.load(urllib.request.urlopen(url, timeout=120))["data"]
    return [dict(zip(("id", "ra", "dec", "pmra", "pmdec", "g"), row)) for row in rows]


def position_at(star: dict, year: float) -> tuple[float, float]:
    years = year - GAIA_EPOCH_YEAR
    dec = star["dec"] + star["pmdec"] * years / 3.6e6
    ra = star["ra"] + star["pmra"] * years / 3.6e6 / np.cos(np.radians(star["dec"]))
    return ra, dec


def mjd_to_year(mjd: float) -> float:
    return 2000 + (mjd - 51544.5) / 365.25


def predict(model: MoverNet, first: np.ndarray, last: np.ndarray, sources: list) -> np.ndarray:
    pairs, fractions = [], []
    for s in sources:
        a, b = crop(first, s.x, s.y, CROP_HALF), crop(last, s.x, s.y, CROP_HALF)
        pairs.append(np.stack([a, b]))
        fractions.append([round(s.x) - s.x, round(s.y) - s.y])
    pairs_t = torch.tensor(np.array(pairs), dtype=torch.float32)
    shift = torch.tensor(np.array(fractions), dtype=torch.float32)
    with torch.no_grad():
        out = model(build_input(translate(pairs_t[:, 0:1], shift), translate(pairs_t[:, 1:2], shift)))
    return out.numpy()


def main() -> None:
    index = SkyIndex()
    model = MoverNet()
    model.load_state_dict(torch.load(MODEL_DIR / "movernet.pt"))
    model.eval()
    threshold = json.loads((MODEL_DIR / "metrics.json").read_text())["threshold"]
    results, bystanders_checked, bystanders_flagged = [], 0, 0
    for star in gaia_fast_movers():
        if len(results) >= MAX_STARS:
            break
        ra, dec = position_at(star, 2026.0)
        try:
            field = stack_field(index, ra, dec, BAND)
        except Exception as error:
            print("skip", star["id"], error, flush=True)
            continue
        if field is None:
            continue
        first, last = field["frames"][0], field["frames"][-1]
        baseline = (field["mjd"][-1] - field["mjd"][0]) / 365.25
        sources = [s for s in detect_sources(first) if crop(first, s.x, s.y, CROP_HALF) is not None]
        if not sources or baseline < 0.3:
            continue
        out = predict(model, first, last, sources)
        prob = 1 / (1 + np.exp(-out[:, 0]))
        still = np.hypot(out[:, 1], out[:, 2]) < STATIC_SHIFT_PX
        offset = np.median(out[still, 1:], axis=0) if still.any() else np.zeros(2)
        shift = out[:, 1:] - offset
        flagged = (prob > threshold) & (np.hypot(shift[:, 0], shift[:, 1]) >= MIN_SHIFT_PX)

        star_ra, star_dec = position_at(star, mjd_to_year(field["mjd"][0]))
        half = (GRID_SIZE - 1) / 2
        x = half - (star_ra - ra) * np.cos(np.radians(dec)) * 3600 / GRID_SCALE_ARCSEC
        y = half - (star_dec - dec) * 3600 / GRID_SCALE_ARCSEC
        distance = np.array([np.hypot(s.x - x, s.y - y) for s in sources])
        target = int(np.argmin(distance))
        if distance[target] > MATCH_RADIUS_PX:
            continue
        gaia_speed = float(np.hypot(star["pmra"], star["pmdec"]) / 1000)
        measured = float(np.hypot(*shift[target]) * GRID_SCALE_ARCSEC / baseline)
        results.append({
            "g": star["g"], "gaia_arcsec_yr": gaia_speed, "measured_arcsec_yr": measured, "baseline_yr": float(baseline),
            "expected_shift_px": gaia_speed * baseline / GRID_SCALE_ARCSEC, "detected": bool(flagged[target]),
        })
        others = np.arange(len(sources)) != target
        bystanders_checked += int(others.sum())
        bystanders_flagged += int(flagged[others].sum())
        if len(results) % 10 == 0:
            print(len(results), "stars", flush=True)

    detected = [r for r in results if r["detected"]]
    resolvable = [r for r in results if r["expected_shift_px"] >= MIN_SHIFT_PX]
    summary = {
        "stars": len(results),
        "recovered": len(detected),
        "resolvable_stars": len(resolvable),
        "resolvable_recovered": sum(r["detected"] for r in resolvable),
        "median_speed_error_fraction": float(np.median([abs(r["measured_arcsec_yr"] - r["gaia_arcsec_yr"]) / r["gaia_arcsec_yr"] for r in detected])) if detected else None,
        "bystanders_checked": bystanders_checked,
        "bystanders_flagged": bystanders_flagged,
        "results": results,
    }
    OUT_PATH.write_text(json.dumps(summary, indent=1))
    print({k: v for k, v in summary.items() if k != "results"}, flush=True)


if __name__ == "__main__":
    main()
