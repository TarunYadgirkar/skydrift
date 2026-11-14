"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBlinkSession } from "@/hooks/useBlinkSession";
import { addFrames, stretchFor, subtractFrames, symmetricStretch, type Palette } from "@/lib/render";
import { BANDS, NATIVE_SCALE_ARCSEC } from "@/lib/spherex";
import { extractSpectrum, type SpectrumPoint } from "@/lib/spectrum";
import { formatDec, formatRa, mjdToDate, mjdToYear, type Target } from "@/lib/target";
import { fetchGaiaStars, gaiaPositionAt, totalMotionMasYr, type GaiaStar } from "@/lib/gaia";
import { findMovers, type MoverReport } from "@/lib/movers";
import type { Session } from "@/lib/session";
import { EpochStrip } from "./EpochStrip";
import { MoversPanel } from "./MoversPanel";
import { PlateViewer, type Marker } from "./PlateViewer";
import { SpectrumChart } from "./SpectrumChart";
import { PRESETS, TargetForm } from "./TargetForm";
import { Panel, Segmented } from "./ui/controls";

type Mode = "blink" | "subtract" | "add";

const FOV_HALF_SIZES = [24, 32, 48, 64];
const DEFAULT_HALF = 32;
const DEFAULT_DETECTOR = 3;
const BLINK_INTERVAL_MS = 650;
const FAST_STAR_MAS_YR = 150;
const EMPTY_GAIA: { stars: GaiaStar[]; note: string | null } = { stars: [], note: null };
const DATE_FORMAT = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });

function fovArcmin(half: number): string {
  return ((2 * half * NATIVE_SCALE_ARCSEC * 0.7) / 60).toFixed(1);
}

function presetTarget(query: string): Target | undefined {
  return PRESETS.find((preset) => preset.query.toLowerCase() === query.trim().toLowerCase())?.target;
}

function readParams() {
  const params = new URLSearchParams(window.location.search);
  const ra = params.get("ra");
  const dec = params.get("dec");
  const half = Number(params.get("fov"));
  const band = Number(params.get("band"));
  return {
    query: ra && dec ? `${ra} ${dec}` : (params.get("q") ?? ""),
    half: FOV_HALF_SIZES.includes(half) ? half : DEFAULT_HALF,
    detector: Number.isInteger(band) && band >= 1 && band <= 6 ? band : DEFAULT_DETECTOR,
  };
}

const STATUS_COPY: Record<string, string> = {
  resolving: "Looking up the object…",
  searching: "Finding SPHEREx exposures that cover this position…",
};

