/** Identifiants de modules connus du kernel. Étendu au fil des migrations de features. */
export type ModuleId =
  | "meeting-rooms"
  | "livekit"
  | "whisper"
  | "collab"
  | "ldap"
  | "ai"
  | "email"
  | "backup"
  | "images"
  | "automations"
  | "studio"
  | "studiovideo"
  | "presentations"
  | "voice-notes"
  | "library"
  | "crm"
  | "commercial";

/**
 * Regroupement des modules dans l'écran d'administration unique.
 * Union fermée : l'UI n'affiche que ces sections, dans cet ordre.
 */
export type ModuleCategory =
  | "communication"
  | "ia"
  | "contenu"
  | "infrastructure";

/**
 * Nom d'icône lucide. Union fermée plutôt que `string` : l'UI garde un
 * dictionnaire explicite nom → composant, ce qui laisse le reste de lucide
 * hors du bundle et fait échouer la compilation si un manifeste invente un nom.
 */
export type ModuleIconName =
  | "door-open"
  | "wifi"
  | "mic"
  | "users"
  | "network"
  | "brain"
  | "mail"
  | "database-backup"
  | "images"
  | "zap"
  | "palette"
  | "clapperboard"
  | "presentation"
  | "audio-lines"
  | "library-big"
  | "briefcase";

/** Sonde exposée par `/api/admin/services/health` (clés de sa réponse). */
export type ModuleHealthProbe =
  | "livekit"
  | "whisper"
  | "collab"
  | "ldap"
  | "ai"
  | "email"
  | "backup"
  | "meetingRooms";

/** Rôle minimal habilité à basculer l'interrupteur d'un module. */
export type ModuleManageRole = "admin" | "super_admin";

export interface NavContribution {
  id: string;
  label: string;
  href: string;
  section?: string;
}

export interface ModuleManifest {
  id: ModuleId;
  name: string;
  description: string;
  /** Modules dont celui-ci dépend (graphe acyclique). */
  dependencies: ModuleId[];
  /** Niveau vendeur : "core" = toujours autorisé, "licensed" = nécessite la licence. */
  entitlement: "core" | "licensed";
  /** État par défaut côté client si aucun toggle stocké. */
  defaultEnabled: boolean;
  /** Section de l'écran d'administration unique. */
  category: ModuleCategory;
  /** Icône affichée sur la carte du module. */
  icon: ModuleIconName;
  /** Rôle minimal pour basculer l'interrupteur. Les modules `licensed`
   *  restent réservés au super_admin (ils engagent le contrat de licence). */
  manageRole: ModuleManageRole;
  /** Page de configuration du module, si elle existe. */
  configHref?: string;
  /** Sonde de santé à afficher sur la carte, si le module en a une. */
  healthProbe?: ModuleHealthProbe;
  /** Contributions à la navigation (consommées par les sous-projets suivants). */
  nav: NavContribution[];
  /** Clé de toggle alternative (rétro-compat). Défaut: "module_enabled::<id>". */
  toggleKey?: string;
  /** Sous-champ booléen dans la valeur JSON (rétro-compat). Sinon valeur lue comme bool | {enabled}. */
  toggleField?: string;
  /** Fonctions fournies : clés d'extensions TipTap chargées seulement si module ACTIF. */
  editorExtensions?: string[];
  /** /commandes fournies : titres de slash commands (inventaire déclaratif). */
  slashCommands?: string[];
  /** Globs des fichiers que ce module possède (prune SP2). Un chemin n'est
   *  supprimé que si AUCUN module inclus ne le déclare (ref-count). Formes
   *  acceptées : `dir/**`, `dir/fichier.ts`, `prefixe-*`. */
  ownedPaths?: string[];
  /** Module interne : jamais affiché dans l'écran d'administration ni dans le catalogue vendable. */
  internal?: boolean;
  /** Chemins d'import des fichiers d'enregistrement des hooks du module, par nature.
   *  Chaque fichier exporte `register`. Alimente les barils `hooks.*.generated.ts`. */
  hooks?: {
    server?: string;
    client?: string;
    env?: string;
    http?: string;
  };
}

export type ModuleStatus =
  | "active" // compilé ∧ autorisé ∧ activé ∧ dépendances actives
  | "disabled" // compilé ∧ autorisé mais toggle off
  | "locked" // compilé mais non autorisé (entitlement manquant)
  | "unavailable" // non compilé (absent de l'image)
  | "blocked-deps"; // toutes conditions OK sauf une dépendance inactive

export interface ModuleState {
  id: ModuleId;
  status: ModuleStatus;
  compiled: boolean;
  entitled: boolean;
  toggledOn: boolean;
  missingDeps: ModuleId[];
}

export interface EnablementContext {
  /** Modules présents dans l'image (= membres du registre pour l'instant). */
  compiled: Set<ModuleId>;
  /** Ids des modules autorisés par la licence (socle plan ∪ add-ons). */
  entitledModuleIds: Set<string>;
  /** moduleId -> toggle stocké (absent = defaultEnabled du manifeste). */
  toggles: Record<string, boolean>;
}
