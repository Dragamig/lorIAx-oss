import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { AutomationsAdminClient } from "./automations-admin-client";
import { BackToServices } from "@/components/admin/back-to-services";

export const dynamic = "force-dynamic";

export default async function AdminAutomationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasGlobalRole(user.globalRole, "admin")) redirect("/admin");

  return (
    <div className="h-full overflow-y-auto p-6 pb-24">
      <div className="mx-auto max-w-6xl">
        <BackToServices />
        <h1 className="mb-1 text-xl font-semibold">Automatismes</h1>
        <p className="mb-6 text-sm text-neutral-500">
          Activation globale, inventaire des automatisations et journal de
          déclenchement.
        </p>
        <AutomationsAdminClient />
      </div>
    </div>
  );
}
