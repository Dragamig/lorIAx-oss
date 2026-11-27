"use client";

import { useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { CrmActionButton } from "../crm-states";
import { cn } from "@/lib/utils";

export type TallyGuideScope = "full" | "form" | "hook" | "map";

const FULL = ["create", "integrations", "paste", "test", "reload", "activate"] as const;

interface Step {
  title: string;
  text: string;
}

/** Étapes d'un guide : le guide complet en 6, les aides de bloc limitées à leurs étapes. */
function useSteps(scope: TallyGuideScope): { title: string; steps: Step[] } {
  const t = useTranslations("crm.tally.guide");
  const full = (k: (typeof FULL)[number]): Step => ({ title: t(`steps.${k}.title`), text: t(`steps.${k}.text`) });
  switch (scope) {
    case "form":
      return {
        title: t("titleForm"),
        steps: [
          { title: t("formSteps.create.title"), text: t("formSteps.create.text") },
          { title: t("formSteps.url.title"), text: t("formSteps.url.text") },
        ],
      };
    case "hook":
      return { title: t("titlePaste"), steps: [full("integrations"), full("paste"), full("test")] };
    case "map":
      return { title: t("titleMap"), steps: [{ title: t("mapStep.title"), text: t("mapStep.text") }] };
    default:
      return { title: "", steps: FULL.map(full) };
  }
}

interface TallyGuideProps {
  scope: TallyGuideScope | null;
  onClose: () => void;
  /** Annonce de fin ("Aide terminée") par toast, fournie par l'appelant. */
  onDone: () => void;
}

/** Aide pas à pas : compteur, pastilles, Précédent et Suivant, flèches clavier. Une seule étape : Fermer seul. */
export function TallyGuide({ scope, onClose, onDone }: TallyGuideProps) {
  const t = useTranslations("crm.tally");
  const [index, setIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const { title: scopedTitle, steps } = useSteps(scope ?? "full");
  const title = scope === "full" || scope === null ? t("guide.titleFull") : scopedTitle;
  const n = steps.length;
  const one = n === 1;

  const go = (next: number) => {
    setIndex(next);
    queueMicrotask(() => heading.current?.focus());
  };
  const prev = () => index > 0 && go(index - 1);
  const next = () => {
    if (index < n - 1) go(index + 1);
    else {
      onClose();
      onDone();
    }
  };
  const step = steps[Math.min(index, n - 1)];

  return (
    <Dialog open={scope !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        initialFocus={heading}
        className="z-[60] gap-0 p-0 sm:max-w-[560px] max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:grid-rows-[auto_1fr_auto]"
        onKeyDown={(e) => {
          if (one) return;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            next();
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            prev();
          }
        }}
      >
        <div className="flex h-12 items-center gap-2 border-b border-border px-4">
          <HelpCircle className="size-4 shrink-0" aria-hidden="true" />
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</DialogTitle>
          {!one && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-200">
              {t("guide.counter", { current: String(index + 1), total: String(n) })}
            </span>
          )}
          <CrmActionButton
            actionId="tallyGuideClose"
            tip={t("guide.closeTip")}
            ariaLabel={t("guide.close")}
            className="min-h-8 min-w-8"
            onClick={onClose}
          />
        </div>
        <div className="min-h-40 space-y-2 p-4">
          <h3 ref={heading} tabIndex={-1} className="text-[15px] font-semibold outline-none">
            {one ? step.title : `${index + 1}. ${step.title}`}
          </h3>
          <p className="text-sm leading-relaxed">{step.text}</p>
        </div>
        <p className="sr-only" aria-live="polite">
          {one ? step.title : t("guide.announce", { current: String(index + 1), total: String(n), title: step.title })}
        </p>
        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 p-3">
          {!one ? (
            <div role="group" aria-label={t("guide.dots")} className="flex items-center">
              {steps.map((s, k) => (
                <Tip key={k} label={`${k + 1}. ${s.title}`}>
                  <button
                    type="button"
                    aria-label={t("guide.dot", { n: String(k + 1), title: s.title })}
                    aria-current={k === index ? "step" : undefined}
                    onClick={() => go(k)}
                    className="group flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <i className={cn("block size-2 rounded-full not-italic", k === index ? "bg-blue-600 dark:bg-blue-400" : "bg-muted-foreground/40 group-hover:bg-muted-foreground")} />
                  </button>
                </Tip>
              ))}
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {one ? (
              <CrmActionButton actionId="tallyGuideClose" label={t("guide.close")} tip={t("guide.closeTip")} ariaLabel={t("guide.close")} className="min-h-8 bg-primary text-primary-foreground hover:bg-primary/90" onClick={onClose} />
            ) : (
              <>
                <CrmActionButton
                  actionId="tallyGuidePrev"
                  label={t("guide.prev")}
                  tip={t("guide.prevTip")}
                  ariaLabel={t("guide.prev")}
                  className="min-h-8"
                  disabledReason={index === 0 ? t("guide.prevFirst") : undefined}
                  onClick={prev}
                />
                <CrmActionButton
                  actionId="tallyGuideNext"
                  label={index === n - 1 ? t("guide.finish") : t("guide.next")}
                  tip={index === n - 1 ? t("guide.finishTip") : t("guide.nextTip")}
                  ariaLabel={index === n - 1 ? t("guide.finish") : t("guide.next")}
                  className="min-h-8 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={next}
                />
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
