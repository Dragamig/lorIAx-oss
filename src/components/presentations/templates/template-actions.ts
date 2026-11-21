/**
 * Registre central des actions des modèles de présentation.
 *
 * Source unique d'où dérivent la galerie, l'aperçu et l'éditeur : libellé,
 * info-bulle, icône, raccourci éventuel, réservation à l'admin, clés de toast.
 * Le comportement n'est PAS ici : l'appelant l'injecte (`TemplateActionHandlers`),
 * le hook de données arrivant plus tard.
 *
 * « Retirer des modèles » et « Masquer » ont le même effet (masquage, décision
 * 6) : une seule action `hide`, deux libellés (`variant: "remove"`).
 */
import {
  BookmarkPlus,
  Check,
  ArchiveRestore,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RotateCcw,
  Copy,
  type LucideIcon,
} from "lucide-react";

export type TemplateActionId =
  | "newPresentation"
  | "use"
  | "preview"
  | "saveAsTemplate"
  | "edit"
  | "hide"
  | "restore"
  | "reset"
  | "done";

export interface TemplateActionDef {
  id: TemplateActionId;
  /** Clés sous `presentations.templates`. */
  labelKey: string;
  tipKey: string;
  icon: LucideIcon;
  /** Raccourci affiché dans l'info-bulle, si l'action en a un. */
  shortcut?: string;
  /** Réservée à l'admin d'organisation (jugé aussi côté serveur). */
  adminOnly: boolean;
  /** Un toast « Annuler » accompagne l'action. */
  reversible: boolean;
  /** Clés de toast, absentes quand l'action ne produit pas de retour propre. */
  toastSuccessKey?: string;
  toastErrorKey?: string;
  /** Second libellé de la même action. */
  variants?: Record<string, { labelKey: string; tipKey: string }>;
}

export const TEMPLATE_ACTIONS: readonly TemplateActionDef[] = [
  {
    id: "newPresentation",
    labelKey: "blank",
    tipKey: "blankTip",
    icon: Plus,
    adminOnly: false,
    reversible: false,
  },
  {
    id: "use",
    labelKey: "useTemplate",
    tipKey: "useTemplateTip",
    icon: Copy,
    adminOnly: false,
    reversible: false,
    toastSuccessKey: "toastUsed",
    toastErrorKey: "toastUseError",
  },
  {
    id: "preview",
    labelKey: "previewStrip",
    tipKey: "previewTip",
    icon: Eye,
    adminOnly: false,
    reversible: false,
  },
  {
    id: "saveAsTemplate",
    labelKey: "saveAsTemplate",
    tipKey: "saveAsTemplateTip",
    icon: BookmarkPlus,
    adminOnly: true,
    reversible: false,
    toastSuccessKey: "toastSaved",
    toastErrorKey: "toastSaveError",
  },
  {
    id: "edit",
    labelKey: "editTemplate",
    tipKey: "editTemplateTip",
    icon: Pencil,
    adminOnly: true,
    reversible: false,
    toastSuccessKey: "toastEditOpened",
  },
  {
    id: "hide",
    labelKey: "hideTemplate",
    tipKey: "hideTemplateTip",
    icon: EyeOff,
    adminOnly: true,
    reversible: true,
    toastSuccessKey: "toastHidden",
    toastErrorKey: "toastHideError",
    variants: {
      remove: { labelKey: "removeTemplate", tipKey: "removeTemplateTip" },
    },
  },
  {
    id: "restore",
    labelKey: "restoreTemplate",
    tipKey: "restoreTemplateTip",
    icon: ArchiveRestore,
    adminOnly: true,
    reversible: false,
    toastSuccessKey: "toastRestored",
    toastErrorKey: "toastRestoreError",
  },
  {
    id: "reset",
    labelKey: "resetTemplate",
    tipKey: "resetTemplateTip",
    icon: RotateCcw,
    adminOnly: true,
    reversible: false,
    toastSuccessKey: "toastReset",
    toastErrorKey: "toastResetError",
  },
  {
    id: "done",
    labelKey: "doneEditing",
    tipKey: "doneEditingTip",
    icon: Check,
    adminOnly: true,
    reversible: false,
    toastSuccessKey: "toastEditDone",
  },
];

const BY_ID = new Map(TEMPLATE_ACTIONS.map((a) => [a.id, a]));

export function getTemplateAction(id: TemplateActionId): TemplateActionDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Action de modèle inconnue : ${id}`);
  return def;
}

/** Clés de libellé et d'info-bulle, selon la variante demandée. */
export function getActionKeys(id: TemplateActionId, variant?: string) {
  const def = getTemplateAction(id);
  const v = variant ? def.variants?.[variant] : undefined;
  return { labelKey: v?.labelKey ?? def.labelKey, tipKey: v?.tipKey ?? def.tipKey };
}

/** Actions visibles pour un rôle : les actions admin disparaissent pour un membre. */
export function actionsForRole(isAdmin: boolean): TemplateActionDef[] {
  return TEMPLATE_ACTIONS.filter((a) => isAdmin || !a.adminOnly);
}

/** Comportement injecté par l'appelant, une fonction par action. */
export type TemplateActionHandlers = Partial<Record<TemplateActionId, () => void>>;
