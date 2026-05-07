import { redirect } from "next/navigation";
import { getMembership } from "@/components/RoleGate";
import DashboardClient from "./Dashboard.client";

export default async function Home() {
  const m = await getMembership();
  if (!m) redirect("/login");
  if (m.role === "operador") redirect("/carga");
  return <DashboardClient />;
}
