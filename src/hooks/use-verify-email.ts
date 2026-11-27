"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VerifyEmailState = "loading" | "done" | "expired" | "used" | "network";

/**
 * Consumes the verification token with a POST fired from an effect, never at
 * render time: a mail scanner issuing a GET consumes nothing. A ref guard keeps
 * React strict mode from firing the POST twice.
 */
export function useVerifyEmail(token: string | null): { state: VerifyEmailState; retry: () => void } {
  const [state, setState] = useState<VerifyEmailState>(token ? "loading" : "expired");
  const started = useRef(false);

  const run = useCallback(async () => {
    if (!token) {
      setState("expired");
      return;
    }
    setState("loading");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setState("done");
        return;
      }
      if (res.status === 429) {
        setState("network");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { status?: string };
      setState(data.status === "used" ? "used" : "expired");
    } catch {
      setState("network");
    }
  }, [token]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return { state, retry: () => void run() };
}
