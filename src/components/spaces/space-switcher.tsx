"use client";

import { useMemo } from "react";
import { FolderOpen } from "lucide-react";
import { useRouter } from "@/i18n/routing";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setLastSpaceCookie } from "@/lib/spaces/last-space-cookie";

/**
 * Sélecteur d'espace d'une page de liste (tableaux de bord, présentations).
 * L'espace choisi est porté par l'URL (`?spaceId=`, convention de `/bases` et
 * `/automations`) et mémorisé dans le cookie du dernier espace : la page
 * serveur reste seule juge, elle ignore tout espace non accessible.
 */
export function SpaceSwitcher({
  spaces,
  currentSpaceId,
  basePath,
  label,
}: {
  spaces: { id: string; name: string }[];
  currentSpaceId: string;
  /** Chemin de la page sans locale, ex. `/dashboards`. */
  basePath: string;
  /** Libellé accessible et info-bulle du sélecteur. */
  label: string;
}) {
  const router = useRouter();
  // Correspondance valeur → libellé mémoïsée sur son contenu : un `items`
  // instable est réécrit dans le store du Select à chaque rendu.
  const signature = JSON.stringify(spaces.map((s) => [s.id, s.name]));
  const items = useMemo(
    () => Object.fromEntries(JSON.parse(signature) as [string, string][]),
    [signature]
  );

  return (
    <Select
      value={currentSpaceId}
      items={items}
      onValueChange={(value) => {
        if (!value || value === currentSpaceId) return;
        setLastSpaceCookie(value);
        router.push(`${basePath}?spaceId=${encodeURIComponent(value)}`);
      }}
    >
      <SelectTrigger aria-label={label} title={label} className="min-w-44 max-w-64">
        <FolderOpen aria-hidden="true" className="text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {spaces.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
