import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { BackToServices } from "@/components/admin/back-to-services";
import { LibraryAdminClient } from "./library-admin-client";

export default async function AdminLibraryPage() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) redirect("/");
  const t = await getTranslations("library.admin");

  return (
    <div className="pb-24">
      <BackToServices />
      <h1 className="text-2xl font-bold mb-6">{t("title")}</h1>
      <LibraryAdminClient />
    </div>
  );
}
