// loriax-app/src/app/[locale]/(app)/settings/profile/page.tsx
// Page profil utilisateur — pour l'instant : section badges d'onboarding.
// Ancrée par /settings/profile#badges (lien depuis la checklist d'onboarding).

import { BadgesPanel } from "@/components/onboarding/badges-panel";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Mon profil</h1>
        <p className="text-sm text-muted-foreground">
          Tes badges et ta progression dans LorIAx.
        </p>
      </header>
      <BadgesPanel />
    </div>
  );
}
