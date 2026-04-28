import RoleGate from "@/components/RoleGate";

export default function CargasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RoleGate allow={["admin"]}>{children}</RoleGate>;
}
