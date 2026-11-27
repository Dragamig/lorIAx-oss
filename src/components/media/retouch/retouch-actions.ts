import { LIBRARY_ACTIONS, type ActionId } from "@/lib/media/actions";
import { hotkeyOf } from "./use-hotkeys";

export type ToolId = "crop" | "rotate" | "resize" | "adjust" | "filters" | "detail" | "text" | "shapes";

/** Outils du retoucheur, dans l'ordre de la barre latérale ; chaque outil a son action au registre. */
export const RETOUCH_TOOLS: readonly { tool: ToolId; action: ActionId }[] = [
  { tool: "crop", action: "toolCrop" },
  { tool: "rotate", action: "toolRotate" },
  { tool: "resize", action: "toolResize" },
  { tool: "adjust", action: "toolAdjust" },
  { tool: "filters", action: "toolFilters" },
  { tool: "detail", action: "toolDetail" },
  { tool: "text", action: "toolText" },
  { tool: "shapes", action: "toolShapes" },
];

/** Action du registre exécutée par le retoucheur, avec sa raison de désactivation éventuelle. */
export type RetouchAction = { run: () => void; disabledReason?: string };
export type RetouchActionMap = Partial<Record<ActionId, RetouchAction>>;

/** Combinaison attendue par `hotkeyOf` : "R", "Shift+R", "Ctrl+Z" reste traité à part. */
function parseShortcut(shortcut: string): { ctrl: boolean; shift: boolean; key: string } {
  const parts = shortcut === "+" ? ["+"] : shortcut.split("+");
  const key = parts[parts.length - 1] || "+";
  return { ctrl: parts.includes("Ctrl"), shift: parts.includes("Shift"), key };
}

/**
 * Cherche l'action du registre liée à la touche pressée. Tous les raccourcis du retoucheur
 * (outils, pivot, zoom, comparaison, annuler, rétablir, enregistrer) viennent de `LIBRARY_ACTIONS`.
 */
export function actionForKey(
  e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">,
  actions: RetouchActionMap,
): ActionId | null {
  if (e.altKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  const pressed = hotkeyOf(e);
  const lower = e.key.toLowerCase();
  for (const id of Object.keys(actions) as ActionId[]) {
    const def = LIBRARY_ACTIONS[id];
    if (!def.shortcut) continue;
    // Entrée et Échap appartiennent au panneau de l'outil, Suppr à la liste des calques.
    if (["Enter", "Escape", "Delete"].includes(def.shortcut)) continue;
    const s = parseShortcut(def.shortcut);
    if (s.ctrl) {
      if (ctrl && s.key.toLowerCase() === lower && s.shift === e.shiftKey) return id;
      continue;
    }
    if (ctrl) continue;
    const want = s.shift ? `Shift+${s.key.toUpperCase()}` : s.key.length === 1 ? s.key.toUpperCase() : s.key;
    if (pressed === want) return id;
  }
  // Ctrl+Y rétablit aussi.
  if (ctrl && lower === "y" && actions.retouchRedo) return "retouchRedo";
  return null;
}

export type RetouchEntryReason = "svg" | "notImage" | "noRight";

/** Pourquoi « Retoucher » est désactivé pour ce média (null : disponible). */
export function retouchEntryReason(
  m: { kind: string; mimeType: string },
  ctx: { canWriteSpace: boolean; canWriteOriginal: boolean },
): RetouchEntryReason | null {
  if (m.kind !== "image") return "notImage";
  if (m.mimeType.toLowerCase().startsWith("image/svg")) return "svg";
  if (!ctx.canWriteSpace && !ctx.canWriteOriginal) return "noRight";
  return null;
}
