"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ProposalView } from "@/lib/ai/proposals/view";
import type { ApplyBody } from "@/lib/ai/proposals/apply";

export type ProposalState =
  | "loading"
  | "pending"
  | "applying"
  | "applied"
  | "stale"
  | "failed"
  | "dismissed"
  | "expired"
  | "undone"
  | "error";

export type UseProposal = {
  proposal: ProposalView | null;
  state: ProposalState;
  /** Message d'erreur serveur de la dernière action refusée (null sinon). */
  message: string | null;
  /** Une action (ignorer, annuler, recalculer) est en cours : les boutons sont désactivés. */
  busy: boolean;
  apply(body?: ApplyBody): Promise<void>;
  dismiss(): Promise<void>;
  undo(): Promise<void>;
  recompute(): Promise<void>;
  refresh(): Promise<void>;
};

type ErrorBody = { error?: string; code?: string };

async function readError(res: Response): Promise<ErrorBody> {
  try {
    return ((await res.json()) as ErrorBody) ?? {};
  } catch {
    return {};
  }
}

/**
 * État d'une proposition : le serveur fait foi (relu par `GET ?ids=`), le fil de chat ne porte que l'identifiant.
 */
export function useProposal(proposalId: string): UseProposal {
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<null | "apply" | "other">(null);
  const [currentId, setCurrentId] = useState(proposalId);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/proposals?ids=${encodeURIComponent(currentId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { proposals: ProposalView[] };
      const found = data.proposals.find((p) => p.id === currentId) ?? null;
      if (!found) throw new Error("not_found");
      setProposal(found);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [currentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const post = useCallback(
    async (action: "apply" | "dismiss" | "undo" | "recompute", body?: unknown) => {
      const res = await fetch(`/api/ai/proposals/${encodeURIComponent(currentId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return res;
    },
    [currentId],
  );

  const undo = useCallback(async () => {
    setBusy("other");
    try {
      const res = await post("undo");
      if (res.ok) {
        toast.success("Annulé : les lignes d'origine sont restaurées");
      } else {
        const err = await readError(res);
        toast.error(err.error ?? "Impossible d'annuler");
      }
    } catch {
      toast.error("Impossible d'annuler, réessayez");
    } finally {
      await refresh();
      setBusy(null);
    }
  }, [post, refresh]);

  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  const apply = useCallback(
    async (body?: ApplyBody) => {
      setBusy("apply");
      setMessage(null);
      try {
        const res = await post("apply", body);
        if (res.ok) {
          toast.success("Proposition appliquée", {
            action: { label: "Annuler", onClick: () => void undoRef.current() },
          });
        } else {
          const err = await readError(res);
          setMessage(err.error ?? null);
          toast.error(err.error ?? "Application impossible");
        }
      } catch {
        toast.error("Application impossible, réessayez");
      } finally {
        await refresh();
        setBusy(null);
      }
    },
    [post, refresh],
  );

  const dismiss = useCallback(async () => {
    setBusy("other");
    try {
      const res = await post("dismiss");
      if (res.ok) toast.success("Proposition ignorée");
      else toast.error((await readError(res)).error ?? "Impossible d'ignorer");
    } catch {
      toast.error("Impossible d'ignorer, réessayez");
    } finally {
      await refresh();
      setBusy(null);
    }
  }, [post, refresh]);

  const recompute = useCallback(async () => {
    setBusy("other");
    setMessage(null);
    let recomputed = false;
    try {
      const res = await post("recompute");
      if (res.ok) {
        const data = (await res.json()) as { proposal: ProposalView };
        // Le recalcul crée une nouvelle proposition : on suit son identifiant, sans relire l'ancienne.
        setCurrentId(data.proposal.id);
        setProposal(data.proposal);
        setLoadError(false);
        recomputed = true;
        toast.success("Proposition recalculée sur la base actuelle");
      } else {
        const err = await readError(res);
        toast.error(err.error ?? "Recalcul impossible");
      }
    } catch {
      toast.error("Recalcul impossible, réessayez");
    } finally {
      if (!recomputed) await refresh();
      setBusy(null);
    }
  }, [post, refresh]);

  let state: ProposalState;
  if (busy === "apply") state = "applying";
  else if (proposal) state = proposal.status;
  else state = loadError ? "error" : "loading";

  return { proposal, state, message, busy: busy !== null, apply, dismiss, undo, recompute, refresh };
}
