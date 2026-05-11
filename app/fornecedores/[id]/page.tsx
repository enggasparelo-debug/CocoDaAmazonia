"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDateOnly } from "@/lib/format";

type SupplierStats = {
  supplier_id: string;
  supplier_name: string;
  document: string | null;
  active: boolean;
  num_compras: number;
  total_compras: number;
  pmf_dias: number | null;
  ultima_compra: string | null;
  concentracao_pct: number;
};

type Payable = {
  id: string;
  description: string | null;
  category: string | null;
  amount: number;
  expense_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  status: string;
  document_number: string | null;
};

type PriceRow = {
  description: string;
  supplier_name: string;
  amount: number;
  expense_date: string | null;
};

export default function FornecedorAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [stats, setStats] = useState<SupplierStats | null>(null);
  const [payables, setPayables] = useState<Payable[]>([]);
  const [comparisons, setComparisons] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // Fetch analytics for all suppliers to compute concentration
      const { data: allStats } = await supabase
        .from("supplier_analytics")
        .select("*");

      const row = (allStats ?? []).find((r: Record<string, unknown>) => r.supplier_id === id);
      if (!row) {
        router.push("/fornecedores");
        return;
      }

      const totalAll = (allStats ?? []).reduce(
        (acc: number, r: Record<string, unknown>) => acc + Number(r.total_compras),
        0
      );
      const concentracao =
        totalAll > 0 ? (Number(row.total_compras) / totalAll) * 100 : 0;

      setStats({ ...(row as unknown as SupplierStats), concentracao_pct: concentracao });

      // Fetch this supplier's payables (purchase history)
      const { data: pData } = await supabase
        .from("payables")
        .select(
          "id, description, category, amount, expense_date, due_date, paid_at, status, document_number"
        )
        .eq("supplier_id", id)
        .order("expense_date", { ascending: false });

      setPayables((pData ?? []) as Payable[]);

      // Price comparison: same descriptions purchased from other suppliers
      const descriptions = [
        ...new Set(
          ((pData ?? []) as Payable[])
            .map((p) => p.description)
            .filter(Boolean) as string[]
        ),
      ];

      if (descriptions.length > 0) {
        const { data: compData } = await supabase
          .from("payables")
          .select("description, amount, expense_date, suppliers!inner(name)")
          .in("description", descriptions)
          .neq("supplier_id", id)
          .not("supplier_id", "is", null)
          .order("description")
          .order("expense_date", { ascending: false });

        setComparisons(
          ((compData ?? []) as Record<string, unknown>[]).map((r) => ({
            description: r.description as string,
            supplier_name: (r.suppliers as Record<string, unknown>)?.name as string ?? "—",
            amount: r.amount as number,
            expense_date: r.expense_date as string | null,
          }))
        );
      }

      setLoading(false);
    }

    if (id) load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="text-coco-700 p-6">Carregando…</div>;
  }
  if (!stats) return null;

  const pmfColor =
    stats.pmf_dias === null
      ? "text-gray-400"
      : stats.pmf_dias <= 0
      ? "text-green-600"
      : stats.pmf_dias <= 7
      ? "text-amber-500"
      : "text-red-500";

  const concColor =
    stats.concentracao_pct >= 50
      ? "text-red-500"
      : stats.concentracao_pct >= 30
      ? "text-amber-500"
      : "text-green-600";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          href="/fornecedores"
          className="text-coco-600 hover:text-coco-800 text-sm"
        >
          ← Fornecedores
        </Link>
        <h1 className="text-2xl font-bold text-coco-800">
          {stats.supplier_name}
        </h1>
        {!stats.active && (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">
            Inativo
          </span>
        )}
      </div>
      {stats.document && (
        <p className="text-sm text-gray-500 -mt-4">
          CNPJ/CPF: {stats.document}
        </p>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Total de Compras</div>
          <div className="text-xl font-bold text-coco-800">
            {brl(stats.total_compras)}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {stats.num_compras} nota{stats.num_compras !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">
            Concentração de Compras
          </div>
          <div className={`text-xl font-bold ${concColor}`}>
            {stats.concentracao_pct.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-400 mt-1">do total por fornecedor</div>
        </div>

        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">PMF — Prazo Médio</div>
          <div className={`text-xl font-bold ${pmfColor}`}>
            {stats.pmf_dias === null
              ? "—"
              : `${stats.pmf_dias > 0 ? "+" : ""}${Number(stats.pmf_dias).toFixed(0)} dias`}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {stats.pmf_dias === null
              ? "sem pagamentos"
              : stats.pmf_dias < 0
              ? "antecipado"
              : stats.pmf_dias === 0
              ? "no prazo"
              : "após vencimento"}
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Última Compra</div>
          <div className="text-xl font-bold text-coco-800">
            {stats.ultima_compra
              ? fmtDateOnly(stats.ultima_compra + "T00:00:00")
              : "—"}
          </div>
        </div>
      </div>

      {/* Purchase History */}
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-coco-800">Histórico de Compras</h2>
        </div>
        {payables.length === 0 ? (
          <div className="text-gray-400 text-center py-10">
            Nenhuma compra registrada para este fornecedor.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <th className="px-5 py-3">Data</th>
                  <th className="px-5 py-3">Descrição</th>
                  <th className="px-5 py-3">Categoria</th>
                  <th className="px-5 py-3 text-right">Valor</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Doc Nº</th>
                </tr>
              </thead>
              <tbody>
                {payables.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-5 py-3 whitespace-nowrap">
                      {p.expense_date
                        ? fmtDateOnly(p.expense_date + "T00:00:00")
                        : p.due_date
                        ? fmtDateOnly(p.due_date + "T00:00:00")
                        : "—"}
                    </td>
                    <td className="px-5 py-3 max-w-xs truncate">
                      {p.description ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {p.category ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-medium">
                      {brl(p.amount)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          p.status === "paid"
                            ? "bg-green-100 text-green-700"
                            : p.status === "overdue"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {p.status === "paid"
                          ? "Pago"
                          : p.status === "overdue"
                          ? "Vencido"
                          : "Pendente"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {p.document_number ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Price Comparison across suppliers */}
      {comparisons.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm">
          <div className="px-5 py-4 border-b">
            <h2 className="font-semibold text-coco-800">
              Comparativo de Preços — Outros Fornecedores
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Mesmas descrições encontradas em compras de outros fornecedores
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <th className="px-5 py-3">Descrição</th>
                  <th className="px-5 py-3">Fornecedor</th>
                  <th className="px-5 py-3 text-right">Valor</th>
                  <th className="px-5 py-3">Data</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((c, i) => (
                  <tr
                    key={i}
                    className="border-b last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-5 py-3 max-w-xs truncate">
                      {c.description}
                    </td>
                    <td className="px-5 py-3">{c.supplier_name}</td>
                    <td className="px-5 py-3 text-right font-medium">
                      {brl(c.amount)}
                    </td>
                    <td className="px-5 py-3">
                      {c.expense_date
                        ? fmtDateOnly(c.expense_date + "T00:00:00")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
