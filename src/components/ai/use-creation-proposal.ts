"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { CreationView } from "@/lib/ai/creation-view-types";
import type { CreationOverrides } from "@/lib/ai/creation/schemas";

export type CreationState =
  | "loading"
  | "pending"
  | "applying"
  | "applied"
  | "dismissed"
  | "denied"
  | "undone"
  | "failed"
  | "expired"
  | "error";

export type UseCreationProposal = {
  creation: CreationView | null;
  state: CreationState;
  /** Message serveur du dernier refus ou échec (null sinon). */
  message: string | null;
  /** Une action est en cours : tous les boutons sont désactivés. */
  busy: boolean;
  apply(overrides?: CreationOverrides): Promise<void>;
  dismiss(): Promise<void>;
  restore(): Promise<void>;
  undo(): Promise<void>;
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

/** État d'une proposition de création : le serveur fait foi, relu par `GET /api/ai/creations?ids=`. */
export function useCreationProposal(proposalId: string): UseCreationProposal {
  const t = useTranslations("chat.creation");
  const [creation, setCreation] = useState<CreationView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [refused, setRefused] = useState(false);
  const [undone, setUndone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/creations?ids=${encodeURIComponent(proposalId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { creations: CreationView[] };
      const found = data.creations.find((c) => c.id === proposalId) ?? null;
      if (!found) throw new Error("not_found");
      setCreation(found);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [proposalId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const post = useCallback(
    (action: "apply" | "dismiss" | "undo" | "restore", body?: unknown) =>
      fetch(`/api/ai/creations/${encodeURIComponent(proposalId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    [proposalId],
  );

  /** Verrou synchrone : un double clic n'envoie qu'une requête, même avant le rendu du bouton désactivé. */
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      await refresh();
      lock.current = false;
      setApplying(false);
      setBusy(false);
    }
  }, [refresh]);

  const undo = useCallback(
    () =>
      run(async () => {
        try {
          const res = await post("undo");
          if (res.ok) {
            setUndone(true);
            toast.success(t("toast.undone"));
          } else {
            toast.error((await readError(res)).error ?? t("toast.undoFailed"));
          }
        } catch {
          toast.error(t("toast.undoRetry"));
        }
      }),
    [post, run, t],
  );

  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  const apply = useCallback(
    (overrides?: CreationOverrides) =>
      run(async () => {
        setMessage(null);
        setRefused(false);
        setApplying(true);
        try {
          const res = await post("apply", overrides ? { overrides } : undefined);
          if (res.ok) {
            const data = (await res.json()) as { result?: { title?: string } };
            toast.success(t("toast.created", { title: data.result?.title ?? creation?.title ?? "" }), {
              action: { label: t("undoLabel"), onClick: () => void undoRef.current() },
            });
          } else {
            const err = await readError(res);
            setMessage(err.error ?? null);
            if (res.status === 409 && err.code === "refused") setRefused(true);
            toast.error(err.error ?? t("toast.createFailed"));
          }
        } catch {
          toast.error(t("toast.createRetry"));
        }
      }),
    [post, run, t, creation?.title],
  );

  const restore = useCallback(
    () =>
      run(async () => {
        try {
          const res = await post("restore");
          if (res.ok) toast.success(t("toast.restored"));
          else toast.error((await readError(res)).error ?? t("toast.restoreFailed"));
        } catch {
          toast.error(t("toast.restoreRetry"));
        }
      }),
    [post, run, t],
  );

  const restoreRef = useRef(restore);
  useEffect(() => {
    restoreRef.current = restore;
  }, [restore]);

  const dismiss = useCallback(
    () =>
      run(async () => {
        try {
          const res = await post("dismiss");
          if (res.ok) {
            toast.success(t("toast.dismissed"), {
              action: { label: t("undoLabel"), onClick: () => void restoreRef.current() },
            });
          } else toast.error((await readError(res)).error ?? t("toast.dismissFailed"));
        } catch {
          toast.error(t("toast.dismissRetry"));
        }
      }),
    [post, run, t],
  );

  let state: CreationState;
  if (applying) state = "applying";
  else if (creation) {
    if (creation.status === "applied" && undone) state = "undone";
    else if (creation.status === "pending" && (refused || !creation.canApply)) state = "denied";
    else if (creation.status === "applying") state = "applying";
    else state = creation.status;
  } else state = loadError ? "error" : "loading";

  return { creation, state, message, busy, apply, dismiss, restore, undo, refresh };
}
