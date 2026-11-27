/** Constantes et types des vues enregistrées, sûrs pour le client (aucun accès base). */
export const SAVED_VIEW_NAME_MAX = 80;
export const SAVED_VIEWS_PER_USER_MAX = 50;

export type SavedViewDto = {
  id: string;
  name: string;
  query: string;
  shared: boolean;
  mine: boolean;
};
