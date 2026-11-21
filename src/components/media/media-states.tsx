"use client"

import { useTranslations } from "next-intl"
import { AlertTriangle, ImageOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

export function MediaEmptyState({
  hasActiveFilters,
  onResetFilters,
}: {
  hasActiveFilters?: boolean
  onResetFilters?: () => void
}) {
  const t = useTranslations("library")
  return (
    <EmptyState
      icon={ImageOff}
      title={hasActiveFilters ? t("states.emptyFiltered") : t("states.empty")}
      action={
        hasActiveFilters && onResetFilters ? (
          <Button variant="outline" onClick={onResetFilters}>
            {t("actions.resetFilters")}
          </Button>
        ) : undefined
      }
    />
  )
}

export function LibraryErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("library.states")
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
      <p className="text-sm text-muted-foreground">{t("error")}</p>
      <Button variant="outline" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  )
}

/** Échec du chargement d'une page suivante : la liste déjà chargée reste affichée. */
export function LoadMoreError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("library.states")
  return (
    <div role="alert" className="flex items-center justify-center gap-3 py-3 text-sm text-muted-foreground">
      <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
      <span>{t("loadMoreError")}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  )
}
