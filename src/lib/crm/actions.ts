import {
  ArrowRight,
  Building2,
  Check,
  ChevronsUpDown,
  Database,
  ExternalLink,
  Link2,
  Power,
  RotateCw,
  ListChecks,
  Table2,
  Undo2,
  Unlink,
  X,
  type LucideIcon,
} from "lucide-react";

export interface CrmAction {
  id: string;
  /** Clé dans le namespace i18n `crm`. */
  labelKey: string;
  icon: LucideIcon;
  shortcut?: string;
  /** Clé de l'info-bulle dans le namespace i18n `crm` (obligatoire pour les actions de la modale). */
  tipKey?: string;
  /** `modal` : actions de la modale d'activation, dont le rendu arrive avec les tâches 15 et 16. */
  surface: "raccordement" | "activation" | "disabled" | "nav" | "modal";
}

export const CRM_ACTIONS: readonly CrmAction[] = [
  { id: "chooseBase", labelKey: "tile.chooseBase", icon: Database, surface: "raccordement" },
  { id: "showFields", labelKey: "tile.fields", icon: Table2, surface: "raccordement" },
  { id: "openInBases", labelKey: "tile.openInBases", icon: ExternalLink, surface: "raccordement" },
  { id: "dissociateRole", labelKey: "tile.dissociate", icon: Unlink, surface: "raccordement" },
  { id: "deactivate", labelKey: "activation.cardActive", icon: Power, surface: "raccordement" },
  { id: "retry", labelKey: "error.retry", icon: RotateCw, surface: "raccordement" },
  { id: "goToRaccordement", labelKey: "nav.raccordement", icon: ArrowRight, surface: "nav" },
  { id: "activate", labelKey: "activation.cardAction", icon: Power, surface: "disabled" },
  { id: "cancelActivation", labelKey: "activation.cancel", icon: X, surface: "activation" },
  {
    id: "activation.setMode",
    labelKey: "activation.mode.groupAria",
    tipKey: "activation.mode.groupAria",
    icon: ListChecks,
    surface: "modal",
  },
  {
    id: "activation.pickBase",
    labelKey: "tile.chooseBase",
    tipKey: "activation.tile.pickTip",
    icon: Database,
    surface: "modal",
  },
  {
    id: "activation.adopt",
    labelKey: "activation.tile.adopt",
    tipKey: "activation.tile.adoptTip",
    icon: Link2,
    surface: "modal",
  },
  {
    id: "activation.switchOrg",
    labelKey: "activation.org.label",
    tipKey: "activation.org.tip",
    icon: Building2,
    surface: "modal",
  },
  {
    id: "activation.confirm",
    labelKey: "activation.confirm",
    tipKey: "activation.confirmFullTip",
    icon: Check,
    surface: "modal",
  },
  {
    id: "activation.undo",
    labelKey: "activation.undo",
    tipKey: "activation.toast.undoTip",
    icon: Undo2,
    surface: "modal",
  },
  {
    id: "activation.toggleRecap",
    labelKey: "activation.recap.title",
    tipKey: "activation.recap.toggleTip",
    icon: ChevronsUpDown,
    surface: "modal",
  },
];

export function getCrmAction(id: string): CrmAction {
  const action = CRM_ACTIONS.find((a) => a.id === id);
  if (!action) throw new Error(`Action CRM inconnue : ${id}`);
  return action;
}
