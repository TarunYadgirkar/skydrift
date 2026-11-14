import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np

from .sky_index import INDEX_DIR

RING_DEG = 3.0
KEY_RE = re.compile(
    r"^(?P<rel>[^/]+)/level2/(?P<week>[^/]+)/(?P<ver>[^/]+)/(?P<det>\d)/"
    r"level2_(?P=week)_(?P<obs>\d{4})_(?P<exp>\d)D(?P=det)_spx_(?P=ver)\.fits$"
)
ROW = np.dtype([
    ("ra", "<f8"), ("dec", "<f8"), ("cd", "<f4", 4), ("crpix", "<f4", 2), ("mjd", "<f8"),
    ("dir", "<u2"), ("obs", "<u2"), ("exp", "u1"), ("det", "u1"), ("pad", "<u2"),
])


def cells_in_ring(ring: int) -> int:
    center = -90.0 + (ring + 0.5) * RING_DEG
    return max(1, round(360.0 * np.cos(np.radians(center)) / RING_DEG))


def main() -> None:
    out_dir = Path(sys.argv[1])
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    parts = [np.load(p) for p in sorted(INDEX_DIR.glob("*.npz"))]
    parts = [p for p in parts if len(p["key"])]
    keys = np.concatenate([p["key"] for p in parts])
    wcs = np.concatenate([p["wcs"] for p in parts])

    matches = [KEY_RE.match(k) for k in keys]
    unparsed = [k for k, m in zip(keys, matches) if m is None]
    if unparsed:
        raise SystemExit(f"{len(unparsed)} keys do not fit the naming pattern, e.g. {unparsed[0]}")

    dirs: dict[str, int] = {}
    rows = np.zeros(len(keys), dtype=ROW)
    rows["ra"], rows["dec"], rows["mjd"] = wcs[:, 0], wcs[:, 1], wcs[:, 10]
    rows["crpix"] = wcs[:, 2:4]
    rows["cd"] = (wcs[:, 4:8].reshape(-1, 2, 2) * wcs[:, 8:10][:, None, :]).reshape(-1, 4)
    for i, m in enumerate(matches):
        rows["dir"][i] = dirs.setdefault(f"{m['rel']}|{m['week']}|{m['ver']}", len(dirs))
        rows["obs"][i], rows["exp"][i], rows["det"][i] = int(m["obs"]), int(m["exp"]), int(m["det"])

    ring = np.clip(((wcs[:, 1] + 90.0) / RING_DEG).astype(int), 0, int(180 / RING_DEG) - 1)
    per_ring = np.array([cells_in_ring(r) for r in range(int(180 / RING_DEG))])
    cell = np.minimum((np.mod(wcs[:, 0], 360.0) / 360.0 * per_ring[ring]).astype(int), per_ring[ring] - 1)
    shard_id = ring * 1000 + cell
    order = np.argsort(shard_id, kind="stable")
    boundaries = np.flatnonzero(np.diff(shard_id[order])) + 1
    shards = []
    for chunk in np.split(order, boundaries):
        name = f"{ring[chunk[0]]}_{cell[chunk[0]]}"
        rows[chunk].tofile(out_dir / f"{name}.bin")
        shards.append(name)

    manifest = {"ringDeg": RING_DEG, "rowBytes": ROW.itemsize, "dirs": list(dirs), "shards": shards, "rows": len(keys)}
    (out_dir / "manifest.json").write_text(json.dumps(manifest))
    print(f"{len(keys)} rows in {len(shards)} shards, {sum(f.stat().st_size for f in out_dir.iterdir()) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
