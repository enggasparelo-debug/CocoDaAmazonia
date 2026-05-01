"use client";

import Link from "next/link";

export type DashboardAlert = {
  id: string;
  icon: string;
  text: string;
  href: string;
  tone: "amber" | "red";
};

const TONE: Record<DashboardAlert["tone"], string> = {
  amber: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  red: "bg-red-50 border-red-200 text-red-900 hover:bg-red-100",
};

export default function DashboardAlerts({
  alerts,
}: {
  alerts: DashboardAlert[];
}) {
  if (!alerts.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {alerts.map((a) => (
        <Link
          key={a.id}
          href={a.href}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${TONE[a.tone]}`}
        >
          <span className="text-base">{a.icon}</span>
          <span>{a.text}</span>
          <span className="text-xs opacity-70">→</span>
        </Link>
      ))}
    </div>
  );
}
