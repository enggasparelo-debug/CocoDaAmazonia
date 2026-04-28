"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/useTenant";
import { useToast } from "@/components/Toast";
import { brl } from "@/lib/format";
import type { Carga, CargaSummary } from "@/lib/types";
import CargaSummaryCards from "@/components/CargaSummaryCards";

export default function FecharCargaPage() {
  const supabase = createClient();
  const router = useRouter();
  const toast = useToast();
  const { userId, isAdmin, loading: tLoading } = useTenant();
  const [carga, setCarga] = useState<Carga | null>(null);
  const [summary, setSummary] = useState<CargaSummary | null>(null);
  const [remaining, setRemaining] = useState<string>("");
  const [declared, setDeclared] = useState<string>("");
  const [closingNotes, setClosingNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!userId) return;
      let q = supabase
        .from("cargas")
        .select("*")
        .eq("status", "aberta")
        .order("opened_at", { ascending: false })
        .limit(1);
      if (!isAdmin) q = q.eq("operator_id", userId);
      const { data: c } = await q.maybeSingle();
      const cur = (c as Carga | null) ?? null;
      setCarga(cur);
      if (cur) {
        const { data: s } = await supabase
          .from("carga_summary")
          .select("*")
          .eq("carga_id", cur.id)
          .maybeSingle();
        setSummary((s as CargaSummary | null) ?? null);
      }
      setLoading(false);
    })();
  }, [supabase, userId, isAdmin]);

  if (tLoading || loading) {
    return <div className="p-6 text-coco-700">Carregando…</div>;
  }

  if (!carga || !summary) {
    return (
      <div className="space-y-4">
        <p className="text-coco-700">Você não tem carga aberta para fechar.</p>
        <Link href="/carga" className="btn-primary inline-block">
          Voltar
        </Link>
      </div>
    );
  }

  const remainingNum = Math.max(0, parseInt(remaining || "0", 10) || 0);
  const declaredNum = parseFloat((declared || "0").replace(",", ".")) || 0;
  const lossPreview = Math.max(
    0,
    summary.opening_cocos - summary.cocos_vendidos - remainingNum
  );
  const cashDiff = declaredNum - Number(summary.expected_cash);

  async function close() {
    setErr(null);
    if (remaining === "") return setErr("Informe a sobra de cocos.");
    if (declared === "") return setErr("Informe o dinheiro em mão.");
    setSaving(true);
    const { error } = await supabase
      .from("cargas")
      .update({
        status: "fechada",
        closing_cocos_remaining: remainingNum,
        closing_cash_declared: declaredNum,
        closing_notes: closingNotes.trim() || null,
      })
      .eq("id", carga!.id);
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    toast.success("Carga fechada!");
    router.push(`/carga/fechamento/${carga!.id}`);
  }

  return (
    <div className="space-y-4 max-w-2xl pb-24">
      <div>
        <Link href="/carga" className="text-coco-700 underline text-sm">
          ← Voltar
        </Link>
        <h1 className="text-3xl font-bold text-coco-900 mt-2">Fechar carga</h1>
      </div>

      <CargaSummaryCards summary={summary} />

      <div className="card space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Sobra de cocos</label>
            <input
              className="input text-3xl font-bold text-center"
              inputMode="numeric"
              value={remaining}
              onChange={(e) =>
                setRemaining(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="0"
            />
            <p className="text-xs text-coco-600 mt-1">
              Saída: {summary.opening_cocos} · Vendidos:{" "}
              {summary.cocos_vendidos}
            </p>
          </div>
          <div>
            <label className="label">Dinheiro em mão (R$)</label>
            <input
              className="input text-3xl font-bold text-center"
              inputMode="decimal"
              value={declared}
              onChange={(e) =>
                setDeclared(e.target.value.replace(/[^0-9.,]/g, ""))
              }
              placeholder="0,00"
            />
            <p className="text-xs text-coco-600 mt-1">
              Esperado: {brl(Number(summary.expected_cash))}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="card !p-3 bg-amber-50 border-amber-200">
            <div className="text-xs">Perda calculada</div>
            <div className="text-xl font-bold text-amber-800">
              {lossPreview} cocos
            </div>
          </div>
          <div
            className={`card !p-3 ${
              Math.abs(cashDiff) < 0.01
                ? "bg-green-50 border-green-200"
                : cashDiff > 0
                ? "bg-amber-50 border-amber-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            <div className="text-xs">Diferença caixa</div>
            <div className="text-xl font-bold">{brl(cashDiff)}</div>
          </div>
        </div>

        <div>
          <label className="label">Observações de fechamento</label>
          <textarea
            className="input"
            rows={2}
            value={closingNotes}
            onChange={(e) => setClosingNotes(e.target.value)}
            placeholder="Ex.: cocos quebraram no caminho…"
          />
        </div>

        {err && (
          <p className="text-red-700 text-sm bg-red-50 border border-red-200 p-2 rounded">
            {err}
          </p>
        )}

        <button
          onClick={() => setConfirm(true)}
          disabled={saving || remaining === "" || declared === ""}
          className="btn-primary w-full text-lg py-4"
        >
          Fechar carga →
        </button>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="font-bold text-lg mb-2">Confirmar fechamento?</h3>
            <p className="text-sm text-coco-700 mb-4">
              Sobra: <strong>{remainingNum}</strong> cocos · Perda automática:{" "}
              <strong className="text-amber-700">{lossPreview}</strong>.<br />
              Diferença de caixa: <strong>{brl(cashDiff)}</strong>.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirm(false)}
                className="btn-ghost"
                disabled={saving}
              >
                Voltar
              </button>
              <button onClick={close} className="btn-primary" disabled={saving}>
                {saving ? "Fechando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
