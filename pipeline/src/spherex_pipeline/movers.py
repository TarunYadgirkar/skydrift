"""Source detection and stamp extraction shared by training and validation."""
from dataclasses import dataclass

import numpy as np
from scipy.ndimage import maximum_filter

DETECTION_SIGMA = 6.0
PEAK_WINDOW = 5
CENTROID_HALF = 3
STAMP_HALF = 7
CROP_HALF = 12
STATIC_MATCH_RADIUS_PX = 1.5


@dataclass(frozen=True)
class Source:
    x: float
    y: float
    peak: float
    snr: float


def noise_sigma(frame: np.ndarray) -> float:
    finite = frame[np.isfinite(frame)]
    return float(1.4826 * np.median(np.abs(finite - np.median(finite)))) or 1e-6


def detect_sources(frame: np.ndarray, margin: int = CROP_HALF) -> list[Source]:
    clean = np.nan_to_num(frame, nan=0.0)
    sigma = noise_sigma(frame)
    peaks = (clean == maximum_filter(clean, size=PEAK_WINDOW)) & (clean > DETECTION_SIGMA * sigma)
    sources: list[Source] = []
    size = frame.shape[0]
    for row, col in zip(*np.nonzero(peaks)):
        if not (margin <= row < size - margin and margin <= col < size - margin):
            continue
        window = np.clip(clean[row - CENTROID_HALF:row + CENTROID_HALF + 1, col - CENTROID_HALF:col + CENTROID_HALF + 1], 0, None)
        total = window.sum()
        if total <= 0:
            continue
        offsets = np.arange(-CENTROID_HALF, CENTROID_HALF + 1)
        x = col + float((window.sum(axis=0) * offsets).sum() / total)
        y = row + float((window.sum(axis=1) * offsets).sum() / total)
        sources.append(Source(x, y, float(clean[row, col]), float(clean[row, col] / sigma)))
    return sources


def crop(frame: np.ndarray, x: float, y: float, half: int) -> np.ndarray | None:
    col, row = int(round(x)), int(round(y))
    if row - half < 0 or col - half < 0 or row + half + 1 > frame.shape[0] or col + half + 1 > frame.shape[1]:
        return None
    return np.nan_to_num(frame[row - half:row + half + 1, col - half:col + half + 1], nan=0.0)


def nearest(source: Source, others: list[Source]) -> tuple[Source | None, float]:
    if not others:
        return None, np.inf
    distances = [np.hypot(o.x - source.x, o.y - source.y) for o in others]
    best = int(np.argmin(distances))
    return others[best], float(distances[best])
