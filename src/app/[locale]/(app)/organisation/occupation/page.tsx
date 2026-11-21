import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/get-user";
import { canManageMeetingRooms } from "@/lib/auth/rbac";
import { isMeetingRoomsEnabled } from "@/lib/meeting-rooms/feature-flag";
import { getModuleScopeOrgId } from "@/lib/modules/org-context";
import { OccupancyClient } from "./occupancy-client";

export default async function OccupationPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const enabled = await isMeetingRoomsEnabled(await getModuleScopeOrgId());
  if (!enabled) redirect("/organisation");
  if (!canManageMeetingRooms(user.globalRole, user.capabilities)) redirect("/organisation/salles");
  return <OccupancyClient />;
}
