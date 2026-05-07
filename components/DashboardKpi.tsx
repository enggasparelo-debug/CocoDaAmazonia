"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type KpiAccent = "primary" | "amber" | "red" | "green" | "neutral";

export type KpiSize = "hero" | "small";

const ACCENT: Record<
  KpiAccent,
  { bg: string; border: string; label: string; value: string; sub: string }
> = {
  primary: {
    bg: "bg-coco-600",
    border: "border-coco-600",
    label: "text-coco-100",
    value: "text-white",
    sub: "text-coco-100",
  },
  amber: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    label: "text-amber-700",
    value: "text-amber-900",
    sub: "text-amber-800",
  },
  red: {
    bg: "bg-red-50",
    border: "border-red-200",
    label: "text-red-700",
    value: "text-red-900",
    sub: "text-red-800",
  },
  green: {
    bg: "bg-green-50",
    border: "border-green-200",
    label: "text-green-700",
    value: "text-green-900",
    sub: "text-green-800",
  },
  neutral: {
    bg: "bg-white",
    border: "border-coco-100",
    label: "text-coco-700",
    value: "text-coco-900",
    sub: "text-coco-600",
  },
};

export default function DashboardKpi({
  label,
  value,
  sub,
  icon,
  accent = "neutral",
  size = "small",
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: string;
  accent?: KpiAccent;
  size?: KpiSize;
  href?: string;
}) {
  const a = ACCENT[accent];
  const valueCls =
    size === "hero"
      ? "text-3xl md:text-4xl font-bold"
      : "text-xl lg:text-2xl font-bold";
  const inner = (
    <div className={`card ${a.bg} ${a.border} h-full`}>
      <div className={`flex items-center justify-between text-xs uppercase tracking-wider ${a.label}`}>
        <span>{label}</span>
        {icon && <span className="text-base not-italic">{icon}</span>}
      </div>
      <div className={`mt-1 ${valueCls} ${a.value}`}>{value}</div>
      {sub !== undefined && sub !== null && sub !== "" && (
        <div className={`text-xs mt-1 ${a.sub}`}>{sub}</div>
      )}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}
