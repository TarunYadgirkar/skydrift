"use client";

import { useState } from "react";
import type { SpectrumPoint } from "@/lib/spectrum";

export const EPOCH_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"];

const WIDTH = 360;
const HEIGHT = 190;
const MARGIN = { top: 10, right: 10, bottom: 30, left: 44 };
const X_MIN = 0.7;
const X_MAX = 5.1;
const X_TICKS = [1, 2, 3, 4, 5];
const Y_TICK_COUNT = 4;
const MARKER_RADIUS = 3;

interface SpectrumChartProps {
  points: SpectrumPoint[];
  epochLabels: string[];
}

function niceCeil(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

function formatFlux(value: number): string {
  if (value === 0) return "0";
  return Math.abs(value) >= 10 ? value.toFixed(0) : Math.abs(value) >= 1 ? value.toFixed(1) : value.toFixed(2);
}

export function colorForEpoch(epoch: number): string {
  return EPOCH_COLORS[epoch % EPOCH_COLORS.length];
}

function MarkerShape({ epoch, cx, cy, r }: { epoch: number; cx: number; cy: number; r: number }) {
  const fill = colorForEpoch(epoch);
  const common = { fill, stroke: "var(--panel)", strokeWidth: 1 };
  const shape = epoch % 3;
  if (shape === 0) return <circle cx={cx} cy={cy} r={r} {...common} />;
  if (shape === 1) return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...common} />;
  return <path d={`M ${cx} ${cy - r * 1.25} L ${cx + r * 1.15} ${cy + r} L ${cx - r * 1.15} ${cy + r} Z`} {...common} />;
}

export function SpectrumChart({ points, epochLabels }: SpectrumChartProps) {
  const [hovered, setHovered] = useState<SpectrumPoint | null>(null);
  const fluxes = points.map((p) => p.fluxMjy);
  const yMax = niceCeil(Math.max(...fluxes, 0.01));
  const yMin = Math.min(0, -niceCeil(Math.max(-Math.min(...fluxes, 0), yMax * 0.02)));
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (micron: number) => MARGIN.left + ((micron - X_MIN) / (X_MAX - X_MIN)) * plotWidth;
  const y = (flux: number) => MARGIN.top + (1 - (flux - yMin) / (yMax - yMin)) * plotHeight;
  const yTicks = Array.from({ length: Y_TICK_COUNT + 1 }, (_, i) => (yMax / Y_TICK_COUNT) * i);
  const epochsPresent = [...new Set(points.map((p) => p.epoch))].sort((p, q) => p - q);

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label={`Spectrum with ${points.length} measurements from 0.75 to 5 microns`}>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={tick === 0 ? 1 : 0.5} />
            <text x={MARGIN.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="var(--muted)" className="font-mono tabular-nums">
              {formatFlux(tick)}
            </text>
          </g>
        ))}
        {X_TICKS.map((tick) => (
          <text key={tick} x={x(tick)} y={HEIGHT - MARGIN.bottom + 12} textAnchor="middle" fontSize={9} fill="var(--muted)" className="font-mono tabular-nums">
            {tick}
          </text>
        ))}
        <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 4} textAnchor="middle" fontSize={9} fill="var(--muted)">
          Wavelength (µm)
        </text>
        <text x={10} y={MARGIN.top + plotHeight / 2} textAnchor="middle" fontSize={9} fill="var(--muted)" transform={`rotate(-90 10 ${MARGIN.top + plotHeight / 2})`}>
          Flux (mJy)
        </text>
        {points.map((point, i) => (
          <g key={i} onMouseEnter={() => setHovered(point)} onMouseLeave={() => setHovered(null)}>
            <circle cx={x(point.micron)} cy={y(point.fluxMjy)} r={8} fill="transparent" />
            <MarkerShape epoch={point.epoch} cx={x(point.micron)} cy={y(point.fluxMjy)} r={hovered === point ? MARKER_RADIUS + 1.5 : MARKER_RADIUS} />
          </g>
        ))}
      </svg>
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-2xs text-muted">
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {epochsPresent.map((epoch) => (
            <li key={epoch} className="flex items-center gap-1">
              <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
                <MarkerShape epoch={epoch} cx={5} cy={5} r={3.5} />
              </svg>
              {epochLabels[epoch]}
            </li>
          ))}
        </ul>
        <p className="font-mono tabular-nums" aria-live="polite">
          {hovered ? `${hovered.micron.toFixed(2)} µm · ${formatFlux(hovered.fluxMjy)} mJy · ${epochLabels[hovered.epoch]}` : ""}
        </p>
      </div>
    </div>
  );
}
