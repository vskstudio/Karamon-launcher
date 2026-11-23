import { useId } from 'preact/hooks';

interface SparklineProps {
  values: readonly number[];
  label: string;
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({ values, label, width = 300, height = 48, color = 'var(--accent)' }: SparklineProps) {
  const gradientId = useId();
  if (values.length < 2) {
    return <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={label} />;
  }
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - 3 - (value / max) * (height - 8);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1] ?? [width, height];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={color} stop-opacity="0.35" />
          <stop offset="1" stop-color={color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${gradientId})`} />
      <polyline points={line} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="#fff" stroke={color} stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>
  );
}
