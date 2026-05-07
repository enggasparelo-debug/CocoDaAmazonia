"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tenant, Membership, Seller } from "@/lib/types";

export type TenantContext = {
  loading: boolean;
  tenant: Tenant | null;
  membership: Membership | null;
  isAdmin: boolean;
  isOperator: boolean;
  userId: string | null;
  seller: Seller | null;
  refresh: () => Promise<void>;
};

export function useTenant(): TenantContext {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [seller, setSeller] = useState<Seller | null>(null);

  // `supabase` é memoizado por @supabase/ssr (createBrowserClient é
  // singleton-ish), então usar como dep não causa loops.
  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setTenant(null);
      setMembership(null);
      setUserId(null);
      setSeller(null);
      setLoading(false);
      return;
    }
    setUserId(user.id);
    const { data: m } = await supabase
      .from("memberships")
      .select("*")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    setMembership((m as Membership) ?? null);
    if (m) {
      const { data: t } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", m.tenant_id)
        .maybeSingle();
      setTenant((t as Tenant) ?? null);
    }
    // Vendedor vinculado ao login (pode não existir; não é erro)
    const { data: sl } = await supabase
      .from("sellers")
      .select("*")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();
    setSeller((sl as Seller | null) ?? null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    tenant,
    membership,
    isAdmin: membership?.role === "admin",
    isOperator: membership?.role === "operador",
    userId,
    seller,
    refresh: load,
  };
}
