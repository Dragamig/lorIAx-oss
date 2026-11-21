import { createHash } from "crypto";

/**
 * Empreinte d'un transcript, stockée à côté de chaque sortie IA.
 *
 * Sert l'avertissement « le transcript a été corrigé depuis » : on compare
 * l'empreinte du transcript courant à celle qui a produit la synthèse ou la
 * mise au propre. Une correction ne détruit jamais une sortie, elle la marque
 * comme antérieure.
 *
 * Normalisation : espaces uniformisés et texte détouré, pour qu'un simple
 * reformatage d'espaces ne fasse pas passer une sortie pour périmée.
 */
export function transcriptFingerprint(transcript: string): string {
  const normalized = transcript.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Une sortie est périmée quand elle existe, qu'une empreinte a été enregistrée,
 * et que le transcript courant ne correspond plus.
 * Sans empreinte enregistrée (sortie ancienne), on ne prétend rien : false.
 */
export function isOutputStale(
  currentTranscript: string | null,
  output: string | null,
  outputHash: string | null
): boolean {
  if (!output || !outputHash) return false;
  if (!currentTranscript) return true;
  return transcriptFingerprint(currentTranscript) !== outputHash;
}
