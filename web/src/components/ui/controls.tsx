import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "quiet" | "ghost";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-strong shadow-sm",
  quiet: "bg-panel text-ink shadow-panel hover:bg-white",
  ghost: "text-accent-strong hover:bg-accent/10",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "quiet", className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-control px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}

interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-control bg-line/60 p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected}
            disabled={option.disabled}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={`min-h-8 rounded-[0.25rem] px-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              selected ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface PanelProps {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}

export function Panel({ title, aside, children }: PanelProps) {
  return (
    <section className="flex flex-col gap-3 rounded-panel bg-panel p-4 shadow-panel">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside ? <div className="text-2xs text-muted">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}
