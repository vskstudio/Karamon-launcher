import { useRef } from 'preact/hooks';
import './Controls.css';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  format?: (value: number) => string;
  marks?: readonly number[];
  disabled?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snap(value: number, min: number, step: number): number {
  return Math.round((value - min) / step) * step + min;
}

export function Slider({ value, min, max, step = 1, onChange, label, format = String, marks = [], disabled = false }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const ratio = max > min ? (clamp(value, min, max) - min) / (max - min) : 0;

  const commit = (next: number) => {
    const snapped = clamp(snap(next, min, step), min, max);
    if (snapped !== value) onChange(snapped);
  };

  const valueAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return value;
    return min + ((clientX - rect.left) / rect.width) * (max - min);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (disabled) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    target.focus();
    commit(valueAt(event.clientX));
  };

  const onPointerMove = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLElement;
    if (!target.hasPointerCapture(event.pointerId)) return;
    commit(valueAt(event.clientX));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const page = Math.max(step, (max - min) / 10);
    const moves: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + page,
      PageDown: value - page,
      Home: min,
      End: max,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    commit(next);
  };

  return (
    <div
      class="ui-slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <div ref={trackRef} class="ui-slider__track">
        <div class="ui-slider__fill" style={{ width: `${ratio * 100}%` }} />
        {marks.map((mark) => (
          <span
            key={mark}
            class="ui-slider__mark"
            style={{ left: `${((clamp(mark, min, max) - min) / (max - min)) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        <span class="ui-slider__thumb" style={{ left: `${ratio * 100}%` }} aria-hidden="true" />
      </div>
    </div>
  );
}
