"use client";

import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import type { EpochInfo } from "@/lib/session";
import { colorForEpoch } from "./SpectrumChart";
import { Button } from "./ui/controls";

interface EpochStripProps {
  epochs: EpochInfo[];
  labels: string[];
  available: boolean[];
  current: number;
  playing: boolean;
  onSelect: (epoch: number) => void;
  onTogglePlay: () => void;
}

export function EpochStrip({ epochs, labels, available, current, playing, onSelect, onTogglePlay }: EpochStripProps) {
  const playable = available.filter(Boolean).length > 1;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" onClick={onTogglePlay} disabled={!playable} className="min-w-24">
        {playing ? <PauseIcon size={16} weight="fill" aria-hidden="true" /> : <PlayIcon size={16} weight="fill" aria-hidden="true" />}
        {playing ? "Pause" : "Blink"}
      </Button>
      <ol className="flex flex-1 flex-wrap gap-1.5" aria-label="Survey passes">
        {epochs.filter(({ epoch }) => available[epoch]).map(({ epoch, exposureCount }, order) => {
          const selected = epoch === current;
          return (
            <li key={epoch} className="flex-1">
              <button
                type="button"
                aria-current={selected ? "step" : undefined}
                onClick={() => onSelect(epoch)}
                title={`${exposureCount} exposures across all bands`}
                className={`flex min-h-11 w-full min-w-20 flex-col items-start justify-center rounded-control px-2.5 text-left transition-colors ${
                  selected ? "bg-ink text-white shadow-sm" : "bg-panel text-ink shadow-panel hover:bg-white"
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="size-2 rounded-full" style={{ background: colorForEpoch(epoch) }} aria-hidden="true" />
                  {labels[epoch]}
                </span>
                <span className={`font-mono text-2xs ${selected ? "text-white/75" : "text-muted"}`}>Pass {order + 1}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
