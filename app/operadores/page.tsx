import RoleGate from "@/components/RoleGate";
import OperadoresClient from "./OperadoresClient";

export default function Page() {
  return (
    <RoleGate allow={["admin"]}>
      <OperadoresClient />
    </RoleGate>
  );
}
