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
      <Button variant="primary" onClick={onTogglePlay} disabled={!playable} aria-pressed={playing} className="min-w-24">
        {playing ? <PauseIcon size={16} weight="fill" aria-hidden="true" /> : <PlayIcon size={16} weight="fill" aria-hidden="true" />}
        {playing ? "Pause" : "Blink"}
      </Button>
      <ol className="flex flex-1 flex-wrap gap-1.5" aria-label="Survey passes">
        {epochs.map(({ epoch, exposureCount }) => {
          const selected = epoch === current;
          return (
            <li key={epoch} className="flex-1">
              <button
                type="button"
                disabled={!available[epoch]}
                aria-current={selected ? "step" : undefined}
                onClick={() => onSelect(epoch)}
                title={available[epoch] ? `${exposureCount} exposures across all bands` : "No images in this band for this pass"}
                className={`flex min-h-11 w-full min-w-20 flex-col items-start justify-center rounded-control px-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  selected ? "bg-ink text-white shadow-sm" : "bg-panel text-ink shadow-panel hover:bg-white"
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="size-2 rounded-full" style={{ background: colorForEpoch(epoch) }} aria-hidden="true" />
                  {labels[epoch]}
                </span>
                <span className={`font-mono text-2xs ${selected ? "text-white/75" : "text-muted"}`}>Pass {epoch + 1}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
