"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ChevronUp, Clock, Eye, Loader2, RefreshCw, X } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import type { ProposalView } from "@/lib/ai/proposals/view";
import { ProposalCard } from "./proposal-card";
import { useProposal } from "./use-proposal";

const BTN =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = `${BTN} border-transparent bg-primary text-primary-foreground hover:bg-primary/90`;
const BTN_OUTLINE = `${BTN} border-border bg-background hover:bg-muted`;

function BannerItem({ initial }: { initial: ProposalView }) {
  const { proposal, state, busy, apply, dismiss, refresh } = useProposal(initial.id);
  const [expanded, setExpanded] = useState(false);
  const view = proposal ?? initial;
  // Une proposition traitée ou expirée sort du bandeau ; périmée ou en échec, elle reste avec les actions de la carte.
  if (state === "applied" || state === "dismissed" || state === "expired" || state === "undone") return null;
  const needsCard = state === "stale" || state === "failed";
  if (expanded || needsCard) {
    return (
      <li className="space-y-2 border-t border-border p-3 first:border-t-0">
        {!needsCard && (
          <div className="flex justify-end">
            <Hint label="Replier le détail">
              <button
                type="button"
                className={BTN_OUTLINE}
                aria-label="Replier le détail"
                onClick={() => {
                  setExpanded(false);
                  void refresh();
                }}
              >
                <ChevronUp className="size-4" aria-hidden="true" />
                Replier
              </button>
            </Hint>
          </div>
        )}
        <ProposalCard proposalId={initial.id} fullWidth />
      </li>
    );
  }
  const hasConflicts = view.conflictCount > 0;
  const canApply = view.canApply;
  const applying = state === "applying";
  const applyTip = !canApply ? "Droits insuffisants : le rôle éditeur est requis sur cette base" : applying ? "Application en cours" : "Appliquer cette proposition";
  const dismissTip = busy ? "Une action est déjà en cours" : "Ignorer cette proposition";
  return (
    <li className="flex h-14 items-center gap-3 border-t border-border px-3 text-sm first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{view.databaseName}</p>
        <p className="truncate text-xs text-muted-foreground">{view.summary}</p>
      </div>
      {hasConflicts ? (
        <Hint
          label={
            canApply
              ? "Vérifier les conflits de valeurs avant d'appliquer"
              : "Consulter la proposition : le droit d'édition est requis pour l'appliquer"
          }
        >
          <button
            type="button"
            className={canApply ? BTN_PRIMARY : BTN_OUTLINE}
            aria-expanded={false}
            aria-label={`${canApply ? "Voir et appliquer" : "Voir"} : ${view.summary}`}
            onClick={() => setExpanded(true)}
          >
            <Eye className="size-4" aria-hidden="true" />
            {canApply ? "Voir et appliquer" : "Voir"}
          </button>
        </Hint>
      ) : (
        <>
          <Hint label={applyTip} disabled={!canApply || busy}>
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={!canApply || busy}
              aria-label={`Appliquer : ${view.summary}`}
              onClick={() => void apply()}
            >
              {applying ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
              Appliquer
            </button>
          </Hint>
          <Hint label="Afficher le détail de la proposition">
            <button
              type="button"
              className={BTN_OUTLINE}
              aria-expanded={false}
              aria-label={`Afficher le détail : ${view.summary}`}
              onClick={() => setExpanded(true)}
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
          </Hint>
        </>
      )}
      <Hint label={dismissTip} disabled={busy}>
        <button
          type="button"
          className={BTN_OUTLINE}
          disabled={busy}
          aria-label={`Ignorer : ${view.summary}`}
          onClick={() => void dismiss()}
        >
          <X className="size-4" aria-hidden="true" />
          Ignorer
        </button>
      </Hint>
    </li>
  );
}

/** Propositions en attente, périmées ou en échec (moins de 24 h) de l'utilisateur, relues du serveur au chargement de la page. */
export function PendingProposalsBanner({ hiddenIds = [] }: { hiddenIds?: string[] }) {
  const [items, setItems] = useState<ProposalView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/ai/proposals?status=open");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { proposals: ProposalView[] };
      setItems(data.proposals ?? []);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <div role="status" className="flex items-center gap-2 border-b border-border bg-muted px-6 py-2 text-xs text-muted-foreground">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">Propositions en attente indisponibles.</span>
        <Hint label="Recharger les propositions en attente">
          <button type="button" className={BTN_OUTLINE} aria-label="Réessayer" onClick={() => void load()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Réessayer
          </button>
        </Hint>
      </div>
    );
  }
  if (items === null) {
    return (
      <div role="status" className="flex items-center gap-2 border-b border-border px-6 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Chargement des propositions en attente
      </div>
    );
  }
  // Une proposition déjà rendue en carte dans le fil n'est pas dupliquée ici.
  const shown = items.filter((p) => !hiddenIds.includes(p.id));
  if (shown.length === 0) return null;

  const Chevron = open ? ChevronDown : ChevronRight;
  const toggleTip = open ? "Réduire la liste" : "Afficher la liste";
  return (
    <section aria-label="Propositions en attente" className="border-b border-border bg-card">
      <div className="flex items-center gap-2 px-6 py-2 text-sm">
        <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1 font-medium">
          {shown.length} proposition{shown.length > 1 ? "s" : ""} en attente
        </span>
        <Hint label={toggleTip}>
          <button
            type="button"
            className={BTN_OUTLINE}
            aria-expanded={open}
            aria-label={toggleTip}
            onClick={() => setOpen((o) => !o)}
          >
            <Chevron className="size-4" aria-hidden="true" />
          </button>
        </Hint>
      </div>
      {open && (
        <ul className="mx-6 mb-2 max-h-[40vh] overflow-y-auto rounded-lg border border-border">
          {shown.map((p) => (
            <BannerItem key={p.id} initial={p} />
          ))}
        </ul>
      )}
    </section>
  );
}
