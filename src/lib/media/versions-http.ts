import { NextResponse } from "next/server";
import { z } from "zod";
import type { Media, MediaVersion } from "@/lib/db/schema";
import type { ReplaceResult } from "./versions";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const replaceFieldsSchema = z.object({
  expectedVersion: z.coerce.number().int().min(1),
  comment: z.string().max(2000).optional(),
});

export const restoreBodySchema = z.object({
  expectedVersion: z.number().int().min(1),
});

/** Segment `[version]` : entier strictement positif, sinon null. */
export function parseVersionParam(raw: string): number | null {
  if (!/^[1-9]\d{0,8}$/.test(raw)) return null;
  return Number(raw);
}

/** Version sans clé de stockage (jamais exposée). */
export function toVersionDto(v: MediaVersion, createdByName: string | null = null) {
  const { storageKey: _s, thumbnailKey, ...rest } = v;
  void _s;
  return { ...rest, createdByName, hasThumbnail: thumbnailKey !== null };
}

/** Média sans clés de stockage ni empreinte interne. */
export function toMediaDto(m: Media) {
  const { storageKey: _s, thumbnailKey, ...rest } = m;
  void _s;
  return {
    ...rest,
    url: `/api/media/${m.id}`,
    thumbnailUrl: thumbnailKey ? `/api/media/${m.id}/thumbnail?v=${m.currentVersion}` : null,
  };
}

/** Réponse JSON `{ media, version, quota, usages }` ou erreur relayée telle quelle. */
export function replaceResultResponse(r: ReplaceResult): NextResponse {
  if (!r.ok) {
    return NextResponse.json(
      { error: r.error, ...(r.quota ? { quota: r.quota } : {}) },
      { status: r.status },
    );
  }
  return NextResponse.json(
    {
      media: toMediaDto(r.media),
      version: toVersionDto(r.version),
      quota: r.quota,
      usages: r.usages,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
