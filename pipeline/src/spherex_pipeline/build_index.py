import asyncio
import re
import sys
import time
import urllib.parse
from pathlib import Path

import aiohttp
import numpy as np

BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
RELEASES = ("dr1", "qr3")
INDEX_DIR = Path(__file__).resolve().parents[2] / "index"
HEADER_RANGE = (12800, 22399)
FALLBACK_RANGE = (0, 43199)
CARD = 80
CONCURRENCY = 192
RETRIES = 5
FLOAT_KEYS = (
    "CRVAL1", "CRVAL2", "CRPIX1", "CRPIX2",
    "PC1_1", "PC1_2", "PC2_1", "PC2_2", "CDELT1", "CDELT2", "MJD-AVG",
)
DETECTOR_RE = re.compile(r"_\d+D(\d)_spx_")


def parse_cards(raw: bytes) -> dict[str, float]:
    values: dict[str, float] = {}
    for start in range(0, len(raw) - CARD + 1, CARD):
        card = raw[start:start + CARD]
        key = card[:8].decode("ascii", "replace").strip()
        if key in FLOAT_KEYS and card[8:10] == b"= " and key not in values:
            values[key] = float(card[10:].split(b"/")[0].strip())
    return values


async def fetch(session: aiohttp.ClientSession, url: str, byte_range: tuple[int, int] | None = None) -> bytes:
    headers = {"Range": f"bytes={byte_range[0]}-{byte_range[1]}"} if byte_range else {}
    for attempt in range(RETRIES):
        try:
            async with session.get(url, headers=headers) as response:
                response.raise_for_status()
                return await response.read()
        except (aiohttp.ClientError, asyncio.TimeoutError):
            if attempt == RETRIES - 1:
                raise
            await asyncio.sleep(0.5 * 2**attempt)
    raise RuntimeError("unreachable")


async def list_prefix(session: aiohttp.ClientSession, prefix: str, delimiter: str | None = None) -> tuple[list[str], list[str]]:
    keys: list[str] = []
    prefixes: list[str] = []
    token: str | None = None
    while True:
        query = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if delimiter:
            query["delimiter"] = delimiter
        if token:
            query["continuation-token"] = token
        text = (await fetch(session, BUCKET + "?" + urllib.parse.urlencode(query))).decode()
        keys += re.findall(r"<Key>([^<]+)</Key>", text)
        prefixes += re.findall(r"<CommonPrefixes><Prefix>([^<]+)</Prefix>", text)
        match = re.search(r"<NextContinuationToken>([^<]+)<", text)
        if not match:
            return keys, prefixes
        token = match.group(1)


async def read_pointing(session: aiohttp.ClientSession, semaphore: asyncio.Semaphore, key: str) -> dict[str, float] | None:
    async with semaphore:
        try:
            values = parse_cards(await fetch(session, BUCKET + key, HEADER_RANGE))
            if len(values) < len(FLOAT_KEYS):
                raw = await fetch(session, BUCKET + key, FALLBACK_RANGE)
                values = parse_cards(raw[raw.find(b"XTENSION") // CARD * CARD:])
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            return None
    return values if len(values) == len(FLOAT_KEYS) else None


async def index_week(session: aiohttp.ClientSession, semaphore: asyncio.Semaphore, week_prefix: str) -> int:
    out_path = INDEX_DIR / (week_prefix.strip("/").replace("/", "__") + ".npz")
    if out_path.exists():
        return 0
    keys, _ = await list_prefix(session, week_prefix)
    keys = [k for k in keys if k.endswith(".fits") and DETECTOR_RE.search(k)]
    results = await asyncio.gather(*(read_pointing(session, semaphore, k) for k in keys))
    rows = [(k, v) for k, v in zip(keys, results) if v is not None]
    np.savez_compressed(
        out_path,
        key=np.array([k for k, _ in rows]),
        detector=np.array([int(DETECTOR_RE.search(k).group(1)) for k, _ in rows], dtype=np.uint8),
        wcs=np.array([[v[name] for name in FLOAT_KEYS] for _, v in rows], dtype=np.float64).reshape(-1, len(FLOAT_KEYS)),
    )
    print(f"{week_prefix} {len(rows)}/{len(keys)}", flush=True)
    return len(rows)


async def main() -> None:
    INDEX_DIR.mkdir(exist_ok=True)
    only = sys.argv[1:]
    timeout = aiohttp.ClientTimeout(total=120)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY)
    semaphore = asyncio.Semaphore(CONCURRENCY)
    started = time.time()
    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        weeks: list[str] = []
        for release in RELEASES:
            _, found = await list_prefix(session, f"{release}/level2/", "/")
            weeks += found
        if only:
            weeks = [w for w in weeks if any(token in w for token in only)]
        total = 0
        for week in weeks:
            total += await index_week(session, semaphore, week)
    print(f"done {total} files in {time.time() - started:.0f}s", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
