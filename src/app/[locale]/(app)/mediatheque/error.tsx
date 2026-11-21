"use client"

import { LibraryErrorState } from "@/components/media/library-page"

export default function MediathequeError({ reset }: { error: Error; reset: () => void }) {
  return <LibraryErrorState onRetry={reset} />
}
