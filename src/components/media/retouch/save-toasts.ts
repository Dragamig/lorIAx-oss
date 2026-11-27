import { toast } from "sonner";
import { saveErrorKey, type SaveOutcome } from "./save-flow";

type T = (key: string, vars?: Record<string, string>) => string;

/** Toast bref pour chaque issue ; « Annuler » est proposé quand l'enregistrement est réversible. */
export function notifySaveOutcome(outcome: SaveOutcome, t: T, after?: { onUndone?: () => void }): void {
  if (outcome.kind === "error") {
    toast.error(t(`save.${saveErrorKey(outcome.status)}`));
    return;
  }
  if (outcome.kind === "duplicate") {
    toast.info(t("save.duplicateToast"));
    return;
  }
  const { undo } = outcome;
  toast.success(t(outcome.kind === "created" ? "save.createdToast" : "save.versionedToast"), {
    duration: 10_000,
    action: {
      label: t("save.undo"),
      onClick: () => {
        undo()
          .then(() => {
            toast.info(t("save.undone"));
            after?.onUndone?.();
          })
          .catch((e: unknown) => {
            const expired = e instanceof Error && e.message === "expired";
            toast.error(t(expired ? "save.undoExpired" : "save.undoFailed"));
          });
      },
    },
  });
}
