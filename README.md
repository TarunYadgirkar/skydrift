# Skydrift

Blink NASA SPHEREx infrared images of any patch of sky and spot what moved between survey passes.

**Live tool:** https://skydrift-steel.vercel.app
**Challenge:** Planet X and SPHEREx, NASA Space Apps Challenge 2026 (San Francisco)

Try it on the challenge's test targets:
[Barnard's Star](https://skydrift-steel.vercel.app/?q=Barnard%27s%20Star&fov=32&band=3),
[Epsilon Indi B](https://skydrift-steel.vercel.app/?q=eps%20Ind%20B&fov=32&band=3),
[WISE 0855−0714](https://skydrift-steel.vercel.app/?q=WISE%200855-0714&fov=32&band=6),
[RW Aurigae](https://skydrift-steel.vercel.app/?q=RW%20Aur&fov=32&band=3),
[R Draconis](https://skydrift-steel.vercel.app/?q=R%20Dra&fov=32&band=3).

## What it does

Type an object name or coordinates. Skydrift finds every SPHEREx exposure that covers that spot, stacks them by survey pass, and plays the passes back like a short film. Anything that moved between passes jumps.

- **Blink, subtract or add** survey passes. Subtract shows a moving source as a blue and orange pair.
- **Six wavelength bands**, one per SPHEREx detector, from 0.75 to 5 µm.
- **Spectrum on click.** Each exposure sees a source at a different wavelength, so the exposures together trace its spectrum. Skydrift measures the source in every exposure and plots flux against wavelength.
- **Mover detector.** A small neural network checks every source in the field and flags the ones that shifted, with speed and direction.
- **Gaia cross-check.** Flagged sources are matched against the Gaia DR3 catalog. A match with the same motion is a known star. A flagged source that Gaia does not list is worth a human look.
- **Shareable links.** The target, band and field of view live in the URL, so a view can be linked or embedded.
- **Plate style.** Images draw as dark stars on a light background by default, the way photographic plates looked when Pluto was found by blinking. A night-sky style is one click away.

## How it works

```
 object name ──► name lookup (CDS Sesame) ──► position, corrected for proper motion to 2026
                                                   │
 sky index (1.63M exposures, sharded by sky cell) ◄┘   which exposures cover this spot?
        │
        ▼
 /api/cutouts ──► byte-range reads from NASA's public SPHEREx bucket (only the rows needed)
        │
        ▼
 browser: undo detector distortion, resample north-up, median-stack each survey pass
        │
        ├──► blink / subtract / add
        ├──► per-exposure photometry ──► spectrum
        └──► mover detector ──► Gaia cross-match ──► list of what moved
```

**No dependency on the archive's query service.** The standard way to find SPHEREx images for a position is a database query to the IRSA archive. Skydrift instead reads the pointing of every Level 2 image straight from its FITS header in NASA's public cloud bucket and keeps its own index: 1,628,230 exposures from April 2025 to October 2026. The index is 4,584 small static files, one per sky cell, so a lookup downloads a few hundred kilobytes.

**Cutouts by byte range.** A SPHEREx image is a 65 MB file. Skydrift never downloads one. It reads the header, works out where the wanted pixel rows start, and requests only those bytes.

**Updating for a new data release** is one command: the indexer skips weeks it has already read.

## The mover detector

The detector is a three-layer convolutional network (about 94,000 weights) that looks at a small stamp of a source in the first and last survey pass and answers two questions: did it move, and by how much.

**Training data is real.** Every example is a real star as SPHEREx saw it in two passes. For half of the examples the second pass is slid by a known sub-pixel offset, which makes a mover with a real point-spread function, real noise and real brightness changes. Both passes go through the same interpolation, so the network cannot use blur as a shortcut.

**Held-out test.** On 1,351 star pairs from fields the network never saw, it catches 95% of slid stars at a 1% false-alarm rate, 80% for shifts smaller than one pixel, with a median motion error of 0.24 pixels (0.7″).

**Real-sky test.** The detector was run on 140 stars that Gaia measures moving faster than 1″ per year. 41 of them shifted by at least half a Skydrift pixel between the first and last SPHEREx pass, which is the smallest shift the tool reports. It recovered 31 of those 41 (76%), and its speeds differ from Gaia's by a median of 11%. Of 2,130 other sources in the same fields, 10 were flagged (0.5%), before the Gaia cross-check removes the ones Gaia knows are still. The other 99 stars moved less than half a pixel in the time SPHEREx has been observing, and 9 of them were still recovered.

**Challenge test targets.**

| Target | Skydrift | Reference |
|---|---|---|
| Barnard's Star | 10.1″/yr north, known to Gaia | Gaia: 10.4″/yr |
| Epsilon Indi B | 4.2″/yr southeast, known to Gaia | Gaia: 4.7″/yr |
| WISE 0855−0714 | 8.0″/yr west (4.4 to 5.0 µm), 7.5″/yr west (3.8 to 4.4 µm), not in Gaia | Published: 8.1″/yr |
| RW Aurigae | nothing moved | Variable star |
| R Draconis | nothing moved, one glare shift ruled out by Gaia | Variable star |

WISE 0855−0714 is a cold brown dwarf that Gaia cannot see. A fast source with no Gaia match is the case the tool is built to surface.

The detector compares the earliest and latest passes that are deep enough. A pass built from only a few exposures is skipped, because faint sources do not show in it.

The network runs in the browser in plain TypeScript, with no ML runtime to download.

## Data

**NASA**
- SPHEREx Level 2 spectral images, releases DR1 and QR3, from the public bucket `nasa-irsa-spherex` (NASA/IPAC Infrared Science Archive).
- SPHEREx spectral WCS calibration files, for the wavelength of each detector pixel.

**Other**
- Gaia DR3 (ESA), for known stars and their proper motions.
- CDS Sesame and SIMBAD, for resolving object names.
- WiseView (Backyard Worlds) was the model for the blink interaction.

## Run it locally

```bash
cd pipeline && uv sync && uv run python -m spherex_pipeline.build_index
```

```bash
uv run python -m spherex_pipeline.export_shards ../web/public/skyindex
```

```bash
cd ../web && pnpm install && pnpm dev
```

Training and validation: `make_fields`, `train` and `validate` in `pipeline/src/spherex_pipeline`.

Built by Tarun Yadgirkar + Claude (Anthropic).

## Limits

- SPHEREx pixels are 6.15″ across and the survey is about 18 months old, so motion slower than roughly 1.5″ per year is below what one pair of passes can show. This improves with every new pass.
- Very bright stars saturate. Their cores are filled in for display, and their measured motion is less precise.
- Glare around a bright moving star can make a faint neighbour look like it moved. The Gaia cross-check rules these out when the neighbour is in Gaia.
- A moving source that passes within about 5″ of a faint Gaia star is taken to be that star and ruled out. It shows up again in the next pass, once it has moved clear.
