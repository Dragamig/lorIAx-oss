import { redirect } from "next/navigation";
import { Link } from "@/i18n/routing";
import { Building2, DoorOpen, BarChart3, Palette } from "lucide-react";
import { getSessionUser } from "@/lib/auth/get-user";
import { isMeetingRoomsEnabled } from "@/lib/meeting-rooms/feature-flag";
import { getModuleScopeOrgId } from "@/lib/modules/org-context";
import { getTranslations } from "next-intl/server";

interface Props {
  children: React.ReactNode;
}

export default async function OrganisationLayout({ children }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const meetingRoomsEnabled = await isMeetingRoomsEnabled(await getModuleScopeOrgId());
  const t = await getTranslations("organisation");

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3 mb-4">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <nav className="flex gap-1 flex-wrap">
          <OrgTab
            href="/organisation"
            label={t("tabs.overview")}
            icon={<Building2 className="h-4 w-4" />}
          />
          <OrgTab
            href="/organisation/marque"
            label="Identité de marque"
            icon={<Palette className="h-4 w-4" />}
          />
          {meetingRoomsEnabled && (
            <>
              <OrgTab
                href="/organisation/salles"
                label={t("tabs.rooms")}
                icon={<DoorOpen className="h-4 w-4" />}
              />
              <OrgTab
                href="/organisation/occupation"
                label={t("tabs.occupation")}
                icon={<BarChart3 className="h-4 w-4" />}
              />
            </>
          )}
        </nav>
      </header>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

function OrgTab({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {icon}
      {label}
    </Link>
  );
}
