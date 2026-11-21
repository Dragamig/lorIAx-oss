"use client"

import { CrmErrorState } from "@/components/crm/crm-states"

export default function CrmError({ reset }: { error: Error; reset: () => void }) {
  return <CrmErrorState onRetry={reset} />
}
