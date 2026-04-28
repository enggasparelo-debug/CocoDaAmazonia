import RoleGate from "@/components/RoleGate";

export default function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RoleGate allow={["admin"]}>{children}</RoleGate>;
}
