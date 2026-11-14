"use client";

import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { paintFrame, type Palette, type Stretch } from "@/lib/render";
import { gridPixelToSky, skyToGridPixel, type Grid } from "@/lib/resample";

export interface Marker {
  id: string;
  raDeg: number;
  decDeg: number;
  kind: "catalog" | "candidate" | "selection";
  label?: string;
  motionArcsec?: [number, number];
}

interface PlateViewerProps {
  grid: Grid;
  frame: Float32Array | null;
  stretch: Stretch;
  palette: Palette;
  markers: Marker[];
  caption: string;
  onSelect: (raDeg: number, decDeg: number) => void;
}

const MARKER_STYLE: Record<Marker["kind"], { stroke: string; radius: number; dash?: string }> = {
  catalog: { stroke: "var(--accent)", radius: 3.2 },
  candidate: { stroke: "var(--mover)", radius: 4.5 },
  selection: { stroke: "var(--critical)", radius: 2.6, dash: "1.2 1.2" },
};
const KEY_STEP_PX = 2;

export function PlateViewer({ grid, frame, stretch, palette, markers, caption, onSelect }: PlateViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<[number, number]>([grid.size / 2, grid.size / 2]);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    if (frame) paintFrame(context, frame, grid.size, stretch, palette);
    else context.clearRect(0, 0, grid.size, grid.size);
  }, [frame, grid.size, stretch, palette]);

  const selectAt = (col: number, row: number) => {
    cursorRef.current = [col, row];
    const [raDeg, decDeg] = gridPixelToSky(grid, col, row);
    onSelect(raDeg, decDeg);
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    selectAt(
      ((event.clientX - bounds.left) / bounds.width) * grid.size - 0.5,
      ((event.clientY - bounds.top) / bounds.height) * grid.size - 0.5,
    );
  };

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP_PX, 0],
      ArrowRight: [KEY_STEP_PX, 0],
      ArrowUp: [0, -KEY_STEP_PX],
      ArrowDown: [0, KEY_STEP_PX],
    };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectAt(cursorRef.current[0], cursorRef.current[1]);
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const clamp = (value: number) => Math.min(grid.size - 1, Math.max(0, value));
    selectAt(clamp(cursorRef.current[0] + move[0]), clamp(cursorRef.current[1] + move[1]));
  };

  const arcminutePx = 60 / grid.scaleArcsec;
  const strokeForOverlay = palette === "sky" ? "#ffffff" : "var(--ink)";

  return (
    <figure className="flex flex-col gap-2">
      <div
        role="application"
        tabIndex={0}
        aria-label="Sky image. Click a source to read its spectrum, or press Enter and move with the arrow keys."
        onClick={handleClick}
        onKeyDown={handleKey}
        className="relative aspect-square w-full cursor-crosshair overflow-hidden rounded-panel bg-[#d6dce1] shadow-plate"
      >
        <canvas ref={canvasRef} width={grid.size} height={grid.size} className="plate absolute inset-0 h-full w-full" />
        <svg viewBox={`0 0 ${grid.size} ${grid.size}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {markers.map((marker) => {
            const [col, row] = skyToGridPixel(grid, marker.raDeg, marker.decDeg);
            const style = MARKER_STYLE[marker.kind];
            const cx = col + 0.5;
            const cy = row + 0.5;
            const motion = marker.motionArcsec;
            return (
              <g key={marker.id}>
                <circle cx={cx} cy={cy} r={style.radius} fill="none" stroke={strokeForOverlay} strokeOpacity={0.55} strokeWidth={1.3} />
                <circle cx={cx} cy={cy} r={style.radius} fill="none" stroke={style.stroke} strokeWidth={0.7} strokeDasharray={style.dash} />
                {motion ? (
                  <line
                    x1={cx}
                    y1={cy}
                    x2={cx - motion[0] / grid.scaleArcsec}
                    y2={cy - motion[1] / grid.scaleArcsec}
                    stroke={style.stroke}
                    strokeWidth={0.7}
                    strokeLinecap="round"
                  />
                ) : null}
              </g>
            );
          })}
          <g stroke={strokeForOverlay} strokeWidth={0.6} fill={strokeForOverlay} fontSize={3.2} fontFamily="var(--font-plex-mono)">
            <line x1={4} y1={grid.size - 5} x2={4 + arcminutePx} y2={grid.size - 5} />
            <text x={4} y={grid.size - 7} stroke="none">
              1′
            </text>
            <text x={grid.size - 6} y={7} stroke="none">
              N
            </text>
            <line x1={grid.size - 5} y1={8.5} x2={grid.size - 5} y2={15} />
            <text x={grid.size - 14.5} y={16} stroke="none">
              E
            </text>
            <line x1={grid.size - 5} y1={15} x2={grid.size - 11} y2={15} />
          </g>
        </svg>
      </div>
      <figcaption className="font-mono text-2xs text-muted">{caption}</figcaption>
    </figure>
  );
}
