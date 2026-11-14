import warnings
from dataclasses import dataclass

import numpy as np
from astropy.stats import sigma_clipped_stats
from scipy.ndimage import map_coordinates

from .cutout import Cutout

NATIVE_SCALE_ARCSEC = 6.15
MIN_VALID_FRACTION = 0.5


@dataclass(frozen=True)
class Grid:
    ra_deg: float
    dec_deg: float
    size_px: int
    scale_arcsec: float

    def sky(self) -> tuple[np.ndarray, np.ndarray]:
        half = (self.size_px - 1) / 2.0
        step = np.radians(self.scale_arcsec / 3600.0)
        cols, rows = np.meshgrid(np.arange(self.size_px), np.arange(self.size_px))
        xi = -(cols - half) * step
        eta = (half - rows) * step
        ra0, dec0 = np.radians(self.ra_deg), np.radians(self.dec_deg)
        rho = np.hypot(xi, eta)
        c = np.arctan(rho)
        safe_rho = np.where(rho == 0, 1.0, rho)
        dec = np.arcsin(np.cos(c) * np.sin(dec0) + eta * np.sin(c) * np.cos(dec0) / safe_rho)
        ra = ra0 + np.arctan2(xi * np.sin(c), rho * np.cos(dec0) * np.cos(c) - eta * np.sin(dec0) * np.sin(c))
        return np.degrees(ra), np.degrees(dec)


def resample(cutout: Cutout, grid: Grid, sky: tuple[np.ndarray, np.ndarray]) -> np.ndarray | None:
    x, y = cutout.wcs.all_world2pix(sky[0], sky[1], 0)
    data = cutout.data
    _, background, _ = sigma_clipped_stats(data[np.isfinite(data)], sigma=3.0, maxiters=3)
    filled = np.where(np.isfinite(data), data - background, 0.0)
    weight = np.isfinite(data).astype(np.float32)
    coords = np.array([y - cutout.y0, x - cutout.x0])
    image = map_coordinates(filled, coords, order=1, cval=0.0)
    coverage = map_coordinates(weight, coords, order=1, cval=0.0)
    if (coverage > 0.99).mean() < MIN_VALID_FRACTION:
        return None
    return np.where(coverage > 0.99, image, np.nan).astype(np.float32)


def median_stack(frames: list[np.ndarray]) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(np.stack(frames), axis=0)
