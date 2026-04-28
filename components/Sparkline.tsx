"use client";

export default function Sparkline({
  values,
  labels,
  height = 80,
  color = "#2c7a4a",
}: {
  values: number[];
  labels?: string[];
  height?: number;
  color?: string;
}) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 600;
  const h = height;
  const stepX = w / Math.max(values.length - 1, 1);
  const points = values
    .map((v, i) => `${i * stepX},${h - ((v - min) / range) * (h - 8) - 4}`)
    .join(" ");
  const area = `0,${h} ${points} ${w},${h}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h + 16}`}
      className="w-full h-auto"
      preserveAspectRatio="none"
    >
      <polygon
        points={area}
        fill={color}
        opacity="0.15"
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {values.map((v, i) => (
        <circle
          key={i}
          cx={i * stepX}
          cy={h - ((v - min) / range) * (h - 8) - 4}
          r="3"
          fill={color}
        />
      ))}
      {labels &&
        labels.map((l, i) => (
          <text
            key={i}
            x={i * stepX}
            y={h + 14}
            textAnchor="middle"
            fontSize="10"
            fill="#5a7a64"
          >
            {l}
          </text>
        ))}
    </svg>
  );
}
