"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tenant, Membership } from "@/lib/types";

export type TenantContext = {
  loading: boolean;
  tenant: Tenant | null;
  membership: Membership | null;
  isAdmin: boolean;
  refresh: () => Promise<void>;
};

export function useTenant(): TenantContext {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);

  async function load() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setTenant(null);
      setMembership(null);
      setLoading(false);
      return;
    }
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
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    loading,
    tenant,
    membership,
    isAdmin: membership?.role === "admin",
    refresh: load,
  };
}
