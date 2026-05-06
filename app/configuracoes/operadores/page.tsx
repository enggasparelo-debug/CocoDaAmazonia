import RoleGate from "@/components/RoleGate";
import OperadoresAdminClient from "./OperadoresAdminClient";

export default function Page() {
  return (
    <RoleGate allow={["admin"]}>
      <OperadoresAdminClient />
    </RoleGate>
  );
}
