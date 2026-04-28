"use client";

export default function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paga: "bg-green-100 text-green-800",
    parcial: "bg-amber-100 text-amber-800",
    aberta: "bg-red-100 text-red-800",
  };
  return (
    <span className={`badge ${map[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}
