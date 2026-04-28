import RoleGate from "@/components/RoleGate";

export default function CargaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RoleGate allow={["admin", "operador"]}>{children}</RoleGate>;
}
