import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/get-user";
import { canManageMeetingRooms } from "@/lib/auth/rbac";
import { isMeetingRoomsEnabled } from "@/lib/meeting-rooms/feature-flag";
import { getModuleScopeOrgId } from "@/lib/modules/org-context";
import { AdminMeetingRoomsTab } from "./meeting-rooms-tab";
import { BackToServices } from "@/components/admin/back-to-services";
import { ModuleActivationNotice } from "@/components/admin/module-activation-notice";

export default async function AdminMeetingRoomsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canManageMeetingRooms(user.globalRole, user.capabilities)) redirect("/admin");

  // Module éteint : on affiche quand même l'écran de configuration, avec le
  // bandeau d'activation. Rediriger vers /admin/system envoyait le lien
  // « Configurer » de la carte Salles de réunion sur une page sans rapport.
  const enabled = await isMeetingRoomsEnabled(await getModuleScopeOrgId());

  return (
    <div className="pb-24">
      <BackToServices />
      <ModuleActivationNotice enabled={enabled} moduleName="Salles de réunion" />
      <div className="mt-6">
        <AdminMeetingRoomsTab />
      </div>
    </div>
  );
}
