"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { downloadCsv, downloadXlsx, rowsToCsv } from "@/lib/export";
import { fmtBrNumber, fmtDateOnly } from "@/lib/format";

type ReportType = "vendas" | "despesas" | "recebimentos" | "dre-mensal";

const REPORT_LABELS: Record<ReportType, string> = {
  vendas: "Vendas do Período",
  despesas: "Despesas do Período",
  recebimentos: "Recebimentos",
  "dre-mensal": "Resumo Mensal (DRE)",
};

const REPORT_DESC: Record<ReportType, string> = {
  vendas: "Data, cliente, produto, qtd, desconto, total, forma de pagamento e status.",
  despesas: "Data, categoria, descrição, valor e forma de pagamento.",
  recebimentos: "Data de recebimento, cliente, nº da venda, valor e forma de pagamento.",
  "dre-mensal": "Receita, cancelamentos, despesas e resultado agrupados por mês.",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthStr() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function isoStart(d: string) {
  return new Date(d + "T00:00:00").toISOString();
}
function isoEnd(d: string) {
  return new Date(d + "T23:59:59.999").toISOString();
}

export default function ExportarPage() {
  const supabase = createClient();
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [reportType, setReportType] = useState<ReportType>("vendas");
  const [loading, setLoading] = useState(false);
  const [lastCount, setLastCount] = useState<number | null>(null);

  async function buildRows(): Promise<Record<string, string | number | null>[]> {
    const startIso = isoStart(from);
    const endIso = isoEnd(to);

    if (reportType === "vendas") {
      const { data: salesRaw } = await supabase
        .from("sales")
        .select("id, code, created_at, quantity, unit_price, discount, total, status, customer:customers(name)")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at");

      const sales = (salesRaw ?? []) as unknown as {
        id: string;
        code: number;
        created_at: string;
        quantity: number;
        unit_price: number;
        discount: number;
        total: number;
        status: string;
        customer: { name: string } | { name: string }[] | null;
      }[];

      // Fetch all payments for these sales to get payment methods
      const methodsBySale: Record<string, string[]> = {};
      if (sales.length > 0) {
        const { data: pmts } = await supabase
          .from("sale_payments")
          .select("sale_id, method:payment_methods(name)")
          .in("sale_id", sales.map((s) => s.id));

        for (const p of (pmts ?? []) as unknown as { sale_id: string; method: { name: string } | { name: string }[] | null }[]) {
          const name = (Array.isArray(p.method) ? p.method[0]?.name : p.method?.name) ?? "—";
          if (!methodsBySale[p.sale_id]) methodsBySale[p.sale_id] = [];
          if (!methodsBySale[p.sale_id].includes(name)) methodsBySale[p.sale_id].push(name);
        }
      }

      return sales.map((s) => ({
        nº_venda: s.code,
        data: fmtDateOnly(s.created_at),
        cliente: (Array.isArray(s.customer) ? s.customer[0]?.name : s.customer?.name) ?? "Consumidor",
        produto: "Coco Verde",
        qtd: s.quantity,
        unitario: fmtBrNumber(Number(s.unit_price)),
        desconto: fmtBrNumber(Number(s.discount ?? 0)),
        total: fmtBrNumber(Number(s.total)),
        forma_pagamento: methodsBySale[s.id]?.join(" / ") ?? "—",
        status: s.status,
      }));
    }

    if (reportType === "despesas") {
      const { data: raw } = await supabase
        .from("expenses")
        .select("paid_at, category, description, amount, notes, method:payment_methods(name)")
        .gte("paid_at", startIso)
        .lte("paid_at", endIso)
        .order("paid_at");

      return ((raw ?? []) as unknown as {
        paid_at: string;
        category: string | null;
        description: string;
        amount: number;
        notes: string | null;
        method: { name: string } | { name: string }[] | null;
      }[]).map((e) => ({
        data: fmtDateOnly(e.paid_at),
        categoria: e.category ?? "",
        descricao: e.description ?? "",
        valor: fmtBrNumber(Number(e.amount)),
        forma_pagamento: (Array.isArray(e.method) ? e.method[0]?.name : e.method?.name) ?? "—",
        observacao: (e.notes ?? "").replace(/\n/g, " "),
      }));
    }

    if (reportType === "recebimentos") {
      const { data: raw } = await supabase
        .from("sale_payments")
        .select("paid_at, amount, sale:sales(code, customer:customers(name)), method:payment_methods(name)")
        .gte("paid_at", startIso)
        .lte("paid_at", endIso)
        .order("paid_at");

      return ((raw ?? []) as unknown as {
        paid_at: string;
        amount: number;
        sale: { code: number; customer: { name: string } | { name: string }[] | null } | null;
        method: { name: string } | { name: string }[] | null;
      }[]).map((p) => ({
        data: fmtDateOnly(p.paid_at),
        cliente: (Array.isArray(p.sale?.customer) ? p.sale?.customer[0]?.name : (p.sale?.customer as { name: string } | null)?.name) ?? "Consumidor",
        "nº_venda": p.sale?.code ?? "",
        valor: fmtBrNumber(Number(p.amount)),
        forma_pagamento: (Array.isArray(p.method) ? p.method[0]?.name : p.method?.name) ?? "—",
      }));
    }

    if (reportType === "dre-mensal") {
      const [salesQ, expQ] = await Promise.all([
        supabase
          .from("sales")
          .select("created_at, total, canceled_at")
          .gte("created_at", startIso)
          .lte("created_at", endIso),
        supabase
          .from("expenses")
          .select("paid_at, amount")
          .gte("paid_at", startIso)
          .lte("paid_at", endIso),
      ]);

      const sales = (salesQ.data ?? []) as { created_at: string; total: number; canceled_at: string | null }[];
      const expenses = (expQ.data ?? []) as { paid_at: string; amount: number }[];

      const monthMap: Record<string, { receita_bruta: number; devolucoes: number; despesas: number }> = {};

      for (const s of sales) {
        const ym = s.created_at.slice(0, 7);
        if (!monthMap[ym]) monthMap[ym] = { receita_bruta: 0, devolucoes: 0, despesas: 0 };
        if (s.canceled_at) {
          monthMap[ym].devolucoes += Number(s.total ?? 0);
        } else {
          monthMap[ym].receita_bruta += Number(s.total ?? 0);
        }
      }

      for (const e of expenses) {
        const ym = e.paid_at.slice(0, 7);
        if (!monthMap[ym]) monthMap[ym] = { receita_bruta: 0, devolucoes: 0, despesas: 0 };
        monthMap[ym].despesas += Number(e.amount ?? 0);
      }

      return Object.keys(monthMap)
        .sort()
        .map((ym) => {
          const { receita_bruta, devolucoes, despesas } = monthMap[ym];
          const receita_liquida = receita_bruta;
          const resultado = receita_liquida - despesas;
          const [y, m] = ym.split("-").map(Number);
          const mes = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric",
          });
          return {
            mes,
            receita_bruta: fmtBrNumber(receita_bruta),
            cancelamentos: fmtBrNumber(devolucoes),
            receita_liquida: fmtBrNumber(receita_liquida),
            despesas: fmtBrNumber(despesas),
            resultado: fmtBrNumber(resultado),
          };
        });
    }

    return [];
  }

  async function handleExport(format: "csv" | "xlsx") {
    setLoading(true);
    setLastCount(null);
    try {
      const rows = await buildRows();
      setLastCount(rows.length);
      const slug = reportType.replace("-", "_");
      const filename = `${slug}_${from}_${to}`;
      if (format === "csv") {
        downloadCsv(`${filename}.csv`, rowsToCsv(rows));
      } else {
        await downloadXlsx(`${filename}.xlsx`, REPORT_LABELS[reportType], rows);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-coco-900">Exportar para Contador</h1>
        <p className="text-coco-600">
          Relatórios financeiros prontos para envio ao contador ou declaração de IR.
        </p>
      </header>

      <div className="card space-y-5">
        <h2 className="font-semibold text-coco-900">Tipo de relatório</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          {(["vendas", "despesas", "recebimentos", "dre-mensal"] as ReportType[]).map((t) => (
            <button
              key={t}
              onClick={() => { setReportType(t); setLastCount(null); }}
              className={`text-left px-4 py-3 rounded-xl border transition ${
                reportType === t
                  ? "border-coco-600 bg-coco-50 text-coco-900 ring-1 ring-coco-300"
                  : "border-coco-200 bg-white text-coco-700 hover:bg-coco-50"
              }`}
            >
              <div className="font-medium text-sm">{REPORT_LABELS[t]}</div>
              <div className="text-xs text-coco-500 mt-0.5">{REPORT_DESC[t]}</div>
            </button>
          ))}
        </div>

        <div>
          <h2 className="font-semibold text-coco-900 mb-3">Período</h2>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="label">De</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Até</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="input"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <button
            onClick={() => handleExport("csv")}
            disabled={loading}
            className="btn-primary"
          >
            {loading ? "Gerando…" : "⬇ Exportar CSV"}
          </button>
          <button
            onClick={() => handleExport("xlsx")}
            disabled={loading}
            className="btn-secondary"
          >
            {loading ? "Gerando…" : "⬇ Exportar Excel (.xlsx)"}
          </button>
        </div>

        {lastCount !== null && (
          <p className="text-sm text-green-700 font-medium">
            ✓ {lastCount === 0 ? "Nenhum registro no período." : `${lastCount} linha${lastCount !== 1 ? "s" : ""} exportada${lastCount !== 1 ? "s" : ""}.`}
          </p>
        )}
      </div>

      <div className="card bg-coco-50 text-sm text-coco-700 space-y-1">
        <p className="font-semibold text-coco-900 mb-2">Formato dos arquivos</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            CSV: separador <strong>ponto-e-vírgula (;)</strong> — abre corretamente no Excel PT-BR
          </li>
          <li>
            Encoding: <strong>UTF-8 com BOM</strong> — acentos e caracteres especiais preservados
          </li>
          <li>
            Valores monetários: <strong>decimal com vírgula</strong> sem símbolo R$ (ex: 1234,56)
          </li>
          <li>Excel (.xlsx): colunas formatadas e prontas para uso</li>
        </ul>
      </div>
    </div>
  );
}
