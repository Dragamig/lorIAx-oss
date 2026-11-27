"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMailAccount } from "@/lib/mailing/account-secrets";
import type { ConnectionTestResult } from "@/lib/mailing/connection-test";
import type { MailSecurity } from "@/lib/db/schema-mailing";

export type { ClientMailAccount, ConnectionTestResult };

export interface MailAccountInput {
  address: string;
  displayName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
  /** Absent ou vide : le mot de passe enregistré est conservé. */
  password?: string | null;
  signature: string;
  cancelDelaySeconds: number;
  pollIntervalMinutes: number;
}

export type MailConnectionInput = Pick<
  MailAccountInput,
  "address" | "smtpHost" | "smtpPort" | "smtpSecurity" | "imapHost" | "imapPort" | "imapSecurity" | "password"
>;

export class MailApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

const URL_ACCOUNT = "/api/mail/account";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let code: string | undefined;
    try {
      code = ((await res.json()) as { code?: string }).code;
    } catch {
      code = undefined;
    }
    throw new MailApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export function useMailAccount() {
  const [account, setAccount] = useState<ClientMailAccount | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const alive = useRef(true);

  const apply = useCallback(
    (p: Promise<{ account: ClientMailAccount | null }>) =>
      p.then(
        (data) => {
          if (!alive.current) return;
          setAccount(data.account);
          setStatus("ready");
        },
        () => {
          if (alive.current) setStatus("error");
        },
      ),
    [],
  );

  const load = useCallback(() => {
    setStatus("loading");
    return apply(call<{ account: ClientMailAccount | null }>(URL_ACCOUNT));
  }, [apply]);

  useEffect(() => {
    alive.current = true;
    void apply(call<{ account: ClientMailAccount | null }>(URL_ACCOUNT));
    return () => {
      alive.current = false;
    };
  }, [apply]);

  const save = useCallback(async (input: MailAccountInput) => {
    const data = await call<{ account: ClientMailAccount }>(URL_ACCOUNT, {
      method: "PUT",
      body: JSON.stringify(input),
    });
    if (alive.current) setAccount(data.account);
  }, []);

  const remove = useCallback(async () => {
    await call<{ ok: true }>(URL_ACCOUNT, { method: "DELETE" });
    if (alive.current) setAccount(null);
  }, []);

  const test = useCallback(
    (input: MailConnectionInput) =>
      call<ConnectionTestResult>(`${URL_ACCOUNT}/test`, { method: "POST", body: JSON.stringify(input) }),
    [],
  );

  /** Relit le statut seul (après un test) : updatedAt reste, le formulaire en cours n'est pas réinitialisé. */
  const refreshStatus = useCallback(async () => {
    try {
      const data = await call<{ account: ClientMailAccount | null }>(URL_ACCOUNT);
      if (!alive.current || !data.account) return;
      const fresh = data.account;
      setAccount((prev) =>
        prev && prev.id === fresh.id ? { ...prev, status: fresh.status, statusMessage: fresh.statusMessage } : prev,
      );
    } catch {
      // Le statut affiché reste celui d'avant.
    }
  }, []);

  return { account, status, save, remove, test, refreshStatus, reload: load };
}
