/**
 * Indexation de la base de connaissances (assistant d'aide) depuis le disque.
 *
 * Lit les fichiers Markdown de `docs/kb/`, génère les embeddings (provider KB)
 * et upsert les chunks dans `kb_chunks` (indexation incrémentale par hash).
 *
 * Code de sortie : 0 uniquement si aucun fragment n'a échoué. Une exécution
 * qui n'indexe rien parce que rien n'a changé reste un succès ; une exécution
 * où des fragments ont échoué est une ERREUR, même partielle, sinon un job
 * planifié rapporterait un succès en laissant la base périmée.
 */
import {
  ensureKbSchema,
  formatKbSummary,
  indexKbFromDisk,
  kbIndexVerdict,
} from "../src/lib/kb/kb";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquant");
    process.exit(1);
  }

  await ensureKbSchema();
  const summary = await indexKbFromDisk();
  const verdict = kbIndexVerdict(summary);

  if (!verdict.ok) {
    console.error(`✗ Indexation KB en échec : ${verdict.reason}`);
    console.error(`  ${formatKbSummary(summary)}`);
    process.exit(1);
  }

  console.log(`✓ Indexation KB terminée (${verdict.reason})`);
  console.log(`  ${formatKbSummary(summary)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Erreur kb-index :", e?.message ?? e);
  process.exit(1);
});
