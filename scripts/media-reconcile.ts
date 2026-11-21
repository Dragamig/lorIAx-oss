/**
 * Réconciliation manuelle des usages de médias (B54).
 * `npm run media:reconcile -- --dry-run` affiche le rapport sans rien écrire.
 */
import { reconcileMediaUsages } from "../src/lib/media/reconcile";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquant");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const r = await reconcileMediaUsages({ dryRun });
  console.log(`${dryRun ? "[dry-run] " : ""}vérifiés: ${r.checked}, retirés: ${r.removed}, explicites conservés: ${r.keptExplicit}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
