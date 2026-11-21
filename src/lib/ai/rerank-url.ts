/**
 * Derive l'URL de base du reclassement depuis l'URL de base du fournisseur.
 *
 * Infomaniak expose le reclassement sous un chemin distinct du chemin
 * compatible OpenAI : `/2/ai/{product_id}/openai/v1` devient
 * `/2/ai/{product_id}/cohere/v2`. Toute autre URL est rendue telle quelle,
 * ce qui couvre les passerelles deja compatibles Cohere sans code dedie.
 */
export function deriveRerankBaseUrl(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (!trimmed) return null;
  if (trimmed.endsWith("/openai/v1")) {
    return trimmed.replace(/\/openai\/v1$/, "/cohere/v2");
  }
  return trimmed;
}
