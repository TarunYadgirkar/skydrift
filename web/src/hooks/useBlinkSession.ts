"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadBand, openSession, type BandFrames, type Session } from "@/lib/session";
import { BANDS } from "@/lib/spherex";
import { positionAtYear, resolveTarget, SPHEREX_MID_YEAR, type Target } from "@/lib/target";

export type Status = "idle" | "resolving" | "searching" | "loading" | "ready" | "empty" | "error";

export interface Progress {
  loaded: number;
  total: number;
}

export interface BlinkState {
  status: Status;
  error: string | null;
  target: Target | null;
  session: Session | null;
  bands: Map<number, BandFrames>;
  progress: Progress | null;
}

const INITIAL: BlinkState = { status: "idle", error: null, target: null, session: null, bands: new Map(), progress: null };

export interface OpenRequest {
  query: string;
  preset?: Target;
  halfSizePx: number;
  detector: number;
}

interface Run {
  controller: AbortController;
  session: Session | null;
  loads: Map<number, Promise<BandFrames>>;
}

export function useBlinkSession() {
  const [state, setState] = useState<BlinkState>(INITIAL);
  const runRef = useRef<Run | null>(null);

  const loadInto = useCallback((run: Run, detector: number, onProgress: (loaded: number, total: number) => void) => {
    const existing = run.loads.get(detector);
    if (existing || !run.session) return existing ?? null;
    const load = loadBand(run.session, detector, run.controller.signal, onProgress).then((frames) => {
      if (!run.controller.signal.aborted) {
        setState((previous) => ({ ...previous, bands: new Map(previous.bands).set(detector, frames) }));
      }
      return frames;
    });
    run.loads.set(detector, load);
    return load;
  }, []);

  const open = useCallback(
    async ({ query, preset, halfSizePx, detector }: OpenRequest) => {
      runRef.current?.controller.abort();
      const run: Run = { controller: new AbortController(), session: null, loads: new Map() };
      runRef.current = run;
      const { signal } = run.controller;
      const update = (patch: Partial<BlinkState>) => {
        if (!signal.aborted) setState((previous) => ({ ...previous, ...patch }));
      };
      setState({ ...INITIAL, status: "resolving" });
      try {
        const target = preset ?? (await resolveTarget(query));
        const center = positionAtYear(target, SPHEREX_MID_YEAR);
        update({ target, status: "searching" });
        const session = await openSession(center.raDeg, center.decDeg, halfSizePx);
        run.session = session;
        if (session.exposures.length === 0) {
          update({ session, status: "empty" });
          return;
        }
        update({ session, status: "loading", progress: { loaded: 0, total: 0 } });
        await loadInto(run, detector, (loaded, total) => update({ progress: { loaded, total } }));
        update({ status: "ready", progress: null });
      } catch (error) {
        if (signal.aborted) return;
        console.error(error);
        update({ status: "error", error: error instanceof Error ? error.message : "Something went wrong. Try again." });
        return;
      }
      for (const band of BANDS) {
        if (signal.aborted) return;
        try {
          await loadInto(run, band.detector, () => undefined);
        } catch (error) {
          if (!signal.aborted) console.error(`band ${band.detector} failed to load`, error);
        }
      }
    },
    [loadInto],
  );

  const ensureBand = useCallback(
    (detector: number) => {
      const run = runRef.current;
      if (!run?.session || run.controller.signal.aborted) return;
      loadInto(run, detector, () => undefined)?.catch((error: unknown) => {
        if (!run.controller.signal.aborted) console.error(`band ${detector} failed to load`, error);
      });
    },
    [loadInto],
  );

  useEffect(() => () => runRef.current?.controller.abort(), []);

  return { state, open, ensureBand };
}
