"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push(next);
        router.refresh();
      } else {
        const { error, data } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.push(next);
          router.refresh();
        } else {
          setInfo(
            "Conta criada. Verifique seu e-mail para confirmar antes de entrar."
          );
          setMode("signin");
        }
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-coco-50 p-6">
      <div className="card w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-5xl">🥥</div>
          <h1 className="text-2xl font-bold text-coco-900 mt-2">
            Coco da Amazônia
          </h1>
          <p className="text-coco-700 text-sm">
            {mode === "signin" ? "Entrar para operar" : "Criar conta"}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">E-mail</label>
            <input
              type="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Senha</label>
            <input
              type="password"
              required
              minLength={6}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-xl p-3">
              {error}
            </div>
          )}
          {info && (
            <div className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-xl p-3">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading
              ? "…"
              : mode === "signin"
              ? "Entrar"
              : "Criar conta"}
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="btn-ghost w-full"
          >
            {mode === "signin"
              ? "Ainda não tenho conta — criar"
              : "Já tenho conta — entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
