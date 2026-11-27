import { z } from "zod";

/** Pagination du texte extrait : paramètres de requête stricts. */
export const textQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(10_000_000).optional(),
    limit: z.coerce.number().int().min(1).max(50_000).optional(),
  })
  .strict();

export function parseTextQuery(url: string) {
  return textQuerySchema.safeParse(Object.fromEntries(new URL(url).searchParams));
}
