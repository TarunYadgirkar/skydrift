from dataclasses import dataclass
from pathlib import Path

import numpy as np

INDEX_DIR = Path(__file__).resolve().parents[2] / "index"
DETECTOR_SIZE = 2040
MAX_FOOTPRINT_RADIUS_DEG = 3.0
EPOCH_GAP_DAYS = 45.0
MAX_EPOCH_SPAN_DAYS = 45.0


@dataclass(frozen=True)
class Exposure:
    key: str
    detector: int
    mjd: float
    x: float
    y: float
    epoch: int


class SkyIndex:
    def __init__(self, index_dir: Path = INDEX_DIR) -> None:
        parts = [np.load(path) for path in sorted(index_dir.glob("*.npz"))]
        parts = [p for p in parts if len(p["key"])]
        self.keys = np.concatenate([p["key"] for p in parts])
        self.detector = np.concatenate([p["detector"] for p in parts])
        wcs = np.concatenate([p["wcs"] for p in parts])
        self.crval = np.radians(wcs[:, 0:2])
        self.crpix = wcs[:, 2:4]
        pc = wcs[:, 4:8].reshape(-1, 2, 2)
        self.cd_inverse = np.linalg.inv(pc * wcs[:, 8:10][:, None, :])
        self.mjd = wcs[:, 10]
        self.unit = _unit_vectors(self.crval[:, 0], self.crval[:, 1])

    def __len__(self) -> int:
        return len(self.keys)

    def find(self, ra_deg: float, dec_deg: float, half_size_px: float) -> list[Exposure]:
        ra, dec = np.radians(ra_deg), np.radians(dec_deg)
        target = _unit_vectors(np.array([ra]), np.array([dec]))[0]
        near = np.flatnonzero(self.unit @ target > np.cos(np.radians(MAX_FOOTPRINT_RADIUS_DEG)))
        xi, eta = _gnomonic(ra, dec, self.crval[near, 0], self.crval[near, 1])
        offsets = np.einsum("nij,nj->ni", self.cd_inverse[near], np.stack([xi, eta], axis=1))
        pixels = offsets + self.crpix[near] - 1.0
        inside = np.all((pixels >= half_size_px) & (pixels <= DETECTOR_SIZE - 1 - half_size_px), axis=1)
        chosen = near[inside]
        order = np.argsort(self.mjd[chosen])
        chosen, pixels = chosen[order], pixels[inside][order]
        epochs = _epoch_labels(self.mjd[chosen])
        return [
            Exposure(str(self.keys[i]), int(self.detector[i]), float(self.mjd[i]), float(px[0]), float(px[1]), int(e))
            for i, px, e in zip(chosen, pixels, epochs)
        ]


def _unit_vectors(ra: np.ndarray, dec: np.ndarray) -> np.ndarray:
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=1)


def _gnomonic(ra: float, dec: float, ra0: np.ndarray, dec0: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    cos_c = np.sin(dec0) * np.sin(dec) + np.cos(dec0) * np.cos(dec) * np.cos(ra - ra0)
    xi = np.cos(dec) * np.sin(ra - ra0) / cos_c
    eta = (np.cos(dec0) * np.sin(dec) - np.sin(dec0) * np.cos(dec) * np.cos(ra - ra0)) / cos_c
    return np.degrees(xi), np.degrees(eta)


def _epoch_labels(sorted_mjd: np.ndarray) -> np.ndarray:
    labels = np.zeros(len(sorted_mjd), dtype=int)
    epoch = 0
    start = sorted_mjd[0] if len(sorted_mjd) else 0.0
    for i in range(1, len(sorted_mjd)):
        if sorted_mjd[i] - sorted_mjd[i - 1] > EPOCH_GAP_DAYS or sorted_mjd[i] - start >= MAX_EPOCH_SPAN_DAYS:
            epoch += 1
            start = sorted_mjd[i]
        labels[i] = epoch
    return labels
