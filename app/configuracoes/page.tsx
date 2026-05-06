"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { ProductSettings, Tenant } from "@/lib/types";
import { brl } from "@/lib/format";
import { useTenant } from "@/lib/useTenant";
import { useToast } from "@/components/Toast";
import PushOptIn from "@/components/PushOptIn";

export default function ConfiguracoesPage() {
  const supabase = createClient();
  const toast = useToast();
  const { tenant, isAdmin, refresh } = useTenant();
  const [settings, setSettings] = useState<ProductSettings | null>(null);
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState(0);
  const [minStock, setMinStock] = useState<number>(0);

  const [biz, setBiz] = useState<Partial<Tenant>>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("product_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (data) {
      setSettings(data as ProductSettings);
      setProductName(data.name);
      setPrice(Number(data.unit_price));
      setMinStock(Number(data.min_stock ?? 0));
    }
  }
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (tenant) setBiz(tenant);
  }, [tenant]);

  async function saveProduct() {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from("product_settings")
      .update({
        name: productName,
        unit_price: price,
        min_stock: minStock,
        updated_at: new Date().toISOString(),
      })
      .eq("id", settings.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Produto atualizado.");
    load();
  }

  async function saveBiz() {
    if (!tenant) return;
    if (!isAdmin)
      return toast.error("Apenas administradores podem alterar a empresa.");
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        name: biz.name ?? tenant.name,
        cnpj: biz.cnpj ?? null,
        phone: biz.phone ?? null,
        address: biz.address ?? null,
        receipt_msg: biz.receipt_msg ?? null,
        edit_window_hours: biz.edit_window_hours ?? 24,
      })
      .eq("id", tenant.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Empresa atualizada.");
    refresh();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-coco-900">Configurações</h1>
        <p className="text-coco-600">
          Empresa, produto, regras e notificações.
        </p>
      </header>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card space-y-3">
          <h2 className="font-bold text-coco-900">Empresa</h2>
          {!isAdmin && (
            <p className="text-xs text-amber-700">
              Visualização apenas. Apenas administradores podem editar.
            </p>
          )}
          <div>
            <label className="label">Nome</label>
            <input
              className="input"
              value={biz.name ?? ""}
              onChange={(e) => setBiz({ ...biz, name: e.target.value })}
              disabled={!isAdmin}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">CNPJ / CPF</label>
              <input
                className="input"
                value={biz.cnpj ?? ""}
                onChange={(e) => setBiz({ ...biz, cnpj: e.target.value })}
                disabled={!isAdmin}
              />
            </div>
            <div>
              <label className="label">Telefone</label>
              <input
                className="input"
                value={biz.phone ?? ""}
                onChange={(e) => setBiz({ ...biz, phone: e.target.value })}
                disabled={!isAdmin}
              />
            </div>
          </div>
          <div>
            <label className="label">Endereço</label>
            <input
              className="input"
              value={biz.address ?? ""}
              onChange={(e) => setBiz({ ...biz, address: e.target.value })}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="label">Mensagem do recibo</label>
            <input
              className="input"
              value={biz.receipt_msg ?? ""}
              placeholder="Ex.: Obrigado pela preferência!"
              onChange={(e) => setBiz({ ...biz, receipt_msg: e.target.value })}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="label">
              Janela de edição de venda (horas)
            </label>
            <input
              type="number"
              min={0}
              className="input w-32"
              value={biz.edit_window_hours ?? 24}
              onChange={(e) =>
                setBiz({
                  ...biz,
                  edit_window_hours: parseInt(e.target.value || "0"),
                })
              }
              disabled={!isAdmin}
            />
            <p className="text-xs text-coco-600 mt-1">
              Após este tempo, vendas só podem ser editadas/canceladas por
              admin. Coloque 0 para sempre exigir admin.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={saveBiz}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? "…" : "Salvar empresa"}
            </button>
          )}
        </div>

        <div className="card space-y-3">
          <h2 className="font-bold text-coco-900">Produto</h2>
          <div>
            <label className="label">Nome</label>
            <input
              className="input"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Preço padrão</label>
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
            <div>
              <label className="label">Estoque mínimo (alerta)</label>
              <input
                type="number"
                min={0}
                className="input"
                value={minStock}
                onChange={(e) => setMinStock(parseInt(e.target.value || "0"))}
              />
              <p className="text-xs text-coco-600 mt-1">
                Aparece alerta quando o saldo cair abaixo deste valor.
              </p>
            </div>
          </div>
          <button
            onClick={saveProduct}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? "…" : "Salvar produto"}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold text-coco-900 mb-2">Cadastros auxiliares</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/configuracoes/veiculos" className="btn-secondary">
            🚚 Veículos
          </Link>
          <Link href="/configuracoes/rotas" className="btn-secondary">
            🗺️ Rotas
          </Link>
          <Link href="/configuracoes/vendedores" className="btn-secondary">
            🧑‍💼 Vendedores
          </Link>
          <Link href="/configuracoes/operadores" className="btn-secondary">
            👥 Operadores e admins
          </Link>
          <Link href="/configuracoes/categorias" className="btn-secondary">
            🏷️ Categorias de despesa
          </Link>
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold text-coco-900 mb-2">Notificações</h2>
        <PushOptIn />
      </div>
    </div>
  );
}
