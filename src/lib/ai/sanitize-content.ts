/**
 * Neutralise les marqueurs de contrôle dans le contenu RAG
 * pour empêcher les injections de prompt via des documents craftés.
 */
export function sanitizeRagContent(text: string, maxLength = 2000): string {
  return text
    .replace(/\b(system|user|assistant|human)\s*:/gi, (match) =>
      match.replace(/:/g, "：")
    )
    .replace(/<\/?(?:system|instruction|prompt|role|tool|function)[^>]*>/gi, "")
    .replace(/```(?:system|instruction|prompt)/gi, "```text")
    .slice(0, maxLength);
}
