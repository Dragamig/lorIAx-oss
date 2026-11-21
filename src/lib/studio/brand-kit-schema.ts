// Validation du Brand Kit d'organisation (couleurs, logos, polices).
import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const MEDIA_PATH_PREFIX = "/api/media/";
const MEDIA_PATH = /^\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Identifiant du média d'un logo `/api/media/<uuid>`, ou null pour toute autre forme. */
export function logoMediaId(url: string): string | null {
  return MEDIA_PATH.exec(url)?.[1]?.toLowerCase() ?? null;
}

const safeUrl = z
  .string()
  .max(2048)
  .refine(
    (u) =>
      u.startsWith(MEDIA_PATH_PREFIX)
        ? logoMediaId(u) !== null
        : (u.startsWith("/") && !u.startsWith("//")) ||
          u.startsWith("https://") ||
          u.startsWith("http://"),
    "URL de logo invalide"
  );

export const brandKitSchema = z.object({
  colors: z.array(z.string().regex(HEX_COLOR, "Couleur hexadécimale attendue")).max(12),
  logos: z.array(z.object({ url: safeUrl, name: z.string().max(100) })).max(8),
  fontHeading: z.string().max(100).nullable(),
  fontBody: z.string().max(100).nullable(),
});

export type BrandKitData = z.infer<typeof brandKitSchema>;

export const EMPTY_BRAND_KIT: BrandKitData = {
  colors: [],
  logos: [],
  fontHeading: null,
  fontBody: null,
};
