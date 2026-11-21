// Signal global de rafraîchissement de la sidebar.
//
// La sidebar (`AppSidebar`) charge spaces/documents dans un state local via fetch.
// Une mutation effectuée AILLEURS (espace de travail, réglages d'espace, dialog de
// déplacement…) n'a aucun moyen de la prévenir → l'arborescence ne se met à jour
// qu'après un F5. Ce petit bus d'événements permet à n'importe quel composant de
// signaler un changement ; la sidebar réécoute et recharge.
//
// Inerte côté serveur et sans listener : `emitSidebarRefresh()` est sûr à appeler
// partout, après le succès d'une mutation (création / déplacement / renommage /
// suppression de document, espace, emoji…).

export const SIDEBAR_REFRESH_EVENT = "loriax:sidebar-refresh";

export function emitSidebarRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SIDEBAR_REFRESH_EVENT));
}
