import { CrmShellPage } from "@/components/crm/shell/crm-shell-page"
import { DossiersScreen } from "@/components/crm/dossiers/dossiers-screen"

export default async function CrmDossiersPage() {
  return (
    <CrmShellPage screen="dossiers">
      <DossiersScreen />
    </CrmShellPage>
  )
}
