"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import type { Target } from "@/lib/target";
import { Button } from "./ui/controls";

export interface Preset {
  label: string;
  note: string;
  query: string;
  target?: Target;
}

export const PRESETS: Preset[] = [
  { label: "Barnard's Star", note: "Fastest-moving star in the sky", query: "Barnard's Star" },
  {
    label: "WISE 0855−0714",
    note: "Cold brown dwarf, 7 light-years away",
    query: "WISE 0855-0714",
    target: { name: "WISE 0855−0714", raDeg: 133.795129, decDeg: -7.245147, pmRaMasYr: -8118, pmDecMasYr: 680, epochYear: 2014.4 },
  },
  { label: "Epsilon Indi B", note: "Pair of brown dwarfs orbiting a star", query: "eps Ind B" },
  { label: "RW Aurigae", note: "Young star that changes brightness", query: "RW Aur" },
  { label: "R Draconis", note: "Pulsating red giant", query: "R Dra" },
];

interface TargetFormProps {
  initialQuery: string;
  busy: boolean;
  onSubmit: (query: string, preset?: Target) => void;
}

export function TargetForm({ initialQuery, busy, onSubmit }: TargetFormProps) {
  const [query, setQuery] = useState(initialQuery);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim()) onSubmit(query.trim());
  };

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm font-medium">
          Object name or coordinates
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Barnard's Star, or 269.45 4.69, or 08h55m10.8s -07d14m42.5s"
            autoComplete="off"
            spellCheck={false}
            className="min-h-10 rounded-control bg-white px-3 font-mono text-sm font-normal shadow-panel placeholder:text-muted/70"
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy || !query.trim()} className="min-h-10">
          <MagnifyingGlassIcon size={16} weight="bold" aria-hidden="true" />
          Show this sky
        </Button>
      </form>
      <ul className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Example targets">
        <li className="text-muted">Try</li>
        {PRESETS.map((preset) => (
          <li key={preset.label}>
            <Button
              variant="ghost"
              className="min-h-8 px-2"
              title={preset.note}
              disabled={busy}
              onClick={() => {
                setQuery(preset.query);
                onSubmit(preset.query, preset.target);
              }}
            >
              {preset.label}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
