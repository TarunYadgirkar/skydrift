# Project page text

Paste each section into the matching field on the team's Project tab at spaceappschallenge.org.

## Project Name

Skydrift

## High-Level Project Summary

Skydrift is a public web tool that shows how any patch of sky changes in NASA's SPHEREx images. Enter an object name or coordinates and it plays the SPHEREx survey passes back like a short film, so anything that moved jumps out. It also subtracts or adds passes, switches between six infrared bands, builds a spectrum for any source you click, and uses a small neural network to flag the sources that moved, with their speed and direction, cross-checked against the Gaia catalog. Skydrift reads SPHEREx images straight from NASA's public cloud bucket with its own index of 1.6 million exposures, so it kept working during the hackathon while the archive's search service was offline. It matters because SPHEREx will image more than a billion objects, and nearby brown dwarfs, fast stars and possibly new planets can only be found by people comparing images over time. Skydrift makes that a one-link task for anyone.

## Link to Project Demo

https://github.com/TarunYadgirkar/skydrift/blob/main/assets/generated/skydrift-demo.pdf

## Link to Final Project

https://skydrift-steel.vercel.app

(Source code: https://github.com/TarunYadgirkar/skydrift)

## Detailed Project Description

**What it does**

- Takes an object name (resolved through CDS Sesame) or RA and Dec in degrees or sexagesimal. Names of fast-moving objects are corrected for proper motion so the field is centred where the object is now.
- Finds every SPHEREx Level 2 exposure covering that position, groups them into survey passes, and stacks each pass into one image.
- Blink mode flips between passes. Subtract mode shows each pass minus the first, where a mover appears as a blue and orange pair. Add mode averages all passes for a deeper image.
- Six wavelength bands, one per SPHEREx detector, from 0.75 to 5 µm. Field of view from 3.4 to 9.2 arcminutes.
- Click any source to get its spectrum: Skydrift measures the source in every individual exposure and plots flux against wavelength, coloured by survey pass.
- A mover detector checks every source in the field and lists the ones that shifted, with speed in arcseconds per year and compass direction.
- Each flagged source is matched to Gaia DR3. A match with the same motion is marked as a known star. A flagged source that Gaia says is still is dropped and reported as ruled out. A flagged source that is not in Gaia is marked for a closer look.
- The target, band and field of view are in the URL, so any view can be linked or embedded.
- Images draw as dark stars on a light background by default, like the photographic plates that were blinked to find Pluto, because faint sources are easier to see that way. A night-sky style is one click away.

**How it works**

- Sky index: a script reads the pointing of every SPHEREx Level 2 image from its FITS header in NASA's public bucket, using small byte-range requests. The result covers 1,628,230 exposures from April 2025 to October 2026 and is stored as 4,584 static files, one per sky cell. Adding a new data release is one command.
- Cutouts: a SPHEREx image is 65 MB. A small server route reads the header, works out where the wanted pixel rows start, and requests only those bytes. 24 cutouts take about one second.
- Stacking, in the browser: each cutout is mapped through its full TAN-SIP distortion solution, resampled north-up at half-pixel steps, background-subtracted and median-stacked per survey pass.
- Mover detector: a three-layer convolutional network (about 94,000 weights) takes a 15 by 15 pixel stamp of a source in the first and last pass and outputs the probability that it moved and the shift in pixels. It was trained on 6,740 real SPHEREx star pairs from 400 random fields. For half of the examples the second pass is slid by a known sub-pixel offset, which gives movers with a real point-spread function, real noise and real brightness changes. The network runs in the browser in plain TypeScript.

**Does it work**

- On 1,351 held-out star pairs the detector catches 95% of slid stars at a 1% false-alarm rate, with a median shift error of 0.7 arcseconds.
- On the challenge's test targets: Barnard's Star is measured at 10.1″/yr north (Gaia: 10.4″/yr), Epsilon Indi B at 4.2″/yr southeast (Gaia: 4.7″/yr). RW Aurigae and R Draconis are variable stars and are correctly reported as not moving. WISE 0855−0714 is shown in the 4.4 to 5.0 µm band at its predicted position; it is faint, and the automatic detector does not flag it yet.
- On real moving stars: the detector was run on 140 stars that Gaia measures moving faster than 1″ per year. 41 of them shifted by at least half a Skydrift pixel between the first and last SPHEREx pass, which is the smallest shift the tool reports. It recovered 31 of those 41 (76%), and its speeds differ from Gaia's by a median of 11%. Of 2,130 other sources in the same fields, 10 were flagged (0.5%), before the Gaia cross-check removes the ones Gaia knows are still. The other 99 stars moved less than half a pixel in the time SPHEREx has been observing, and 9 of them were still recovered.

**Benefits and goals**

Volunteers have found most known brown dwarfs by blinking WISE images. Skydrift gives them the same workflow for SPHEREx, with spectra and an automatic first pass on what moved. The current limit is motion of about 1.5 arcseconds per year, set by SPHEREx's 6-arcsecond pixels and 18-month baseline. Every new survey pass lowers that limit.

**Tools**

TypeScript, Next.js, React and Tailwind CSS for the web tool, hosted on Vercel. Python with NumPy, Astropy, SciPy, aiohttp and PyTorch for the sky index, training and validation.

## Use of Super Intelligence (SI)

Yes. Claude (Anthropic) was used as a coding assistant to write and review the code, and to draft the README, this description and the demo slides. This is stated in the repository README and on the last demo slide. The mover detector is a machine-learning model trained for this project on SPHEREx data, as described above. No SI-generated images, video or audio are used; every image in the tool and the slides is real SPHEREx data or a screenshot of the tool.

## NASA Data

- SPHEREx Level 2 spectral images, data releases DR1 and QR3, read from NASA's public bucket `nasa-irsa-spherex` (NASA/IPAC Infrared Science Archive). These are the images Skydrift indexes, displays, measures spectra from, and trains its detector on.
- SPHEREx spectral WCS calibration files (DR1), used to assign a wavelength to each detector pixel for the spectra.
- IRSA SPHEREx documentation and tutorial notebooks, used to understand the file layout.
- WiseView (byw.tools/wiseview), listed in the challenge resources, as the model for the blink interaction.

## Space Agency Partner Data and Other References

- ESA Gaia Data Release 3, queried through the ESA Gaia Archive, for positions and proper motions of known stars.
- CDS Sesame name resolver and SIMBAD (Strasbourg Astronomical Data Centre), for turning object names into coordinates.
- Open-source software: Next.js, React, Tailwind CSS, Phosphor Icons, NumPy, Astropy, SciPy, aiohttp, PyTorch, uv, pnpm.
- Fonts: Bricolage Grotesque, IBM Plex Sans, IBM Plex Mono (SIL Open Font License).
- Code written with assistance from Claude (Anthropic).
