"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

interface ColumnPublic {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
}

interface PublicFormProps {
  token: string;
  columns: ColumnPublic[];
  successMessage: string;
  captchaSiteKey?: string;
}

declare global {
  interface Window {
    hcaptcha?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback?: (t: string) => void; "error-callback"?: () => void; "expired-callback"?: () => void }) => string;
      reset: (id?: string) => void;
      getResponse: (id?: string) => string;
    };
  }
}

export function PublicForm({ token, columns, successMessage, captchaSiteKey }: PublicFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [honey, setHoney] = useState(""); // pot de miel anti-bot
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const captchaContainerRef = useRef<HTMLDivElement>(null);
  const captchaWidgetIdRef = useRef<string | null>(null);
  const [captchaReady, setCaptchaReady] = useState(false);

  useEffect(() => {
    if (!captchaSiteKey || !captchaReady) return;
    if (!captchaContainerRef.current || captchaWidgetIdRef.current) return;
    if (!window.hcaptcha) return;
    captchaWidgetIdRef.current = window.hcaptcha.render(captchaContainerRef.current, {
      sitekey: captchaSiteKey,
      callback: (t) => setCaptchaToken(t),
      "expired-callback": () => setCaptchaToken(""),
      "error-callback": () => setCaptchaToken(""),
    });
  }, [captchaSiteKey, captchaReady]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (captchaSiteKey && !captchaToken) {
      setError("Cochez la case « Je ne suis pas un robot » avant d'envoyer.");
      setStatus("error");
      return;
    }
    setStatus("submitting");
    setError("");

    try {
      const res = await fetch(`/api/public/views/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells: values, _hp: honey, captchaToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Erreur lors de l'envoi");
      }
      setStatus("success");
      setValues({});
      if (captchaSiteKey && window.hcaptcha && captchaWidgetIdRef.current) {
        window.hcaptcha.reset(captchaWidgetIdRef.current);
        setCaptchaToken("");
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      if (captchaSiteKey && window.hcaptcha && captchaWidgetIdRef.current) {
        window.hcaptcha.reset(captchaWidgetIdRef.current);
        setCaptchaToken("");
      }
    }
  }

  if (status === "success") {
    return (
      <div className="rounded border border-green-200 bg-green-50 p-4 text-green-900">
        {successMessage}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Honey pot — invisible aux humains, rempli par les bots */}
      <div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
        <label>
          Ne pas remplir
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honey}
            onChange={(e) => setHoney(e.target.value)}
          />
        </label>
      </div>

      {columns.map((c) => (
        <FieldRenderer
          key={c.id}
          column={c}
          value={values[c.id]}
          onChange={(v) => setValues((prev) => ({ ...prev, [c.id]: v }))}
        />
      ))}

      {captchaSiteKey && (
        <>
          <Script
            src="https://js.hcaptcha.com/1/api.js?render=explicit"
            strategy="afterInteractive"
            onLoad={() => setCaptchaReady(true)}
          />
          <div ref={captchaContainerRef} />
        </>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={status === "submitting" || (!!captchaSiteKey && !captchaToken)}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {status === "submitting" ? "Envoi…" : "Envoyer"}
      </button>
    </form>
  );
}

function FieldRenderer({
  column,
  value,
  onChange,
}: {
  column: ColumnPublic;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `f-${column.id}`;
  const label = (
    <label htmlFor={id} className="mb-1 block text-sm font-medium">
      {column.name}
    </label>
  );

  if (column.type === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label htmlFor={id} className="text-sm">
          {column.name}
        </label>
      </div>
    );
  }
  if (column.type === "select") {
    const options = ((column.config.options ?? []) as string[]) || [];
    return (
      <div>
        {label}
        <select
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded border px-2 py-1.5"
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (column.type === "number") {
    return (
      <div>
        {label}
        <input
          id={id}
          type="number"
          value={(value as number | undefined) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
          className="w-full rounded border px-2 py-1.5"
        />
      </div>
    );
  }
  if (column.type === "date") {
    return (
      <div>
        {label}
        <input
          id={id}
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded border px-2 py-1.5"
        />
      </div>
    );
  }
  if (column.type === "email") {
    return (
      <div>
        {label}
        <input
          id={id}
          type="email"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded border px-2 py-1.5"
        />
      </div>
    );
  }
  if (column.type === "url") {
    return (
      <div>
        {label}
        <input
          id={id}
          type="url"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded border px-2 py-1.5"
        />
      </div>
    );
  }
  // text par défaut (text long → textarea)
  if (column.name.length > 30) {
    return (
      <div>
        {label}
        <textarea
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          rows={4}
          className="w-full rounded border px-2 py-1.5"
        />
      </div>
    );
  }
  return (
    <div>
      {label}
      <input
        id={id}
        type="text"
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded border px-2 py-1.5"
      />
    </div>
  );
}
