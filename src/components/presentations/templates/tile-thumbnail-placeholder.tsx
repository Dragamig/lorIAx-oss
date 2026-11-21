import { Presentation } from "lucide-react";

/** Vignette neutre des tuiles : la liste des modèles ne porte pas le contenu des diapositives. */
export function TileThumbnailPlaceholder() {
  return (
    <span className="bg-muted text-muted-foreground flex h-full w-full items-center justify-center">
      <Presentation className="size-8" aria-hidden="true" />
    </span>
  );
}
