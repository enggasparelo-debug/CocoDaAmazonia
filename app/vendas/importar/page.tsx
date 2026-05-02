import RoleGate from "@/components/RoleGate";
import ImportClient from "./ImportClient";

export default function Page() {
  return (
    <RoleGate allow={["admin"]}>
      <ImportClient />
    </RoleGate>
  );
}
