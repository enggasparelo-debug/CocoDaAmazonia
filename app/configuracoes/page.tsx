"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProductSettings } from "@/lib/types";
import { brl } from "@/lib/format";

export default function ConfiguracoesPage() {
  const supabase = createClient();
  const [settings, setSettings] = useState<ProductSettings | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("product_settings")
      .select("*")
      .limit(1)
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    setSettings(data as ProductSettings);
    setName(data.name);
    setPrice(Number(data.unit_price));
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    setError(null);
    const { error } = await supabase
      .from("product_settings")
      .update({
        name,
        unit_price: price,
        updated_at: new Date().toISOString(),
      })
      .eq("id", settings.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setMsg("Salvo!");
    load();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-coco-900">Configurações</h1>
        <p className="text-coco-600">
          Defina o produto único e o preço padrão. O operador ainda poderá
          ajustar o preço na hora da venda.
        </p>
      </header>

      <div className="card max-w-lg space-y-4">
        <div>
          <label className="label">Nome do produto</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Preço unitário padrão (R$)</label>
          <input
            type="number"
            step="0.01"
            className="input text-2xl font-bold"
            value={price}
            onChange={(e) => setPrice(parseFloat(e.target.value || "0"))}
          />
          <p className="text-xs text-coco-600 mt-1">
            Atual: {brl(Number(settings?.unit_price ?? 0))}
          </p>
        </div>

        {error && <p className="text-red-700 text-sm">{error}</p>}
        {msg && <p className="text-green-700 text-sm">{msg}</p>}

        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
