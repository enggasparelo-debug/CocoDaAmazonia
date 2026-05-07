"use client";

import Link from "next/link";

export type OnboardingStep = {
  id: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
};

type Props = {
  steps: OnboardingStep[];
};

export default function EmptyOnboarding({ steps }: Props) {
  const pending = steps.filter((s) => !s.done);
  if (pending.length === 0) return null;

  const total = steps.length;
  const completed = total - pending.length;

  return (
    <div className="card border-coco-300 bg-gradient-to-br from-amber-50 to-coco-50">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-coco-900">
            Bem-vindo(a) 👋 — comece por aqui
          </h2>
          <p className="text-coco-700 text-sm">
            Configure o essencial pra abrir sua primeira carga.{" "}
            <strong>{completed}</strong> de <strong>{total}</strong>{" "}
            concluídos.
          </p>
        </div>
        <div className="text-3xl">🥥</div>
      </div>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.id}>
            <Link
              href={s.href}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                s.done
                  ? "border-green-200 bg-green-50/60"
                  : "border-coco-200 bg-white hover:border-coco-400 hover:shadow-sm"
              }`}
            >
              <span
                className={`mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold flex-shrink-0 ${
                  s.done
                    ? "bg-green-500 text-white"
                    : "bg-coco-200 text-coco-700"
                }`}
                aria-hidden="true"
              >
                {s.done ? "✓" : ""}
              </span>
              <div className="flex-1 min-w-0">
                <div
                  className={`font-semibold text-sm ${
                    s.done
                      ? "text-green-800 line-through"
                      : "text-coco-900"
                  }`}
                >
                  {s.label}
                </div>
                <div className="text-xs text-coco-600">{s.description}</div>
              </div>
              {!s.done && (
                <span className="text-coco-400 text-sm" aria-hidden="true">
                  →
                </span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
