import RoleGate from "@/components/RoleGate";
import DRE from "./DRE";

export default function Page() {
  return (
    <RoleGate allow={["admin"]}>
      <DRE />
    </RoleGate>
  );
}
