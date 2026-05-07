"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fmtDateOnly } from "@/lib/format";
import { useToast } from "@/components/Toast";
import ConfirmModal from "@/components/ConfirmModal";
import { useTenant } from "@/lib/useTenant";
import type { Membership, Seller } from "@/lib/types";
import { SkeletonRows } from "@/components/Skeleton";

type Row = Membership & { seller_name: string | null };

export default function OperadoresAdminClient() {
  const supabase = createClient();
  const toast = useToast();
  const { userId: myUserId } = useTenant();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Row | null>(null);

  async function load() {
    setLoading(true);
    const [m, s] = await Promise.all([
      supabase.from("memberships").select("*").order("created_at"),
      supabase.from("sellers").select("*"),
    ]);
    const memberships = (m.data as Membership[]) ?? [];
    const sellers = (s.data as Seller[]) ?? [];
    const merged: Row[] = memberships.map((mb) => ({
      ...mb,
      seller_name:
        sellers.find((sl) => sl.user_id === mb.user_id)?.name ?? null,
    }));
    setRows(merged);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function changeRole(r: Row, role: "admin" | "operador") {
    if (busyUserId) return;
    setBusyUserId(r.user_id);
    const { error } = await supabase.rpc("set_membership_role", {
      p_user_id: r.user_id,
      p_role: role,
    });
    setBusyUserId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Role atualizada pra ${role}.`);
    load();
  }

  async function remove(r: Row) {
    setBusyUserId(r.user_id);
    const { error } = await supabase.rpc("remove_membership", {
      p_user_id: r.user_id,
    });
    setBusyUserId(null);
    setConfirmRemove(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Membro removido.");
    load();
  }

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/configuracoes"
          className="text-coco-700 underline text-sm"
        >
          ← Voltar
        </Link>
        <h1 className="text-3xl font-bold text-coco-900">
          Operadores e admins
        </h1>
        <p className="text-coco-600">
          Gerencia roles dos membros desta loja. Convidar novo operador
          ainda exige cadastro do email no Supabase Auth (próximo passo).
        </p>
      </header>

      <div className="card">
        {loading ? (
          <SkeletonRows count={4} />
        ) : rows.length === 0 ? (
          <p className="text-coco-600">Sem membros cadastrados.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Vendedor vinculado</th>
                <th>User ID</th>
                <th>Role</th>
                <th>Cadastrado</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isMe = r.user_id === myUserId;
                const busy = busyUserId === r.user_id;
                return (
                  <tr key={r.user_id}>
                    <td className="font-medium">
                      {r.seller_name ?? (
                        <span className="text-coco-500 italic text-sm">
                          (não vinculado)
                        </span>
                      )}
                      {isMe && (
                        <span className="ml-2 text-xs text-coco-600">
                          (você)
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-xs">
                      {r.user_id.slice(0, 8)}…
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          r.role === "admin"
                            ? "bg-coco-100 text-coco-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {r.role}
                      </span>
                    </td>
                    <td>{fmtDateOnly(r.created_at)}</td>
                    <td className="text-right whitespace-nowrap">
                      {!isMe && (
                        <>
                          {r.role === "operador" ? (
                            <button
                              onClick={() => changeRole(r, "admin")}
                              disabled={busy}
                              className="btn-ghost text-xs"
                            >
                              Promover a admin
                            </button>
                          ) : (
                            <button
                              onClick={() => changeRole(r, "operador")}
                              disabled={busy}
                              className="btn-ghost text-xs"
                            >
                              Rebaixar pra operador
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmRemove(r)}
                            disabled={busy}
                            className="btn-ghost text-xs text-red-700"
                          >
                            Remover
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card text-sm text-coco-700">
        <h2 className="font-bold text-coco-900 mb-2">
          Como adicionar um novo operador
        </h2>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            No Supabase Dashboard → Authentication → Users, clique em{" "}
            <strong>Invite user</strong> e mande pro email do operador.
          </li>
          <li>
            O operador cria a senha. Na primeira vez que ele logar, o trigger{" "}
            <code>handle_new_user</code> cria automaticamente uma membership
            com role <code>operador</code> nesta loja.
          </li>
          <li>
            Volte aqui e (opcional) cadastre o vendedor em{" "}
            <Link
              href="/configuracoes/vendedores"
              className="underline"
            >
              Vendedores
            </Link>{" "}
            vinculando ao login dele.
          </li>
        </ol>
      </div>

      {confirmRemove && (
        <ConfirmModal
          title="Remover este membro?"
          danger
          confirmText="Remover"
          message={
            <>
              Vai apagar a membership de{" "}
              <strong>
                {confirmRemove.seller_name ??
                  confirmRemove.user_id.slice(0, 8) + "…"}
              </strong>
              . O usuário deixa de ter acesso a esta loja, mas o login no
              Supabase Auth continua existindo (apague separadamente se
              quiser).
            </>
          }
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => remove(confirmRemove)}
        />
      )}
    </div>
  );
}
