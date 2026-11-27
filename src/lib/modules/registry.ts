import type { ModuleManifest } from "./types";
import { INCLUDED_MODULE_IDS } from "./registry.generated";

/**
 * Registre des modules compilés dans cette image.
 *
 * Rétro-compat : `toggleKey`/`toggleField` reprennent EXACTEMENT les clés et
 * sous-champs system_settings écrits par /admin/services, pour que kernel et UI
 * Services lisent/écrivent le même réglage sans collision.
 *
 * `entitlement` : "core" = toujours autorisé (collab, images, email) ;
 * "licensed" = autorisé seulement si la licence l'accorde (socle de plan ou
 * add-on). Le mapping plan↔modules vit dans catalog.ts (MODULES_BY_PLAN).
 */
const MANIFESTS: ModuleManifest[] = [
  {
    id: "meeting-rooms",
    name: "Salles de réunion",
    description: "Réservation de salles, occupation, disponibilités.",
    // L'extension InPersonMeetingBlock réutilise le code livekit (capture audio
    // headless : participant-chips, vu-meter, livekit-headless) et whisper
    // (speaker-mapping) pour transcrire les réunions présentielles. Dépendance
    // déclarée pour que la fermeture transitive les embarque → composition
    // toujours cohérente (un profil meeting-rooms sans livekit/whisper casserait
    // le build au prune). whisper dépend déjà de livekit.
    dependencies: ["livekit", "whisper"],
    entitlement: "licensed",
    defaultEnabled: false,
    category: "communication",
    icon: "door-open",
    manageRole: "super_admin",
    configHref: "/admin/meeting-rooms",
    healthProbe: "meetingRooms",
    toggleKey: "meeting_rooms_enabled",
    // Forme canonique en base : {enabled} ; valeur booléenne nue héritage de l'ancienne page Services.
    toggleField: "enabled",
    nav: [],
    editorExtensions: ["InPersonMeetingBlock"],
    slashCommands: ["Réunion présentielle"],
    ownedPaths: [
      "src/app/[locale]/(app)/admin/meeting-rooms/**",
      "src/app/[locale]/(app)/organisation/salles/**",
      "src/app/[locale]/(app)/organisation/occupation/**",
      "src/app/api/meeting-rooms/**",
      "src/tests/api/meeting-rooms-id-siloing.test.ts",
      "src/components/meeting-rooms/**",
      "src/components/editor/extensions/meeting/in-person-meeting-block-node.ts",
      "src/components/editor/extensions/meeting/in-person-meeting-block.tsx",
      "src/components/editor/extensions/meeting/shared/**",
      // lib/meeting-rooms : tout SAUF feature-flag.ts (core-safe, délègue au kernel SP1).
      "src/lib/meeting-rooms/calendar-link.ts",
      "src/lib/meeting-rooms/guards.ts",
      "src/lib/meeting-rooms/holidays-fr.ts",
      "src/lib/meeting-rooms/opening-hours.ts",
      "src/lib/meeting-rooms/permissions.ts",
      // tests du module (tsconfig compile **/*.ts -> pruner conjointement)
      "src/__tests__/meeting-rooms/**",
    ],
  },
  {
    id: "livekit",
    name: "Visioconférence",
    description: "Réunions vidéo en temps réel (LiveKit).",
    dependencies: [],
    entitlement: "licensed",
    defaultEnabled: false,
    category: "communication",
    icon: "wifi",
    manageRole: "super_admin",
    configHref: "/admin/visio",
    healthProbe: "livekit",
    toggleKey: "livekit",
    toggleField: "livekitEnabled",
    nav: [],
    editorExtensions: ["MeetingBlock"],
    slashCommands: ["Réunion"],
    ownedPaths: [
      "src/app/[locale]/(app)/meet/**",
      "src/app/[locale]/(public)/public/meet/**",
      "src/app/api/meet/**",
      "src/app/api/public/meet/**",
      "src/app/api/admin/visio-permissions/**", // route ACL visio — consomme lib/meet/permissions (pruné avec livekit)
      "src/components/meet/**",
      "src/components/editor/extensions/meeting-block-node.ts", // shim racine (l'implémentation est dans meeting/ ci-dessous)
      "src/components/editor/extensions/meeting/meeting-block-node.ts",
      "src/components/editor/extensions/meeting/meeting-block.tsx",
      "src/components/editor/extensions/meeting/livekit-headless.tsx",
      "src/components/editor/extensions/meeting/participant-chips.tsx",
      "src/components/editor/extensions/meeting/vu-meter.tsx",
      "src/components/editor/extensions/meeting/shared/**", // copropriété meeting-rooms — ref-count conserve tant qu'un copropriétaire est inclus
      "src/lib/meet/livekit-config.ts",
      "src/lib/meet/livekit-token.ts",
      "src/lib/meet/egress.ts",
      "src/lib/meet/recording.ts",
      // Infrastructure des réunions LiveKit (table `meetings`, tokens, ACL visio).
      // Utilisée EXCLUSIVEMENT par le code livekit (api/meet/**, visio-permissions) —
      // distincte du module meeting-rooms (réservation de salles physiques).
      "src/lib/meet/rooms.ts",
      "src/lib/meet/permissions.ts",
    ],
  },
  {
    id: "whisper",
    name: "Transcription",
    description: "Transcription audio des réunions (Whisper).",
    dependencies: ["livekit"],
    entitlement: "licensed",
    defaultEnabled: false,
    category: "ia",
    icon: "mic",
    manageRole: "super_admin",
    configHref: "/admin/transcription",
    healthProbe: "whisper",
    toggleKey: "whisper",
    toggleField: "whisperEnabled",
    nav: [],
    ownedPaths: [
      "src/lib/meet/transcribe.ts",
      "src/lib/meet/transcribe-voxtral.ts",
      "src/lib/meet/summarize.ts",
      "src/lib/meet/meeting-notes.ts",
      "src/components/editor/extensions/meeting/speaker-mapping.tsx",
    ],
  },
  {
    id: "collab",
    name: "Collaboration temps réel",
    description: "Édition collaborative simultanée (Yjs).",
    dependencies: [],
    entitlement: "core",
    defaultEnabled: true,
    category: "contenu",
    icon: "users",
    manageRole: "admin",
    configHref: "/admin/system#collaboration",
    healthProbe: "collab",
    toggleKey: "collab",
    toggleField: "collabEnabled",
    nav: [],
  },
  {
    id: "ldap",
    name: "Annuaire LDAP",
    description: "Authentification via annuaire LDAP/AD.",
    dependencies: [],
    entitlement: "licensed",
    defaultEnabled: false,
    category: "infrastructure",
    icon: "network",
    manageRole: "super_admin",
    configHref: "/admin/system#ldap",
    healthProbe: "ldap",
    toggleKey: "ldap",
    toggleField: "ldapEnabled",
    nav: [],
    ownedPaths: [
      "src/lib/auth/ldap.ts",
      "src/lib/auth/ldap-sync.ts",
      "src/app/api/admin/settings/ldap-test/**",
      "src/app/api/setup/users/ldap/**",
      "src/tests/api/admin-settings-connection-tests.test.ts",
    ],
  },
  {
    id: "ai",
    name: "Intelligence artificielle",
    description: "Assistant IA, résumés, RAG (multi-provider).",
    dependencies: [],
    entitlement: "licensed",
    defaultEnabled: false,
    category: "ia",
    icon: "brain",
    manageRole: "super_admin",
    configHref: "/admin/ai",
    healthProbe: "ai",
    toggleKey: "ai_global",
    toggleField: "enabled",
    nav: [],
  },
  {
    id: "email",
    name: "Email",
    description: "Envoi d'emails transactionnels (SMTP / Resend).",
    dependencies: [],
    entitlement: "core",
    defaultEnabled: false,
    category: "infrastructure",
    icon: "mail",
    // AZ-08 : les clés `email` et `smtp` de system_settings sont classées
    // INFRASTRUCTURE (relais de messagerie partagé par TOUS les tenants).
    // /api/admin/settings ne les rend plus à un administrateur d'organisation
    // et refuse leur écriture. Laisser `admin` ici offrait encore la carte et
    // le lien de configuration à qui ne peut rien y lire ni y écrire : le
    // manifeste s'aligne sur ce que le service accepte.
    manageRole: "super_admin",
    configHref: "/admin/emails",
    healthProbe: "email",
    toggleKey: "email",
    toggleField: "emailEnabled",
    nav: [],
  },
  {
    id: "backup",
    name: "Sauvegarde S3",
    description: "Sauvegardes automatiques vers stockage S3.",
    dependencies: [],
    entitlement: "licensed",
    defaultEnabled: false,
    category: "infrastructure",
    icon: "database-backup",
    manageRole: "super_admin",
    configHref: "/admin/backups",
    healthProbe: "backup",
    toggleKey: "backup_s3",
    toggleField: "enabled",
    nav: [],
  },
  {
    id: "images",
    name: "Banque d'images",
    description: "Recherche et insertion d'images (banques externes).",
    dependencies: [],
    entitlement: "core",
    defaultEnabled: false,
    category: "contenu",
    icon: "images",
    manageRole: "admin",
    configHref: "/admin/images",
    toggleKey: "images",
    toggleField: "enabled",
    nav: [],
  },
  {
    id: "automations",
    name: "Automatisations",
    description: "Règles et workflows automatisés.",
    dependencies: [],
    entitlement: "licensed",
    defaultEnabled: true,
    category: "contenu",
    icon: "zap",
    manageRole: "super_admin",
    configHref: "/admin/automations",
    toggleKey: "automations",
    toggleField: "enabled",
    nav: [],
  },
  {
    id: "studio",
    name: "Studio (Design)",
    description: "Canevas de design / création graphique dans l'éditeur.",
    dependencies: [],
    entitlement: "core",
    defaultEnabled: true,
    category: "contenu",
    icon: "palette",
    manageRole: "admin",
    toggleKey: "studio_enabled",
    nav: [],
    editorExtensions: ["DesignBlock"],
    slashCommands: ["Studio"],
    ownedPaths: [
      "src/app/api/designs/**",
      "src/components/editor/extensions/design-*",
    ],
  },
  {
    id: "presentations",
    name: "Présentations",
    description:
      "Diaporamas éditables dans l'application, joués en plein écran et exportables en PDF.",
    dependencies: [],
    entitlement: "core",
    defaultEnabled: true,
    category: "contenu",
    icon: "presentation",
    manageRole: "admin",
    toggleKey: "presentations_enabled",
    nav: [],
    editorExtensions: ["PresentationBlock"],
    slashCommands: ["Présentation"],
    // Le moteur est un artefact tiers vendorisé, pas une dépendance npm :
    // vendor/bento/ appartient donc au module au même titre que son code.
    ownedPaths: [
      "src/app/[locale]/(app)/presentations/**",
      "src/app/api/presentations/**",
      "src/components/presentations/**",
      "src/lib/presentations/**",
      "src/components/editor/extensions/presentation-block-node.ts",
      "src/components/editor/extensions/presentation-block.tsx",
      "vendor/bento/**",
    ],
  },
  {
    id: "voice-notes",
    name: "Notes vocales",
    description:
      "Bloc de dictée dans l'éditeur : transcription validée, puis synthèse ou texte remis au propre.",
    // La capture se fait dans le navigateur (MediaRecorder), sans LiveKit, mais
    // la transcription réutilise le moteur du module whisper. whisper dépend
    // lui-même de livekit : la note vocale en hérite au découpage en profils de
    // build, ce qui reste une dépendance excessive assumée pour l'instant.
    dependencies: ["whisper"],
    entitlement: "licensed",
    // Actif dès que la licence et le plan l'accordent : la dépendance whisper
    // suffit à bloquer le module quand aucun moteur de transcription n'est
    // configuré. Le toggle reste lisible pour une désactivation explicite.
    defaultEnabled: true,
    category: "ia",
    icon: "audio-lines",
    manageRole: "super_admin",
    // Le réglage utile aux notes vocales est le moteur de transcription, pas
    // la page fourre-tout des réglages IA.
    configHref: "/admin/transcription",
    toggleKey: "voice_notes_enabled",
    nav: [],
    editorExtensions: ["VoiceNoteBlock"],
    slashCommands: ["Note vocale"],
    // NB: schema-voice-notes.ts (tables Drizzle) est volontairement CONSERVÉ,
    // comme schema-video.ts : métadonnées inertes réexportées par le barrel
    // db/schema, qui doivent rester présentes pour `drizzle-kit push`.
    ownedPaths: [
      "src/app/api/voice-notes/**",
      "src/lib/voice-notes/**",
      "src/components/editor/extensions/voice-note/**",
      "src/hooks/use-audio-recorder.ts",
    ],
  },
  {
    id: "library",
    name: "Médiathèque",
    description:
      "Page unique des médias de l'organisation : dossiers, tags, filtres, corbeille et quota.",
    dependencies: [],
    entitlement: "core",
    defaultEnabled: true,
    category: "contenu",
    icon: "library-big",
    manageRole: "admin",
    configHref: "/admin/library",
    ownedPaths: [
      "src/app/[locale]/(app)/mediatheque/**",
      "src/components/media/**",
      "src/components/editor/extensions/file-block*",
      "src/components/editor/editor-file-picker.tsx",
    ],
    toggleKey: "library_enabled",
    toggleField: "enabled",
    editorExtensions: ["FileBlock"],
    slashCommands: ["Fichier"],
    nav: [{ id: "library", label: "Médiathèque", href: "/mediatheque" }],
  },
  {
    id: "crm",
    name: "CRM",
    description: "Pipeline, relances, dossiers et contacts posés sur vos bases.",
    dependencies: [],
    entitlement: "core",
    defaultEnabled: false,
    category: "contenu",
    icon: "briefcase",
    manageRole: "super_admin",
    configHref: "/admin/crm",
    ownedPaths: ["src/lib/crm/**", "src/app/api/crm/**", "src/components/crm/**", "src/app/[locale]/(app)/crm/**"],
    nav: [{ id: "crm", label: "CRM", href: "/crm" }],
  },
];

const INCLUDED = new Set<string>(INCLUDED_MODULE_IDS);

export function getModuleManifests(): ModuleManifest[] {
  return MANIFESTS.filter((m) => INCLUDED.has(m.id));
}

/**
 * Manifestes à présenter dans l'interface (écran d'administration des modules,
 * API associée) : les modules `internal` en sont exclus.
 */
export function getUiModuleManifests(): ModuleManifest[] {
  return getModuleManifests().filter((m) => !m.internal);
}

/**
 * Tous les manifestes connus du code, INDÉPENDAMMENT de la composition de
 * l'image (registry.generated). Le prune SP2 en a besoin pour connaître les
 * `ownedPaths` des modules EXCLUS : après génération du registre filtré,
 * `getModuleManifests()` ne voit plus les exclus, donc ne peut pas dériver
 * leurs chemins à supprimer. Ne PAS utiliser au runtime — réservé aux scripts.
 */
export function getAllModuleManifests(): ModuleManifest[] {
  return MANIFESTS;
}

export function getModuleManifest(id: string): ModuleManifest | undefined {
  if (!INCLUDED.has(id)) return undefined;
  return MANIFESTS.find((m) => m.id === id);
}
