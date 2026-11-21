import { Link } from "@/i18n/routing";
import { Building2, DoorOpen, BarChart3, ArrowRight, Palette } from "lucide-react";
import { isMeetingRoomsEnabled } from "@/lib/meeting-rooms/feature-flag";
import { getModuleScopeOrgId } from "@/lib/modules/org-context";
import { getTranslations } from "next-intl/server";

export default async function OrganisationPage() {
  const meetingRoomsEnabled = await isMeetingRoomsEnabled(await getModuleScopeOrgId());
  const t = await getTranslations("organisation");

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold">{t("overview.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("overview.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {meetingRoomsEnabled && (
          <>
            <OrgCard
              href="/organisation/salles"
              title={t("overview.roomsCard.title")}
              description={t("overview.roomsCard.description")}
              icon={<DoorOpen className="h-5 w-5" />}
            />
            <OrgCard
              href="/organisation/occupation"
              title={t("overview.occupationCard.title")}
              description={t("overview.occupationCard.description")}
              icon={<BarChart3 className="h-5 w-5" />}
            />
          </>
        )}

        <OrgCard
          href="/organisation/marque"
          title="Identité de marque"
          description="Couleurs, logos et polices utilisables dans le Studio de design."
          icon={<Palette className="h-5 w-5" />}
        />

        {!meetingRoomsEnabled && (
          <div className="md:col-span-2 rounded-lg border border-dashed border-border p-8 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{t("overview.noModule.title")}</p>
            <p className="text-xs text-muted-foreground">
              {t("overview.noModule.description")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function OrgCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border bg-card p-4 hover:border-primary transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-primary">{icon}</div>
        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </Link>
  );
}
