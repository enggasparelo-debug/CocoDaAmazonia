"use client";

import { brl } from "@/lib/format";

export type BarPoint = {
  date: string; // yyyy-mm-dd
  value: number;
  label?: string; // ex.: "01/05"
  subLabel?: string; // ex.: "seg"
  highlight?: boolean;
};

export type BarUnit = "brl" | "int";

// Arredonda pro próximo "número bonito" pra deixar o eixo Y limpo
// (1, 2, 5 × 10^k). 0 vira 1.
function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * base;
}

// Formato curto pro eixo Y / rótulos das barras. BRL mantém vírgula
// decimal pra valores < 1000 (ex.: "2,50"); int mostra inteiros.
function shortFmt(n: number, unit: BarUnit): string {
  if (unit === "int") {
    if (n >= 1_000_000)
      return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    return Math.round(n).toString();
  }
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return brl(n).replace("R$", "").trim();
}
function fullFmt(n: number, unit: BarUnit): string {
  return unit === "int" ? Math.round(n).toLocaleString("pt-BR") : brl(n);
}

export default function BarChart({
  points,
  height = 220,
  color = "#2c7a4a",
  highlightColor = "#1f5d37",
  showAverage = true,
  showValues = "auto", // "auto" mostra quando cabem ≤14 barras
  unit = "brl",
}: {
  points: BarPoint[];
  height?: number;
  color?: string;
  highlightColor?: string;
  showAverage?: boolean;
  showValues?: "auto" | "always" | "never";
  unit?: BarUnit;
}) {
  if (!points.length) return null;
  const rawMax = Math.max(...points.map((p) => p.value), 0);
  const max = niceMax(rawMax);
  const half = max / 2;
  const sum = points.reduce((s, p) => s + p.value, 0);
  const avg = sum / points.length;

  const w = 600;
  const h = height;
  const padTop = 22;
  const padBottom = 36;
  const padLeft = 44;
  const innerW = w - padLeft - 6;
  const innerH = h - padTop - padBottom;
  const slot = innerW / points.length;
  const barW = Math.max(slot * 0.62, 4);

  const yFor = (v: number) => padTop + innerH - (v / max) * innerH;

  const showVals =
    showValues === "always" ||
    (showValues === "auto" && points.length <= 14 && rawMax > 0);

  // Pra muitos pontos, pular rótulos do eixo X pra não sobrepor.
  // Alvo: ~14 rótulos visíveis. Sub-rótulo (dia da semana) só ≤24 barras.
  const labelStep = Math.max(1, Math.ceil(points.length / 14));
  const showLabel = (i: number) =>
    i % labelStep === 0 || i === points.length - 1;
  const showSub = points.length <= 24;

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
      <text x="6" y={padTop + 4} fontSize="10" fill="#5a7a64">
        {shortFmt(max, unit)}
      </text>
      <text x="6" y={padTop + innerH / 2 + 3} fontSize="10" fill="#5a7a64">
        {shortFmt(half, unit)}
      </text>
      <text x="6" y={padTop + innerH + 3} fontSize="10" fill="#5a7a64">
        0
      </text>

      {/* barras */}
      {points.map((p, i) => {
        const y = yFor(p.value);
        const x = padLeft + i * slot + (slot - barW) / 2;
        const fill = p.highlight ? highlightColor : color;
        const barH = Math.max(padTop + innerH - y, 0);
        return (
          <g key={p.date}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill={fill}
              rx="2"
            >
              <title>
                {p.label ?? p.date}
                {p.subLabel ? ` (${p.subLabel})` : ""} · {fullFmt(p.value, unit)}
              </title>
            </rect>
            {showVals && p.value > 0 && (
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="9"
                fill={p.highlight ? "#1a3a25" : "#3d5d4a"}
                fontWeight={p.highlight ? "bold" : "normal"}
              >
                {shortFmt(p.value, unit)}
              </text>
            )}
            {p.label && showLabel(i) && (
              <text
                x={x + barW / 2}
                y={h - (showSub && p.subLabel ? 18 : 10)}
                textAnchor="middle"
                fontSize="9"
                fill={p.highlight ? "#1a3a25" : "#5a7a64"}
                fontWeight={p.highlight ? "bold" : "normal"}
              >
                {p.label}
              </text>
            )}
            {p.subLabel && showSub && showLabel(i) && (
              <text
                x={x + barW / 2}
                y={h - 6}
                textAnchor="middle"
                fontSize="8"
                fill={p.highlight ? "#1a3a25" : "#7a958a"}
              >
                {p.subLabel}
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
            média {shortFmt(avg, unit)}
          </text>
        </g>
      )}
    </svg>
  );
}
