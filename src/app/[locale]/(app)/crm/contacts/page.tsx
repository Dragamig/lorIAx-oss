import { CrmShellPage } from "@/components/crm/shell/crm-shell-page"
import { ContactsScreen } from "@/components/crm/contacts/contacts-screen"

export default async function CrmContactsPage() {
  return (
    <CrmShellPage screen="contacts">
      <ContactsScreen />
    </CrmShellPage>
  )
}