export function Workbench() {
  const { state, open, ensureBand } = useBlinkSession();
  const [initial] = useState(readParams);
  const [reduceMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [query, setQuery] = useState(initial.query);
  const [half, setHalf] = useState(initial.half);
  const [detector, setDetector] = useState(initial.detector);
  const [mode, setMode] = useState<Mode>("blink");
  const [palette, setPalette] = useState<Palette>("plate");
  const [epoch, setEpoch] = useState(0);
  const [playing, setPlaying] = useState(!reduceMotion);
  const [selection, setSelection] = useState<{ raDeg: number; decDeg: number } | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumPoint[]>([]);
  const [gaiaResult, setGaiaResult] = useState<{ session: Session; stars: GaiaStar[]; note: string | null } | null>(null);
  const [moversResult, setMoversResult] = useState<{ frames: (Float32Array | null)[]; report: MoverReport } | null>(null);
  const [selectedMover, setSelectedMover] = useState<string | null>(null);

  const start = useCallback(
    (nextQuery: string, preset: Target | undefined, nextHalf: number, nextDetector: number) => {
      setQuery(nextQuery);
      setSelection(null);
      setSpectrum([]);
      setSelectedMover(null);
      setPlaying(!reduceMotion);
      const params = new URLSearchParams({ q: nextQuery, fov: String(nextHalf), band: String(nextDetector) });
      window.history.replaceState(null, "", `?${params}`);
      void open({ query: nextQuery, preset: preset ?? presetTarget(nextQuery), halfSizePx: nextHalf, detector: nextDetector });
    },
    [open, reduceMotion],
  );

  useEffect(() => {
    if (initial.query) {
      void open({ query: initial.query, preset: presetTarget(initial.query), halfSizePx: initial.half, detector: initial.detector });
    }
  }, [open, initial]);

  const { session, bands, target } = state;
  const band = bands.get(detector);
  const frames = useMemo(() => band?.frames ?? [], [band]);
  const available = useMemo(() => frames.map((frame) => frame !== null), [frames]);
  const epochLabels = useMemo(() => session?.epochs.map((e) => DATE_FORMAT.format(mjdToDate(e.mjd))) ?? [], [session]);
  const stretch = useMemo(() => stretchFor(frames), [frames]);
  const firstAvailable = available.indexOf(true);
  const shownEpoch = available[epoch] ? epoch : Math.max(firstAvailable, 0);
  const gaia = gaiaResult && gaiaResult.session === session ? gaiaResult : EMPTY_GAIA;
  const movers = moversResult && moversResult.frames === frames ? moversResult.report : null;

  useEffect(() => {
    if (!playing || mode === "add") return;
    const playable = available.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
    if (playable.length < 2) return;
    const timer = window.setInterval(() => {
      setEpoch((current) => playable[(playable.indexOf(current) + 1) % playable.length] ?? playable[0]);
    }, BLINK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, mode, available]);

  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    const stamps = [...bands.values()].flatMap((b) => b.stamps);
    extractSpectrum(stamps, selection.raDeg, selection.decDeg)
      .then((points) => {
        if (!cancelled) setSpectrum(points);
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      cancelled = true;
    };
  }, [selection, bands]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const radiusDeg = (session.grid.size * session.grid.scaleArcsec) / 3600 / 2 * 1.5;
    fetchGaiaStars(session.grid.raDeg, session.grid.decDeg, radiusDeg, controller.signal)
      .then((stars) => setGaiaResult({ session, stars, note: null }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setGaiaResult({ session, stars: [], note: error instanceof Error ? error.message : null });
      });
    return () => controller.abort();
  }, [session]);

  const lastAvailable = available.lastIndexOf(true);
  useEffect(() => {
    if (!session || firstAvailable < 0 || lastAvailable <= firstAvailable) return;
    let cancelled = false;
    const first = frames[firstAvailable];
    const last = frames[lastAvailable];
    if (!first || !last) return;
    void findMovers(session.grid, first, last, session.epochs[firstAvailable].mjd, session.epochs[lastAvailable].mjd, gaia.stars)
      .then((report) => {
        if (!cancelled) setMoversResult({ frames, report });
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      cancelled = true;
    };
  }, [session, frames, firstAvailable, lastAvailable, gaia.stars]);

  const view = useMemo(() => {
    const frame = frames[shownEpoch] ?? null;
    if (!frame) return { frame: null, stretch, palette };
    if (mode === "add") {
      const all = frames.filter((f): f is Float32Array => f !== null);
      const sum = addFrames(all);
      return { frame: sum, stretch: stretchFor([sum]), palette };
    }
    if (mode === "subtract") {
      const reference = frames[firstAvailable];
      if (!reference || shownEpoch === firstAvailable) return { frame, stretch, palette };
      const difference = subtractFrames(frame, reference);
      return { frame: difference, stretch: symmetricStretch(difference), palette: "difference" as Palette };
    }
    return { frame, stretch, palette };
  }, [frames, shownEpoch, mode, stretch, palette, firstAvailable]);

  const shownYear = session?.epochs[shownEpoch] ? mjdToYear(session.epochs[shownEpoch].mjd) : 2026;
  const markers: Marker[] = [
    ...gaia.stars
      .filter((star) => totalMotionMasYr(star) >= FAST_STAR_MAS_YR)
      .map((star): Marker => ({ id: `g${star.id}`, kind: "catalog", ...gaiaPositionAt(star, shownYear) })),
    ...(movers?.candidates ?? [])
      .filter((candidate) => candidate.isMover)
      .map((candidate): Marker => ({ id: candidate.id, kind: "candidate", raDeg: candidate.raDeg, decDeg: candidate.decDeg, motionArcsec: candidate.motionArcsec })),
    ...(selection ? [{ id: "selection", kind: "selection" as const, ...selection }] : []),
  ];
  const moversNote = session && session.epochs.length < 2 ? "SPHEREx has covered this spot only once so far, so there is nothing to compare yet." : gaia.note;
  const busy = ["resolving", "searching", "loading"].includes(state.status);
  const caption = session
    ? `${formatRa(session.grid.raDeg)}  ${formatDec(session.grid.decDeg)} · ${fovArcmin(session.halfSizePx)}′ field · ${
        mode === "subtract" && shownEpoch !== firstAvailable
          ? `${epochLabels[shownEpoch]} minus ${epochLabels[firstAvailable]}`
          : mode === "add"
            ? "all passes averaged"
            : (epochLabels[shownEpoch] ?? "")
      }`
    : "";

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-4 py-5 sm:px-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-8">
        <div className="flex shrink-0 flex-col">
          <h1 className="font-display text-3xl leading-none font-bold tracking-tight">Skydrift</h1>
          <p className="mt-1 max-w-[30ch] text-sm text-muted">Blink NASA SPHEREx images of any patch of sky and spot what moved.</p>
        </div>
        <div className="flex-1">
          <TargetForm key={query} initialQuery={query} busy={busy} onSubmit={(q, preset) => start(q, preset, half, detector)} />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(340px,1fr)]">
        <div className="mx-auto flex w-full max-w-[max(22rem,calc(100dvh-15rem))] flex-col gap-3">
          {session && band && firstAvailable < 0 ? (
            <PlateMessage>SPHEREx has no images of this spot in this wavelength band. Pick another band.</PlateMessage>
          ) : session && !band && state.status === "ready" ? (
            <PlateMessage>Loading this wavelength band…</PlateMessage>
          ) : session && band ? (
            <>
              <PlateViewer
                grid={session.grid}
                frame={view.frame}
                stretch={view.stretch}
                palette={view.palette}
                markers={markers}
                caption={caption}
                onSelect={(raDeg, decDeg) => setSelection({ raDeg, decDeg })}
              />
              <EpochStrip
                epochs={session.epochs}
                labels={epochLabels}
                available={available}
                current={shownEpoch}
                playing={playing && mode !== "add"}
                onSelect={(next) => {
                  setPlaying(false);
                  setEpoch(next);
                }}
                onTogglePlay={() => setPlaying((value) => !value)}
              />
            </>
          ) : (
            <PlatePlaceholder status={state.status} error={state.error} progress={state.progress} />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="View" aside={target ? target.name : undefined}>
            <div className="flex flex-col gap-3 text-sm">
              <ControlRow label="Compare passes">
                <Segmented
                  label="Compare passes"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "blink", label: "Blink", hint: "Flip between survey passes" },
                    { value: "subtract", label: "Subtract", hint: "Each pass minus the first one" },
                    { value: "add", label: "Add", hint: "Average every pass for a deeper image" },
                  ]}
                />
              </ControlRow>
              <ControlRow label="Wavelength band (µm)">
                <Segmented
                  label="Wavelength band"
                  value={detector}
                  onChange={(next) => {
                    setDetector(next);
                    setSelectedMover(null);
                    ensureBand(next);
                    window.history.replaceState(null, "", `?${new URLSearchParams({ q: query, fov: String(half), band: String(next) })}`);
                  }}
                  options={BANDS.map((b) => ({
                    value: b.detector,
                    label: `${b.minMicron.toFixed(1)}–${b.maxMicron.toFixed(1)}`,
                    hint: `${b.label}: ${b.minMicron} to ${b.maxMicron} µm`,
                  }))}
                />
              </ControlRow>
              <ControlRow label="Field of view">
                <Segmented
                  label="Field of view"
                  value={half}
                  onChange={(next) => {
                    setHalf(next);
                    if (query) start(query, target ?? undefined, next, detector);
                  }}
                  options={FOV_HALF_SIZES.map((size) => ({ value: size, label: `${fovArcmin(size)}′` }))}
                />
              </ControlRow>
              <ControlRow label="Image style">
                <Segmented
                  label="Image style"
                  value={palette}
                  onChange={setPalette}
                  options={[
                    { value: "plate", label: "Plate", hint: "Dark stars on a light background, easier for faint sources" },
                    { value: "sky", label: "Night sky", hint: "Bright stars on a dark background" },
                  ]}
                />
              </ControlRow>
            </div>
          </Panel>

          <MoversPanel
            report={movers}
            note={moversNote}
            selectedId={selectedMover}
            onSelect={(candidate) => {
              setSelectedMover(candidate.id);
              setSelection({ raDeg: candidate.raDeg, decDeg: candidate.decDeg });
            }}
          />

          <Panel
            title="Spectrum"
            aside={session && bands.size < BANDS.length && state.status === "ready" ? `Loading bands ${bands.size} of ${BANDS.length}` : undefined}
          >
            {selection && spectrum.length > 0 ? (
              <>
                <p className="font-mono text-2xs text-muted" aria-live="polite">
                  {formatRa(selection.raDeg)} {formatDec(selection.decDeg)} · {spectrum.length} exposures
                </p>
                <SpectrumChart points={spectrum} epochLabels={epochLabels} />
              </>
            ) : (
              <p className="text-sm text-muted">
                {selection
                  ? "No clean measurement here yet. Pick a source nearer the middle of the image."
                  : "Click a source in the image. Each SPHEREx exposure sees it at a different wavelength, and together they trace its spectrum."}
              </p>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}

function PlateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-panel bg-[#dfe5e9] p-8 text-center shadow-panel">
      <p role="status" className="max-w-[42ch] text-sm text-muted">
        {children}
      </p>
    </div>
  );
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}

interface PlaceholderProps {
  status: string;
  error: string | null;
  progress: { loaded: number; total: number } | null;
}

function PlatePlaceholder({ status, error, progress }: PlaceholderProps) {
  const message =
    status === "error"
      ? error
      : status === "empty"
        ? "SPHEREx has no indexed exposures at this position yet. Try another target."
        : status === "loading"
          ? progress && progress.total
            ? `Fetching exposures from NASA's archive: ${progress.loaded} of ${progress.total}`
            : "Fetching exposures from NASA's archive…"
          : (STATUS_COPY[status] ?? "Enter an object or coordinates above to load its SPHEREx images.");
  const fraction = progress && progress.total ? progress.loaded / progress.total : 0;
  return (
    <div className="flex aspect-square w-full flex-col items-center justify-center gap-4 rounded-panel bg-[#dfe5e9] p-8 text-center shadow-panel">
      <p role={status === "error" ? "alert" : "status"} className={`max-w-[42ch] text-sm ${status === "error" ? "text-critical" : "text-muted"}`}>
        {message}
      </p>
      {status === "loading" ? (
        <div className="h-1.5 w-56 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Exposures fetched">
          <div className="h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${fraction})` }} />
        </div>
      ) : null}
    </div>
  );
}
