"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/useTenant";
import { useToast } from "@/components/Toast";
import type { Vehicle, Route } from "@/lib/types";

export default function AbrirCargaPage() {
  const supabase = createClient();
  const router = useRouter();
  const toast = useToast();
  const { userId, isAdmin, loading: tLoading } = useTenant();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [stock, setStock] = useState<number>(0);
  const [vehicleId, setVehicleId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [opening, setOpening] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [operatorId, setOperatorId] = useState<string>("");
  const [operators, setOperators] = useState<{ user_id: string; email?: string }[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [v, r, inv] = await Promise.all([
        supabase
          .from("vehicles")
          .select("*")
          .eq("active", true)
          .order("plate"),
        supabase
          .from("routes")
          .select("*")
          .eq("active", true)
          .order("name"),
        supabase.from("inventory_balance").select("*").maybeSingle(),
      ]);
      setVehicles((v.data as Vehicle[]) ?? []);
      setRoutes((r.data as Route[]) ?? []);
      setStock(
        Number((inv.data as { on_hand: number } | null)?.on_hand ?? 0)
      );

      if (isAdmin) {
        const { data: ms } = await supabase
          .from("memberships")
          .select("user_id, role");
        setOperators(
          ((ms as { user_id: string }[] | null) ?? []).map((m) => ({
            user_id: m.user_id,
          }))
        );
      }
      setLoading(false);
    })();
  }, [isAdmin, supabase]);

  async function save() {
    setErr(null);
    const opCocos = parseInt(opening || "0", 10);
    if (!(opCocos > 0)) return setErr("Informe a quantidade de cocos.");
    const opId = isAdmin ? operatorId || userId : userId;
    if (!opId) return setErr("Operador não identificado.");
    setSaving(true);
    const { data, error } = await supabase
      .from("cargas")
      .insert({
        operator_id: opId,
        vehicle_id: vehicleId || null,
        route_id: routeId || null,
        opening_cocos: opCocos,
        notes: notes.trim() || null,
        opened_by: userId,
        status: "aberta",
      })
      .select("*")
      .single();
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    toast.success("Carga aberta!");
    router.push(isAdmin && opId !== userId ? `/cargas/${data.id}` : "/carga");
    router.refresh();
  }

  const opCocos = parseInt(opening || "0", 10);
  const projected = stock - (isNaN(opCocos) ? 0 : opCocos);
  const goesNegative = opCocos > 0 && projected < 0;

  if (tLoading || loading) {
    return <div className="p-6 text-coco-700">Carregando…</div>;
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <Link href="/carga" className="text-coco-700 underline text-sm">
          ← Voltar
        </Link>
        <h1 className="text-3xl font-bold text-coco-900 mt-2">Abrir carga</h1>
        <p className="text-coco-600">
          Estoque disponível: <strong>{stock}</strong> cocos.
        </p>
      </div>

      <div className="card space-y-4">
        {isAdmin && (
          <div>
            <label className="label">Operador</label>
            <select
              className="input"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
            >
              <option value="">— Eu ({userId?.slice(0, 8)}…) —</option>
              {operators
                .filter((o) => o.user_id !== userId)
                .map((o) => (
                  <option key={o.user_id} value={o.user_id}>
                    {o.user_id.slice(0, 8)}…
                  </option>
                ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Veículo</label>
          <select
            className="input"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">— Sem veículo —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} {v.model ? `· ${v.model}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Rota</label>
          <select
            className="input"
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
          >
            <option value="">— Sem rota —</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Cocos iniciais</label>
          <input
            className="input text-3xl font-bold text-center"
            inputMode="numeric"
            value={opening}
            onChange={(e) =>
              setOpening(e.target.value.replace(/[^0-9]/g, ""))
            }
            placeholder="0"
            autoFocus
          />
          <p className="text-xs text-coco-600 mt-1">
            Estoque disponível: {stock}.
            {opCocos > 0 && (
              <>
                {" · "}Após abrir:{" "}
                <strong className={goesNegative ? "text-red-700" : ""}>
                  {projected}
                </strong>{" "}
                coco(s).
              </>
            )}
          </p>
          {goesNegative && (
            <div className="mt-2 text-sm rounded-xl p-3 bg-amber-50 border border-amber-300 text-amber-900">
              ⚠ Estoque ficará <strong>negativo ({projected})</strong> depois
              de abrir esta carga. Confirme que tem cocos físicos suficientes
              ou ajuste a quantidade. Você pode prosseguir mesmo assim.
            </div>
          )}
        </div>
        <div>
          <label className="label">Observações</label>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {err && (
          <p className="text-red-700 text-sm bg-red-50 border border-red-200 p-2 rounded">
            {err}
          </p>
        )}
        <button
          onClick={save}
          disabled={saving}
          className={`w-full text-lg py-4 ${
            goesNegative ? "btn-secondary border-amber-400" : "btn-primary"
          }`}
        >
          {saving
            ? "Abrindo…"
            : goesNegative
            ? "Abrir mesmo com estoque negativo"
            : "Abrir carga"}
        </button>
      </div>
    </div>
  );
}
