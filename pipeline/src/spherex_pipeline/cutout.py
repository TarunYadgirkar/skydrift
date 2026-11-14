import asyncio
import logging
from dataclasses import dataclass

import aiohttp
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from .sky_index import DETECTOR_SIZE, Exposure

logging.getLogger("astropy").setLevel(logging.ERROR)

BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
HEADER_BYTES = 43200
BLOCK = 2880
BYTES_PER_PIXEL = 4
CONCURRENCY = 48
RETRIES = 4


@dataclass
class Cutout:
    exposure: Exposure
    data: np.ndarray
    wcs: WCS
    x0: int
    y0: int
    psf_fwhm_arcsec: float


async def _get_range(session: aiohttp.ClientSession, key: str, start: int, end: int) -> bytes:
    for attempt in range(RETRIES):
        try:
            async with session.get(BUCKET + key, headers={"Range": f"bytes={start}-{end}"}) as response:
                response.raise_for_status()
                return await response.read()
        except (aiohttp.ClientError, asyncio.TimeoutError):
            if attempt == RETRIES - 1:
                raise
            await asyncio.sleep(0.4 * 2**attempt)
    raise RuntimeError("unreachable")


def _split_headers(raw: bytes) -> tuple[fits.Header, int]:
    primary_end = _header_end(raw, 0)
    image_end = _header_end(raw, primary_end)
    return fits.Header.fromstring(raw[primary_end:image_end].decode("ascii", "replace")), image_end


def _header_end(raw: bytes, start: int) -> int:
    for offset in range(start, len(raw), 80):
        if raw[offset:offset + 8] == b"END     ":
            return (offset // BLOCK + 1) * BLOCK
    raise ValueError("FITS header longer than the fetched range")


async def fetch_cutout(session: aiohttp.ClientSession, semaphore: asyncio.Semaphore, exposure: Exposure, half_size: int) -> Cutout | None:
    async with semaphore:
        try:
            header, data_offset = _split_headers(await _get_range(session, exposure.key, 0, HEADER_BYTES - 1))
            wcs = WCS(header)
            x0 = int(np.clip(round(exposure.x) - half_size, 0, DETECTOR_SIZE - 2 * half_size))
            y0 = int(np.clip(round(exposure.y) - half_size, 0, DETECTOR_SIZE - 2 * half_size))
            row_bytes = DETECTOR_SIZE * BYTES_PER_PIXEL
            start = data_offset + y0 * row_bytes
            raw = await _get_range(session, exposure.key, start, start + 2 * half_size * row_bytes - 1)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            return None
    rows = np.frombuffer(raw, dtype=">f4").reshape(2 * half_size, DETECTOR_SIZE)
    data = rows[:, x0:x0 + 2 * half_size].astype(np.float32)
    return Cutout(exposure, data, wcs, x0, y0, float(header.get("PSF_FWHM", 7.0)))


async def fetch_cutouts(exposures: list[Exposure], half_size: int) -> list[Cutout]:
    semaphore = asyncio.Semaphore(CONCURRENCY)
    timeout = aiohttp.ClientTimeout(total=90)
    async with aiohttp.ClientSession(timeout=timeout, connector=aiohttp.TCPConnector(limit=CONCURRENCY)) as session:
        results = await asyncio.gather(*(fetch_cutout(session, semaphore, e, half_size) for e in exposures))
    return [c for c in results if c is not None]
