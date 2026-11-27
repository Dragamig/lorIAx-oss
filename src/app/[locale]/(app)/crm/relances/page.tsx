import { CrmShellPage } from "@/components/crm/shell/crm-shell-page"
import { RelancesScreen } from "@/components/crm/relances/relances-screen"

export default async function CrmRelancesPage() {
  return (
    <CrmShellPage screen="relances">
      <RelancesScreen />
    </CrmShellPage>
  )
}
