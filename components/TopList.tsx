"use client";

import { brl } from "@/lib/format";

export type TopListItem = {
  key: string;
  label: string;
  value: number;
};

export default function TopList({
  title,
  icon,
  items,
  emptyText = "Sem dados no período.",
  format = "currency",
}: {
  title: string;
  icon?: string;
  items: TopListItem[];
  emptyText?: string;
  format?: "currency" | "number";
}) {
  const max = Math.max(...items.map((i) => i.value), 0);
  const fmt = (v: number) =>
    format === "currency" ? brl(v) : new Intl.NumberFormat("pt-BR").format(v);

  return (
    <div className="card h-full">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-lg">{icon}</span>}
        <h3 className="font-bold text-coco-900">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-coco-600 text-sm">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => {
            const pct = max > 0 ? (item.value / max) * 100 : 0;
            return (
              <li key={item.key}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-coco-800 truncate pr-2">
                    <span className="text-coco-500 mr-1">{i + 1}.</span>
                    {item.label}
                  </span>
                  <span className="font-semibold text-coco-900">
                    {fmt(item.value)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 bg-coco-50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-coco-600 rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
