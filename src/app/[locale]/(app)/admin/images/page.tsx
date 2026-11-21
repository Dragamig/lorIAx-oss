import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { ImageAdminClient } from "./image-admin-client";
import { BackToServices } from "@/components/admin/back-to-services";

export default async function AdminImagesPage() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) redirect("/");

  return (
    <div className="pb-24">
      <BackToServices />
      <h1 className="text-2xl font-bold mb-6">Bibliothèque d&apos;images</h1>
      <ImageAdminClient />
    </div>
  );
}
