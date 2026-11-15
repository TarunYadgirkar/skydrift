"use client";

import { ArrowUpIcon, CheckCircleIcon, QuestionIcon } from "@phosphor-icons/react";
import { gaiaSpeedArcsecYr, type MoverCandidate, type MoverReport } from "@/lib/movers";
import { Panel } from "./ui/controls";

interface MoversPanelProps {
  report: MoverReport | null;
  note: string | null;
  /** Labels of the two survey passes the detector compared. */
  compared: [string, string] | null;
  selectedId: string | null;
  onSelect: (candidate: MoverCandidate) => void;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function direction([east, north]: [number, number]): string {
  const angle = (Math.atan2(east, north) * 180) / Math.PI;
  return COMPASS[Math.round(((angle + 360) % 360) / 45) % 8];
}

/** The image has north up and east to the left, so the arrow turns counter-clockwise for eastward motion. */
function arrowRotationDeg([east, north]: [number, number]): number {
  return (Math.atan2(-east, north) * 180) / Math.PI;
}

function summary(report: MoverReport, compared: [string, string] | null): string {
  const count = `${report.sourcesChecked} ${report.sourcesChecked === 1 ? "source" : "sources"} checked`;
  return compared ? `${count}, ${compared[0]} to ${compared[1]}` : count;
}

function CatalogPill({ candidate }: { candidate: MoverCandidate }) {
  if (candidate.gaia) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-good/12 px-2 py-0.5 text-2xs font-medium text-good">
        <CheckCircleIcon size={12} weight="fill" aria-hidden="true" />
        Known to Gaia
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warn/14 px-2 py-0.5 text-2xs font-medium text-warn">
      <QuestionIcon size={12} weight="bold" aria-hidden="true" />
      Not in Gaia
    </span>
  );
}

export function MoversPanel({ report, note, compared, selectedId, onSelect }: MoversPanelProps) {
  const movers = report?.candidates.filter((candidate) => candidate.isMover) ?? [];
  const ruledOut = report?.candidates.filter((candidate) => candidate.ruledOutByGaia).length ?? 0;
  return (
    <Panel title="What moved" aside={report ? summary(report, compared) : undefined}>
      {!report ? (
        <p className="text-sm text-muted">{note ?? "Movers are flagged once two survey passes have loaded."}</p>
      ) : movers.length === 0 ? (
        <p className="text-sm text-muted">Nothing in this field shifted by more than about 1.5″ between these two passes.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {movers.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => onSelect(candidate)}
                aria-pressed={candidate.id === selectedId}
                className={`flex w-full flex-col gap-1 rounded-control px-3 py-2 text-left transition-colors ${
                  candidate.id === selectedId ? "bg-mover/20" : "bg-surface/70 hover:bg-surface"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-sm tabular-nums">
                    <ArrowUpIcon size={14} weight="bold" aria-hidden="true" style={{ rotate: `${arrowRotationDeg(candidate.motionArcsec)}deg` }} />
                    {candidate.speedArcsecYr.toFixed(1)}″/yr toward {direction(candidate.motionArcsec)}
                  </span>
                  <CatalogPill candidate={candidate} />
                </span>
                <span className="font-mono text-2xs text-muted tabular-nums">
                  {Math.round(candidate.probability * 100)}% confidence
                  {candidate.gaia ? ` · Gaia measures ${gaiaSpeedArcsecYr(candidate.gaia).toFixed(1)}″/yr` : " · worth a closer look"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {ruledOut > 0 ? (
        <p className="text-sm text-muted">
          {ruledOut === 1 ? "1 apparent shift was" : `${ruledOut} apparent shifts were`} ruled out because Gaia measures{" "}
          {ruledOut === 1 ? "that star" : "those stars"} as nearly still. Glare from a bright neighbour is the usual cause.
        </p>
      ) : null}
      {report ? (
        <p className="text-2xs text-muted">
          The detector learned from {report.metrics.star_pairs.toLocaleString("en")} real SPHEREx star pairs that were slid by known
          amounts. On stars it never saw, it catches {Math.round(report.metrics.recall_at_1pct_false_alarms * 100)}% of movers at a 1%
          false-alarm rate.
        </p>
      ) : null}
    </Panel>
  );
}
