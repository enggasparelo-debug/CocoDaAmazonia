import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Role = "admin" | "operador";

export async function getMembership(): Promise<{
  userId: string;
  tenantId: string;
  role: Role;
} | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: m } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!m) return null;
  return {
    userId: user.id,
    tenantId: m.tenant_id as string,
    role: m.role as Role,
  };
}

export default async function RoleGate({
  allow,
  children,
}: {
  allow: Role[];
  children: React.ReactNode;
}) {
  const m = await getMembership();
  if (!m) redirect("/login");
  if (!allow.includes(m.role)) redirect("/");
  return <>{children}</>;
}
