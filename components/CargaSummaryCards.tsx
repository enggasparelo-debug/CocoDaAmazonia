"use client";

import { brl } from "@/lib/format";
import type { CargaSummary } from "@/lib/types";

export default function CargaSummaryCards({
  summary,
  closed,
}: {
  summary: CargaSummary;
  closed?: boolean;
}) {
  const cocosRestantes =
    summary.opening_cocos - summary.cocos_vendidos - summary.cocos_perda;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card title="Cocos saída" value={summary.opening_cocos} />
      <Card title="Cocos vendidos" value={summary.cocos_vendidos} accent="green" />
      <Card
        title={closed ? "Cocos perda" : "Cocos no veículo"}
        value={closed ? summary.cocos_perda : Math.max(0, cocosRestantes)}
        accent={closed && summary.cocos_perda > 0 ? "red" : undefined}
      />
      <Card title="Total vendido" value={brl(Number(summary.total_vendido))} highlight />
      <Card title="Dinheiro" value={brl(Number(summary.total_dinheiro))} />
      <Card title="Pix" value={brl(Number(summary.total_pix))} />
      <Card title="Cartão" value={brl(Number(summary.total_cartao))} />
      <Card
        title="Fiado (a receber)"
        value={brl(Number(summary.total_fiado))}
        accent={Number(summary.total_fiado) > 0 ? "amber" : undefined}
      />
      <Card title="Suprimento" value={brl(Number(summary.total_suprimento))} />
      <Card title="Sangria" value={brl(Number(summary.total_sangria))} />
      <Card title="Despesas" value={brl(Number(summary.total_despesas))} accent="red" />
      <Card
        title="Esperado em caixa"
        value={brl(Number(summary.expected_cash))}
        accent="green"
      />
      {closed && (
        <>
          <Card
            title="Declarado"
            value={brl(Number(summary.closing_cash_declared ?? 0))}
          />
          <Card
            title="Diferença"
            value={brl(Number(summary.cash_diff))}
            accent={
              Math.abs(Number(summary.cash_diff)) < 0.01
                ? "green"
                : Number(summary.cash_diff) > 0
                ? "amber"
                : "red"
            }
          />
        </>
      )}
    </div>
  );
}

function Card({
  title,
  value,
  highlight,
  accent,
}: {
  title: string;
  value: string | number;
  highlight?: boolean;
  accent?: "amber" | "red" | "green";
}) {
  let cls = "card !p-3";
  if (highlight) cls += " bg-coco-600 text-white border-coco-600";
  else if (accent === "amber") cls += " bg-amber-50 border-amber-200";
  else if (accent === "red") cls += " bg-red-50 border-red-200";
  else if (accent === "green") cls += " bg-green-50 border-green-200";
  return (
    <div className={cls}>
      <div
        className={`text-xs uppercase tracking-wider ${
          highlight ? "text-coco-100" : "text-coco-700"
        }`}
      >
        {title}
      </div>
      <div className="text-xl font-bold mt-1 break-words">{value}</div>
    </div>
  );
}
