import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

export const MetaContext = Extension.create({
  name: "metaContext",
  addStorage() {
    return {
      spaceId: "",
      docId: "",
    };
  },
});

/**
 * Identifiant du document porteur, tel qu'exposé par MetaContext.
 *
 * Les blocs canevas (tableau blanc, mind map, design) le transmettent à l'API :
 * c'est lui qui rattache la ressource à un document et rend le contrôle
 * d'accès possible côté serveur. Retourne `undefined` si le contexte n'est pas
 * (encore) renseigné, auquel cas le serveur retombe sur le lien déjà stocké.
 */
export function getMetaDocId(editor?: Editor | null): string | undefined {
  type MetaStorage = { metaContext?: { spaceId: string; docId: string } };
  const docId = (editor?.storage as MetaStorage | undefined)?.metaContext?.docId;
  return docId || undefined;
}
