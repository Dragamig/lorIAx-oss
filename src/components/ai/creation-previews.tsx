"use client";

import { useTranslations } from "next-intl";
import type { CreationPreview } from "@/lib/ai/creation-view-types";

type Of<K extends CreationPreview["kind"]> = Extract<CreationPreview, { kind: K }>;

/** Aperçus en texte brut : React échappe tout, aucun HTML ni markdown n'est interprété. */
export function SpreadsheetPreview({ preview }: { preview: Of<"spreadsheet"> }) {
  const t = useTranslations("chat.creation");
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table aria-label={t("previewSheet")} className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-muted">
            {preview.columns.map((c, i) => (
              <th key={i} className="border-b border-border px-2 py-1 text-left font-semibold whitespace-nowrap">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, r) => (
            <tr key={r} className="border-t border-border">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={`px-2 py-1 whitespace-nowrap ${preview.columns[c]?.type === "number" ? "text-right tabular-nums" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OutlinePreview({ preview }: { preview: Of<"document"> }) {
  const t = useTranslations("chat.creation");
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={t("previewOutline")} className="m-0 list-none p-0 text-[13px]">
        {preview.outline.map((o, i) => (
          <li
            key={i}
            className={`border-l-2 border-border py-0.5 pl-3 ${o.level > 1 ? "text-muted-foreground" : ""}`}
            style={{ marginLeft: (o.level - 1) * 14 }}
          >
            {o.heading}
          </li>
        ))}
      </ul>
      {preview.body ? (
        <details className="rounded-md border border-border text-xs">
          <summary className="cursor-pointer px-2 py-1 font-semibold">{t("previewBody")}</summary>
          <pre
            tabIndex={0}
            aria-label={t("previewBody")}
            className="m-0 max-h-64 overflow-auto px-2 py-1 whitespace-pre-wrap break-words font-sans"
          >
            {preview.body}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

/** Vignettes toutes identiques : ratio 16/9 fixe, titre tronqué à deux lignes. */
export function SlidesPreview({ preview }: { preview: Of<"presentation"> }) {
  const t = useTranslations("chat.creation");
  return (
    <div role="list" aria-label={t("previewSlides")} className="grid grid-cols-4 gap-2">
      {preview.slides.map((s, i) => {
        const dark = s.layout === "cover" || s.layout === "closing";
        return (
          <div
            key={i}
            role="listitem"
            className={`relative flex aspect-video flex-col gap-1 overflow-hidden rounded-md border border-border p-2 ${
              dark ? "bg-slate-800 text-white" : "bg-white text-slate-800"
            }`}
          >
            <b className="line-clamp-2 text-[11px] leading-tight">{s.title}</b>
            <i className={`block h-[3px] rounded ${dark ? "bg-slate-600" : "bg-slate-300"}`} />
            <i className="block h-[3px] w-[30%] rounded bg-amber-500" />
            <span className={`absolute right-1.5 bottom-1 text-[9px] ${dark ? "text-slate-300" : "text-slate-500"}`}>
              {i + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}
