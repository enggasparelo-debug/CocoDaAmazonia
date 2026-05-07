"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import type { Carga, Customer, PaymentMethod, Seller } from "@/lib/types";
import { useToast } from "@/components/Toast";
import {
  EXPECTED_HEADERS,
  findCustomerId,
  findMethodId,
  isEmptyRow,
  parseRow,
  suggestCustomerMatches,
  summarize,
  type ImportRawRow,
  type ParsedRow,
} from "@/lib/salesImport";

type CustomerResolution =
  | { mode: "create" }
  | { mode: "existing"; existingId: string };

// Carrega exceljs só quando precisar (admin abrindo a página).
async function loadExcel() {
  const ExcelJS = (await import("exceljs")).default;
  return ExcelJS;
}

export default function ImportClient({
  lockedCargaId = null,
}: {
  lockedCargaId?: string | null;
}) {
  const supabase = createClient();
  const toast = useToast();

  const [sellers, setSellers] = useState<Seller[]>([]);
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const [sellerId, setSellerId] = useState("");
  const [cargaId, setCargaId] = useState(lockedCargaId ?? "");
  const [autoCreateCustomers, setAutoCreateCustomers] = useState(true);

  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [resolutions, setResolutions] = useState<
    Record<string, CustomerResolution>
  >({});
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [progress, setProgress] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const [sl, cg, cs, pm] = await Promise.all([
        supabase
          .from("sellers")
          .select("*")
          .eq("active", true)
          .order("name"),
        supabase
          .from("cargas")
          .select("*")
          .neq("status", "conferida")
          .order("opened_at", { ascending: false })
          .limit(50),
        supabase.from("customers").select("*").order("name"),
        supabase
          .from("payment_methods")
          .select("*")
          .eq("active", true)
          .order("name"),
      ]);
      const sellersList = (sl.data as Seller[]) ?? [];
      const cargasList = (cg.data as Carga[]) ?? [];
      setSellers(sellersList);
      setCargas(cargasList);
      setCustomers((cs.data as Customer[]) ?? []);
      setMethods((pm.data as PaymentMethod[]) ?? []);
      // Quando travado a uma carga, sugere o vendedor do operador dela.
      if (lockedCargaId) {
        const carga = cargasList.find((c) => c.id === lockedCargaId);
        if (carga) {
          const opSeller = sellersList.find(
            (s) => s.user_id === carga.operator_id
          );
          if (opSeller) setSellerId(opSeller.id);
        }
      }
      setLoading(false);
    })();
  }, [supabase, lockedCargaId]);

  // ---------- Erros globais (que não dá pra importar) ---------
  const methodIds = useMemo(
    () => ({
      PIX: findMethodId("PIX", methods),
      DINHEIRO: findMethodId("DINHEIRO", methods),
      CARTAO: findMethodId("CARTAO", methods),
    }),
    [methods]
  );
  const missingMethods = (
    ["PIX", "DINHEIRO", "CARTAO"] as const
  ).filter((k) => !methodIds[k]);

  // ---------- Cliente lookup auxiliares ----------------------
  const missingCustomerNames = useMemo(() => {
    if (!parsed) return [] as string[];
    const set = new Set<string>();
    for (const r of parsed) {
      if (r.errors.length > 0) continue;
      if (!r.customerName) continue;
      if (!findCustomerId(r.customerName, customers)) {
        set.add(r.customerName);
      }
    }
    return Array.from(set).sort();
  }, [parsed, customers]);

  // Sugestões (top match) por nome faltante.
  const suggestions = useMemo(() => {
    const out: Record<
      string,
      { id: string; name: string; score: number }[]
    > = {};
    for (const n of missingCustomerNames) {
      out[n] = suggestCustomerMatches(n, customers, 5);
    }
    return out;
  }, [missingCustomerNames, customers]);

  // Sincroniza state `resolutions` com a lista atual de nomes faltantes.
  // Default: "create" (mantém o comportamento histórico).
  useEffect(() => {
    setResolutions((prev) => {
      const next: Record<string, CustomerResolution> = {};
      for (const n of missingCustomerNames) {
        next[n] = prev[n] ?? { mode: "create" };
      }
      return next;
    });
  }, [missingCustomerNames]);

  const namesToCreate = useMemo(
    () =>
      missingCustomerNames.filter(
        (n) => (resolutions[n]?.mode ?? "create") === "create"
      ),
    [missingCustomerNames, resolutions]
  );
  const unresolvedNames = useMemo(
    () =>
      missingCustomerNames.filter((n) => {
        const r = resolutions[n];
        if (!r) return true;
        if (r.mode === "existing" && !r.existingId) return true;
        return false;
      }),
    [missingCustomerNames, resolutions]
  );

  // ---------- Download do template ---------------------------
  async function downloadTemplate() {
    const ExcelJS = await loadExcel();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Vendas");

    ws.columns = [
      { header: "Data", key: "Data", width: 12 },
      { header: "Cliente", key: "Cliente", width: 32 },
      { header: "Qnt", key: "Qnt", width: 8 },
      { header: "Preço Unit.", key: "Preço Unit.", width: 12 },
      { header: "Valor Total", key: "Valor Total", width: 14 },
      { header: "PIX", key: "PIX", width: 12 },
      { header: "DINHEIRO", key: "DINHEIRO", width: 12 },
      { header: "Cartão", key: "Cartão", width: 12 },
      { header: "Fiado", key: "Fiado", width: 12 },
      { header: "Observação", key: "Observação", width: 28 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE9F5EE" },
    };

    // Formatos
    const dateCol = ws.getColumn("Data");
    dateCol.numFmt = "dd/mm/yyyy";
    const moneyCols = ["Preço Unit.", "Valor Total", "PIX", "DINHEIRO", "Cartão", "Fiado"];
    for (const c of moneyCols) {
      ws.getColumn(c).numFmt = '"R$"#,##0.00';
    }

    // Exemplos
    ws.addRow({
      Data: new Date(2026, 3, 27),
      Cliente: "CABEÇA BRANCA",
      Qnt: 500,
      "Preço Unit.": 2.8,
      "Valor Total": 1400,
      PIX: 1190,
      DINHEIRO: 210,
      Cartão: 0,
      Fiado: 0,
      Observação: "",
    });
    ws.addRow({
      Data: new Date(2026, 3, 28),
      Cliente: "PIAUI",
      Qnt: 150,
      "Preço Unit.": 3,
      "Valor Total": 450,
      PIX: 0,
      DINHEIRO: 0,
      Cartão: 0,
      Fiado: 450,
      Observação: "Entrega segunda",
    });
    ws.addRow({
      Data: new Date(2026, 3, 28),
      Cliente: "STEPHANO",
      Qnt: 200,
      "Preço Unit.": 2.6,
      "Valor Total": 520,
      PIX: 440,
      DINHEIRO: 80,
      Cartão: 0,
      Fiado: 0,
      Observação: "",
    });

    const ws2 = wb.addWorksheet("Instruções");
    const lines = [
      ["Como preencher"],
      [""],
      ["1) Data: dd/mm/aaaa (ex.: 27/04/2026)"],
      ["2) Cliente: nome exatamente como cadastrado. Se não existir, será criado automaticamente (ative na tela de import)."],
      ["3) Qnt: quantidade de cocos (inteiro > 0)."],
      ["4) Preço Unit.: valor do coco (ex.: 2,80)."],
      ["5) Valor Total: Qnt × Preço Unit. — o sistema avisa se não bater."],
      ["6) PIX, DINHEIRO, Cartão: parte recebida em cada forma. As que ficaram em aberto vão pra Fiado."],
      ["7) Fiado: o que ainda não foi pago. PIX + DINHEIRO + CARTÃO + FIADO precisa fechar com Total."],
      ["8) Observação: opcional."],
      [""],
      ["A ordem das colunas precisa bater com este modelo. Apague os exemplos antes de importar."],
    ];
    ws2.addRows(lines);
    ws2.getColumn(1).width = 100;
    ws2.getRow(1).font = { bold: true, size: 14 };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo_vendas.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Upload + parse ---------------------------------
  async function handleFile(file: File) {
    setParsing(true);
    setParsed(null);
    setFileName(file.name);
    try {
      const ExcelJS = await loadExcel();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("Planilha vazia.");

      // Lê headers da linha 1 e mapeia índice de cada coluna esperada.
      const headerRow = ws.getRow(1);
      const idx: Record<string, number> = {};
      headerRow.eachCell((cell, col) => {
        const key = String(cell.value ?? "").trim();
        if (key) idx[key] = col;
      });
      const required = EXPECTED_HEADERS.filter(
        (h) => h !== "Observação"
      );
      const missing = required.filter((h) => !idx[h]);
      if (missing.length > 0) {
        throw new Error(
          `Colunas faltando: ${missing.join(", ")}. Use o modelo de import.`
        );
      }

      const raw: ImportRawRow[] = [];
      const lastRow = ws.actualRowCount || ws.rowCount;
      for (let r = 2; r <= lastRow; r++) {
        const row = ws.getRow(r);
        const cell = (h: string) => {
          const c = idx[h];
          if (!c) return null;
          const v = row.getCell(c).value;
          // ExcelJS pode retornar { result, formula } pra células com fórmula.
          if (
            v &&
            typeof v === "object" &&
            "result" in (v as object)
          ) {
            return (v as { result?: unknown }).result ?? null;
          }
          return v ?? null;
        };
        const item: ImportRawRow = {
          rowNumber: r,
          date: cell("Data"),
          customer: cell("Cliente"),
          quantity: cell("Qnt"),
          unitPrice: cell("Preço Unit."),
          total: cell("Valor Total"),
          pix: cell("PIX"),
          cash: cell("DINHEIRO"),
          card: cell("Cartão"),
          fiado: cell("Fiado"),
          notes: cell("Observação"),
        };
        if (isEmptyRow(item)) continue;
        raw.push(item);
      }
      const parsedRows = raw.map(parseRow);
      setParsed(parsedRows);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  // ---------- Importação real -------------------------------
  async function runImport() {
    if (!parsed) return;
    if (!sellerId) return toast.error("Selecione o vendedor.");
    if (parsed.some((r) => r.errors.length > 0))
      return toast.error("Corrija os erros antes de importar.");
    if (missingMethods.length > 0)
      return toast.error(
        `Cadastre as formas de pagamento faltantes: ${missingMethods.join(", ")}.`
      );

    setImporting(true);
    setProgress("Preparando…");
    try {
      // 1) Resolve clientes: reconcilia os escolhidos manualmente +
      // cria os que ficaram como "criar novo".
      const custMap = new Map<string, string>();
      for (const c of customers)
        custMap.set(c.name.trim().toLowerCase(), c.id);

      // Mapeia nomes resolvidos pra um existing escolhido pelo usuário.
      for (const name of missingCustomerNames) {
        const r = resolutions[name];
        if (r?.mode === "existing" && r.existingId) {
          custMap.set(name.trim().toLowerCase(), r.existingId);
        }
      }

      const toCreate = autoCreateCustomers
        ? namesToCreate
        : namesToCreate.filter(() => false);

      if (toCreate.length > 0) {
        setProgress(`Criando ${toCreate.length} cliente(s)…`);
        const inserts = toCreate.map((name) => ({ name, active: true }));
        const { data, error } = await supabase
          .from("customers")
          .insert(inserts)
          .select("id, name");
        if (error) throw error;
        for (const c of data ?? []) {
          custMap.set(
            (c.name as string).trim().toLowerCase(),
            c.id as string
          );
        }
      }

      // 2) Pra cada linha: insere a venda + pagamentos.
      const valid = parsed.filter((r) => r.errors.length === 0);
      let done = 0;
      const errors: string[] = [];
      for (const r of valid) {
        setProgress(`Importando ${++done} de ${valid.length}…`);
        const cId = custMap.get(r.customerName.trim().toLowerCase()) ?? null;
        if (!cId && !autoCreateCustomers) {
          errors.push(
            `Linha ${r.rowNumber}: cliente "${r.customerName}" não existe.`
          );
          continue;
        }
        const { data: saleData, error: saleErr } = await supabase
          .from("sales")
          .insert({
            customer_id: cId,
            seller_id: sellerId,
            carga_id: cargaId || null,
            quantity: r.quantity,
            unit_price: r.unitPrice,
            discount: 0,
            total: r.total,
            notes: r.notes,
            created_at: r.date.toISOString(),
          })
          .select("id")
          .single();
        if (saleErr) {
          errors.push(`Linha ${r.rowNumber}: ${saleErr.message}`);
          continue;
        }
        const saleId = (saleData as { id: string }).id;
        // pagamentos
        const payInserts = r.payments
          .map((p) => {
            const mid = methodIds[p.methodKey];
            if (!mid) return null;
            return {
              sale_id: saleId,
              payment_method_id: mid,
              amount: p.amount,
              paid_at: r.date.toISOString(),
            };
          })
          .filter((x): x is NonNullable<typeof x> => !!x);
        if (payInserts.length > 0) {
          const { error: payErr } = await supabase
            .from("sale_payments")
            .insert(payInserts);
          if (payErr) {
            errors.push(
              `Linha ${r.rowNumber}: pagamentos não lançados — ${payErr.message}`
            );
          }
        }
      }

      if (errors.length > 0) {
        toast.error(
          `Importou com ${errors.length} aviso(s). Veja a lista logo abaixo.`
        );
        setImportErrors(errors);
      } else {
        toast.success(`${valid.length} venda(s) importadas.`);
        setImportErrors([]);
      }
      setProgress(null);
      setParsed(null);
      setFileName("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setImporting(false);
    }
  }

  const summary = useMemo(() => (parsed ? summarize(parsed) : null), [parsed]);
  const hasErrors = parsed?.some((r) => r.errors.length > 0) ?? false;

  if (loading) {
    return <div className="p-6 text-coco-700">Carregando…</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link
            href={lockedCargaId ? `/cargas/${lockedCargaId}` : "/vendas"}
            className="text-coco-700 underline text-sm"
          >
            ← Voltar {lockedCargaId ? "pra carga" : "pra Vendas"}
          </Link>
          <h1 className="text-3xl font-bold text-coco-900">
            Importar vendas via Excel
          </h1>
          <p className="text-coco-600">
            Use o modelo abaixo, preencha e suba o arquivo. Tudo pode ser
            revisado antes de gravar.
          </p>
        </div>
        <button onClick={downloadTemplate} className="btn-secondary">
          ⬇ Baixar modelo
        </button>
      </header>

      {importErrors.length > 0 && (
        <div className="card border-amber-300 bg-amber-50">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-amber-900">
              Avisos da importação ({importErrors.length})
            </h2>
            <button
              onClick={() => setImportErrors([])}
              className="btn-ghost text-xs"
              aria-label="Fechar avisos"
            >
              Fechar
            </button>
          </div>
          <p className="text-xs text-amber-800 mb-2">
            A importação foi concluída, mas algumas linhas tiveram problema.
            Revise abaixo:
          </p>
          <ul className="text-xs space-y-1 max-h-64 overflow-y-auto bg-white border border-amber-200 rounded-lg p-3">
            {importErrors.map((e, i) => (
              <li key={i} className="text-amber-900">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card space-y-4">
        <h2 className="font-bold text-coco-900">Configuração</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Vendedor *</label>
            <select
              className="input"
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
            >
              <option value="">— Selecione —</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-coco-600 mt-1">
              Vai ser usado pra todas as vendas do arquivo.
            </p>
          </div>
          <div>
            <label className="label">
              {lockedCargaId ? "Carga (travada)" : "Vincular a uma carga (opcional)"}
            </label>
            <select
              className="input"
              value={cargaId}
              onChange={(e) => setCargaId(e.target.value)}
              disabled={!!lockedCargaId}
            >
              {!lockedCargaId && <option value="">— Sem carga —</option>}
              {cargas.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.code} · {c.status}
                </option>
              ))}
              {/* Garante que a carga travada aparece mesmo se não estiver
                  na lista (ex.: conferida). */}
              {lockedCargaId &&
                !cargas.some((c) => c.id === lockedCargaId) && (
                  <option value={lockedCargaId}>
                    Carga selecionada
                  </option>
                )}
            </select>
            {lockedCargaId && (
              <p className="text-xs text-coco-600 mt-1">
                Vindo da tela de carga — todas as vendas vão pra ela.
              </p>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoCreateCustomers}
            onChange={(e) => setAutoCreateCustomers(e.target.checked)}
          />
          Criar automaticamente os clientes que ainda não existem
        </label>
        {missingMethods.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
            ⚠ Não achei as formas de pagamento:{" "}
            <strong>{missingMethods.join(", ")}</strong>. Cadastre em{" "}
            <Link href="/formas-pagamento" className="underline">
              Formas de Pagamento
            </Link>{" "}
            antes de importar.
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-coco-900">Arquivo</h2>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          className="input"
          disabled={parsing || importing}
        />
        {parsing && (
          <p className="text-sm text-coco-700">Lendo planilha…</p>
        )}
        {fileName && !parsing && (
          <p className="text-xs text-coco-600">Arquivo: {fileName}</p>
        )}
      </div>

      {parsed && summary && (
        <>
          <div className="card">
            <h2 className="font-bold text-coco-900 mb-3">Resumo</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Linhas válidas" value={summary.rows} />
              <Stat label="Com erro" value={summary.withErrors} red={summary.withErrors > 0} />
              <Stat label="Cocos" value={summary.cocos} />
              <Stat label="Total" value={brl(summary.total)} bold />
              <Stat label="PIX" value={brl(summary.byMethod.PIX)} />
              <Stat label="Dinheiro" value={brl(summary.byMethod.DINHEIRO)} />
              <Stat label="Cartão" value={brl(summary.byMethod.CARTAO)} />
              <Stat label="Fiado" value={brl(summary.fiado)} amber />
            </div>
          </div>

          {missingCustomerNames.length > 0 && (
            <div className="card space-y-3">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <h2 className="font-bold text-coco-900">
                    Clientes não encontrados ({missingCustomerNames.length})
                  </h2>
                  <p className="text-xs text-coco-600">
                    Pra cada nome, escolha criar um cliente novo ou
                    vincular a um já existente. Sugestões automáticas
                    quando achamos algo parecido.
                  </p>
                </div>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      const next: Record<string, CustomerResolution> = {};
                      for (const n of missingCustomerNames)
                        next[n] = { mode: "create" };
                      setResolutions(next);
                    }}
                  >
                    Marcar todos como "criar"
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      const next: Record<string, CustomerResolution> = {
                        ...resolutions,
                      };
                      for (const n of missingCustomerNames) {
                        const top = suggestions[n]?.[0];
                        if (top)
                          next[n] = { mode: "existing", existingId: top.id };
                      }
                      setResolutions(next);
                    }}
                  >
                    Aceitar sugestões
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nome na planilha</th>
                      <th>Ação</th>
                      <th>Cliente existente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingCustomerNames.map((name) => {
                      const r = resolutions[name] ?? { mode: "create" };
                      const sugg = suggestions[name] ?? [];
                      return (
                        <tr key={name}>
                          <td className="font-medium text-coco-900">
                            {name}
                            {sugg.length > 0 && r.mode === "create" && (
                              <div className="text-xs text-coco-600 mt-0.5">
                                Parecido com:{" "}
                                <button
                                  type="button"
                                  className="underline text-coco-700"
                                  onClick={() =>
                                    setResolutions((p) => ({
                                      ...p,
                                      [name]: {
                                        mode: "existing",
                                        existingId: sugg[0].id,
                                      },
                                    }))
                                  }
                                >
                                  {sugg[0].name}
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap">
                            <label className="inline-flex items-center gap-1 text-sm mr-3">
                              <input
                                type="radio"
                                name={`res-${name}`}
                                checked={r.mode === "create"}
                                onChange={() =>
                                  setResolutions((p) => ({
                                    ...p,
                                    [name]: { mode: "create" },
                                  }))
                                }
                              />
                              Criar novo
                            </label>
                            <label className="inline-flex items-center gap-1 text-sm">
                              <input
                                type="radio"
                                name={`res-${name}`}
                                checked={r.mode === "existing"}
                                onChange={() =>
                                  setResolutions((p) => ({
                                    ...p,
                                    [name]: {
                                      mode: "existing",
                                      existingId:
                                        suggestions[name]?.[0]?.id ?? "",
                                    },
                                  }))
                                }
                              />
                              Vincular a existente
                            </label>
                          </td>
                          <td>
                            <select
                              className="input"
                              disabled={r.mode !== "existing"}
                              value={
                                r.mode === "existing" ? r.existingId : ""
                              }
                              onChange={(e) =>
                                setResolutions((p) => ({
                                  ...p,
                                  [name]: {
                                    mode: "existing",
                                    existingId: e.target.value,
                                  },
                                }))
                              }
                            >
                              <option value="">
                                — selecione um cliente —
                              </option>
                              {sugg.length > 0 && (
                                <optgroup label="Sugestões">
                                  {sugg.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              <optgroup label="Todos">
                                {customers.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!autoCreateCustomers && namesToCreate.length > 0 && (
                <div className="text-xs rounded-xl p-2 bg-red-50 border border-red-200 text-red-800">
                  {namesToCreate.length} nome(s) marcado(s) como "criar
                  novo", mas o auto-criar está desligado. Ative no card
                  Configuração ou vincule a um cliente existente.
                </div>
              )}
              {unresolvedNames.length > 0 && (
                <div className="text-xs rounded-xl p-2 bg-amber-50 border border-amber-200 text-amber-900">
                  {unresolvedNames.length} cliente(s) marcado(s) como
                  "vincular" sem escolha. Selecione um cliente em cada
                  linha pendente.
                </div>
              )}
            </div>
          )}

          <div className="card overflow-x-auto">
            <h2 className="font-bold text-coco-900 mb-3">
              Pré-visualização ({parsed.length} linha
              {parsed.length === 1 ? "" : "s"})
            </h2>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Qnt</th>
                  <th>Unit.</th>
                  <th>Total</th>
                  <th>PIX</th>
                  <th>Din.</th>
                  <th>Cartão</th>
                  <th>Fiado</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((r) => {
                  const pix = r.payments.find((p) => p.methodKey === "PIX")
                    ?.amount ?? 0;
                  const din = r.payments.find((p) => p.methodKey === "DINHEIRO")
                    ?.amount ?? 0;
                  const car = r.payments.find((p) => p.methodKey === "CARTAO")
                    ?.amount ?? 0;
                  const bg =
                    r.errors.length > 0
                      ? "bg-red-50"
                      : r.warnings.length > 0
                      ? "bg-amber-50"
                      : "";
                  return (
                    <tr key={r.rowNumber} className={bg}>
                      <td className="text-coco-500">{r.rowNumber}</td>
                      <td>{r.date.toLocaleDateString("pt-BR")}</td>
                      <td>{r.customerName || "—"}</td>
                      <td>{r.quantity || "—"}</td>
                      <td>{brl(r.unitPrice)}</td>
                      <td className="font-semibold">{brl(r.total)}</td>
                      <td>{pix ? brl(pix) : ""}</td>
                      <td>{din ? brl(din) : ""}</td>
                      <td>{car ? brl(car) : ""}</td>
                      <td className={r.fiado > 0 ? "text-amber-700" : ""}>
                        {r.fiado ? brl(r.fiado) : ""}
                      </td>
                      <td className="text-xs">
                        {r.errors.length > 0 && (
                          <div className="text-red-700">
                            {r.errors.join(" · ")}
                          </div>
                        )}
                        {r.warnings.length > 0 && (
                          <div className="text-amber-700">
                            {r.warnings.join(" · ")}
                          </div>
                        )}
                        {r.errors.length === 0 && r.warnings.length === 0 && (
                          <span className="text-green-700">OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-coco-700">
              {progress
                ? progress
                : hasErrors
                ? "Corrija os erros pra liberar a importação."
                : `Pronto pra importar ${summary.rows} venda(s).`}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setParsed(null);
                  setFileName("");
                }}
                className="btn-ghost"
                disabled={importing}
              >
                Descartar
              </button>
              <button
                onClick={runImport}
                disabled={
                  importing ||
                  hasErrors ||
                  !sellerId ||
                  missingMethods.length > 0 ||
                  summary.rows === 0 ||
                  unresolvedNames.length > 0 ||
                  (!autoCreateCustomers && namesToCreate.length > 0)
                }
                className="btn-primary"
              >
                {importing ? "Importando…" : `Importar ${summary.rows} venda(s)`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  red,
  amber,
  bold,
}: {
  label: string;
  value: string | number;
  red?: boolean;
  amber?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="rounded-xl border border-coco-100 p-3">
      <div className="text-xs text-coco-700">{label}</div>
      <div
        className={`${bold ? "text-xl font-bold" : "font-semibold"} ${
          red ? "text-red-700" : amber ? "text-amber-700" : "text-coco-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
