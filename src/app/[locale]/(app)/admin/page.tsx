import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/get-user";
import { canManageMeetingRooms, hasCapability } from "@/lib/auth/rbac";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const isAdmin =
    user.globalRole === "admin" || user.globalRole === "super_admin";

  // Les porteurs de badge (sans socle admin) atterrissent sur leur onglet dédié.
  if (!isAdmin) {
    if (canManageMeetingRooms(user.globalRole, user.capabilities)) {
      redirect("/admin/meeting-rooms");
    }
    if (
      hasCapability(user.capabilities, "template_doc_editor") ||
      hasCapability(user.capabilities, "template_graphic_editor")
    ) {
      redirect("/admin/templates");
    }
  }
  redirect("/admin/users");
}
