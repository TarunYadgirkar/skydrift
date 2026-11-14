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
  backgroundBandsLoaded: number;
}

const INITIAL: BlinkState = {
  status: "idle",
  error: null,
  target: null,
  session: null,
  bands: new Map(),
  progress: null,
  backgroundBandsLoaded: 0,
};

export interface OpenRequest {
  query: string;
  preset?: Target;
  halfSizePx: number;
  detector: number;
}

export function useBlinkSession() {
  const [state, setState] = useState<BlinkState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const open = useCallback(async ({ query, preset, halfSizePx, detector }: OpenRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const update = (patch: Partial<BlinkState>) => {
      if (!signal.aborted) setState((previous) => ({ ...previous, ...patch }));
    };
    setState({ ...INITIAL, status: "resolving" });
    try {
      const target = preset ?? (await resolveTarget(query));
      const center = positionAtYear(target, SPHEREX_MID_YEAR);
      update({ target, status: "searching" });
      const session = await openSession(center.raDeg, center.decDeg, halfSizePx);
      if (session.exposures.length === 0) {
        update({ session, status: "empty" });
        return;
      }
      update({ session, status: "loading", progress: { loaded: 0, total: 0 } });
      const bands = new Map<number, BandFrames>();
      const first = await loadBand(session, detector, signal, (loaded, total) => update({ progress: { loaded, total } }));
      bands.set(detector, first);
      update({ bands: new Map(bands), status: "ready", progress: null, backgroundBandsLoaded: 1 });
      for (const band of BANDS) {
        if (band.detector === detector || signal.aborted) continue;
        bands.set(band.detector, await loadBand(session, band.detector, signal, () => undefined));
        update({ bands: new Map(bands), backgroundBandsLoaded: bands.size });
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      update({ status: "error", error: error instanceof Error ? error.message : "Something went wrong. Try again." });
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, open };
}
