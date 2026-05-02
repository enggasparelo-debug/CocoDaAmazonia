import RoleGate from "@/components/RoleGate";
import ImportClient from "./ImportClient";

export default function Page({
  searchParams,
}: {
  searchParams: { cargaId?: string };
}) {
  return (
    <RoleGate allow={["admin"]}>
      <ImportClient lockedCargaId={searchParams.cargaId ?? null} />
    </RoleGate>
  );
}
