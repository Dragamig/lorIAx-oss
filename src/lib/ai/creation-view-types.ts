import type { AiCreationKind, AiCreationStatus } from "@/lib/db/schema-ai-creation-proposals";

export type CreationSpaceOption = { id: string; name: string };

export type CreationPreview =
  | {
      kind: "spreadsheet";
      columns: { name: string; type?: "text" | "number" | "date" }[];
      rows: string[][];
      rowCount: number;
    }
  | {
      kind: "document";
      outline: { heading: string; level: 1 | 2 | 3 }[];
      visibility: "private" | "team" | "public";
      /** Markdown intégral qui sera écrit (remplace le plan) ; absent si le document découle du plan. */
      body?: string;
    }
  | { kind: "presentation"; slides: { title: string; layout?: "cover" | "content" | "closing" }[] };

/** Vue client d'une proposition de création : aucune clé de stockage ni identité. */
export type CreationView = {
  id: string;
  kind: AiCreationKind;
  status: AiCreationStatus;
  title: string;
  spaceId: string;
  spaceName: string;
  createdAt: string;
  expiresAt: string;
  /** Droit éditeur sur l'espace cible, relu à l'instant de la requête. */
  canApply: boolean;
  /** Espaces où l'utilisateur est éditeur dans l'organisation courante. */
  editableSpaces: CreationSpaceOption[];
  preview: CreationPreview;
  result: { id: string; title: string; href: string } | null;
};
