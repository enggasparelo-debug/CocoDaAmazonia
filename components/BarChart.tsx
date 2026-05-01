"use client";

import { brl } from "@/lib/format";

export type BarPoint = {
  date: string; // yyyy-mm-dd
  value: number;
  label?: string; // ex.: "01/05"
  highlight?: boolean;
};

export default function BarChart({
  points,
  height = 160,
  color = "#2c7a4a",
  highlightColor = "#1f5d37",
  showAverage = true,
}: {
  points: BarPoint[];
  height?: number;
  color?: string;
  highlightColor?: string;
  showAverage?: boolean;
}) {
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const half = max / 2;
  const sum = points.reduce((s, p) => s + p.value, 0);
  const avg = sum / points.length;

  const w = 600;
  const h = height;
  const padTop = 12;
  const padBottom = 28;
  const padLeft = 38;
  const innerW = w - padLeft - 4;
  const innerH = h - padTop - padBottom;
  const slot = innerW / points.length;
  const barW = Math.max(slot * 0.6, 4);

  const yFor = (v: number) => padTop + innerH - (v / max) * innerH;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-auto"
      preserveAspectRatio="none"
    >
      {/* eixos Y simples: max e half */}
      <line
        x1={padLeft}
        y1={padTop}
        x2={w - 4}
        y2={padTop}
        stroke="#e2e8e5"
        strokeWidth="1"
      />
      <line
        x1={padLeft}
        y1={padTop + innerH / 2}
        x2={w - 4}
        y2={padTop + innerH / 2}
        stroke="#eef2f0"
        strokeWidth="1"
      />
      <line
        x1={padLeft}
        y1={padTop + innerH}
        x2={w - 4}
        y2={padTop + innerH}
        stroke="#cbd5d0"
        strokeWidth="1"
      />
      <text x="4" y={padTop + 4} fontSize="10" fill="#5a7a64">
        {brl(max).replace("R$", "").trim()}
      </text>
      <text x="4" y={padTop + innerH / 2 + 3} fontSize="10" fill="#5a7a64">
        {brl(half).replace("R$", "").trim()}
      </text>
      <text x="4" y={padTop + innerH + 3} fontSize="10" fill="#5a7a64">
        0
      </text>

      {/* barras */}
      {points.map((p, i) => {
        const y = yFor(p.value);
        const x = padLeft + i * slot + (slot - barW) / 2;
        const fill = p.highlight ? highlightColor : color;
        return (
          <g key={p.date}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(padTop + innerH - y, 0)}
              fill={fill}
              rx="2"
            >
              <title>
                {p.label ?? p.date} · {brl(p.value)}
              </title>
            </rect>
            {p.label && (
              <text
                x={x + barW / 2}
                y={h - 10}
                textAnchor="middle"
                fontSize="9"
                fill={p.highlight ? "#1a3a25" : "#5a7a64"}
                fontWeight={p.highlight ? "bold" : "normal"}
              >
                {p.label}
              </text>
            )}
          </g>
        );
      })}

      {/* linha da média */}
      {showAverage && avg > 0 && (
        <g>
          <line
            x1={padLeft}
            y1={yFor(avg)}
            x2={w - 4}
            y2={yFor(avg)}
            stroke="#d97706"
            strokeWidth="1.2"
            strokeDasharray="4 3"
          />
          <text
            x={w - 6}
            y={yFor(avg) - 3}
            textAnchor="end"
            fontSize="10"
            fill="#b45309"
          >
            média {brl(avg).replace("R$", "").trim()}
          </text>
        </g>
      )}
    </svg>
  );
}
