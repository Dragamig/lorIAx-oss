import { redirect } from "next/navigation";
import { isMeetingRoomsEnabled } from "@/lib/meeting-rooms/feature-flag";
import { getModuleScopeOrgId } from "@/lib/modules/org-context";
import { RoomsListClient } from "./rooms-list-client";

export default async function SallesPage() {
  const enabled = await isMeetingRoomsEnabled(await getModuleScopeOrgId());
  if (!enabled) redirect("/organisation");
  return <RoomsListClient />;
}
