/**
 * Réconciliation idempotente du schéma — appelée par le service `app-migrate`
 * du docker-compose de production, AVANT le démarrage de `app`.
 *
 * Comportement (à CHAQUE déploiement, BDD vide ou existante) :
 *  1. `drizzle-kit push --force` → applique le delta entre la BDD live et
 *     `schema.ts` (source de vérité). Crée tout sur BDD vide ; ajoute les
 *     colonnes/tables manquantes sur BDD existante (ex. migrations 0019..0037
 *     hors journal Drizzle : org-scoping, api_tokens, etc.).
 *  2. `mark-migrations-applied` → enregistre les migrations du journal comme
 *     appliquées pour que le migrator embarqué dans server.ts ne tente pas de
 *     les rejouer au boot (objets déjà présents).
 *
 * Pourquoi push plutôt que migrate : le journal Drizzle s'arrête à 0018 et les
 * migrations suivantes sont des .sql idempotentes jamais câblées au déploiement.
 * push synchronise le schéma sans dépendre du journal → aucune dérive possible.
 * `--force` rend l'opération non-interactive (pas de prompt TTY sur rename).
 *
 * Limite connue : push synchronise la STRUCTURE (DDL), pas les backfills de
 * données contenus dans certaines .sql (ex. backfill organization_id de 0037).
 * Les nouvelles lignes sont scopées par le code applicatif ; les backfills de
 * lignes préexistantes restent à jouer à la main si nécessaire.
 */
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { backfillCanvasDocumentLinks } from "./backfill-canvas-document-links";
import { backfillSpreadsheetSpace } from "./backfill-spreadsheet-space";
import { ensureMediaExtensions } from "./migrate-media";
import { ensureRowHistoryTriggers } from "./migrate-row-history";
import { ensureRowCommentsAndTasks, ensureTaskKindRowValue } from "./migrate-row-comments";
import { ensureAttachmentsRetired } from "./retire-attachments";
import { ensureDefaultOrganization } from "./ensure-default-org";

async function isDatabaseEmpty(): Promise<boolean> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'"
    );
    return Number(rows[0]?.count ?? "0") === 0;
  } finally {
    await pool.end();
  }
}

/**
 * Dimensions d'embedding connues (model → dim). Doublon léger volontaire de
 * `src/lib/ai/embedding-dimensions.ts` pour garder ce script de migration
 * autonome (Pool pg dédié, pas de client Drizzle de l'app).
 */
const KNOWN_EMBEDDING_DIMENSIONS: Record<string, number> = {
  "mistral-embed": 1024,
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  "bge-m3": 1024,
  "multilingual-e5-large": 1024,
  "nomic-embed-text": 768,
};

const DEFAULT_EMBEDDING_DIMENSION = 1024;

function dimensionForModel(model: string | null | undefined): number | null {
  if (!model) return null;
  const normalized = model.trim().toLowerCase();
  const base = normalized.includes(":")
    ? normalized.slice(0, normalized.indexOf(":"))
    : normalized;
  for (const [key, dim] of Object.entries(KNOWN_EMBEDDING_DIMENSIONS)) {
    if (base === key || normalized === key || base.includes(key) || normalized.includes(key)) {
      return dim;
    }
  }
  return null;
}

/**
 * Dimension vectorielle active : `system_settings.embedding_active.dimensions`
 * (figée par la ré-indexation admin), sinon déduite du modèle ENV, sinon défaut.
 */
async function readActiveDimension(pool: Pool): Promise<number> {
  try {
    const { rows } = await pool.query<{ value: { dimensions?: number } | null }>(
      "SELECT value FROM system_settings WHERE key = 'embedding_active' LIMIT 1"
    );
    const dim = rows[0]?.value?.dimensions;
    if (typeof dim === "number" && dim > 0) return dim;
  } catch {
    // Table absente sur BDD neuve (push pas encore joué) → repli ci-dessous.
  }
  return dimensionForModel(process.env.EMBEDDING_MODEL) ?? DEFAULT_EMBEDDING_DIMENSION;
}

/**
 * Pose (idempotent) les colonnes vectorielles `embedding` de `kb_chunks` ET
 * `document_embeddings` à la dimension active. Indépendant du client Drizzle :
 * ouvre un Pool pg dédié. NB : ADD COLUMN IF NOT EXISTS ne change PAS la
 * dimension d'une colonne déjà posée — le changement de dimension passe par la
 * route admin de ré-indexation (DROP+ADD).
 */
async function ensureKbVectorColumn(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const dimension = await readActiveDimension(pool);
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector;");
    await pool.query(
      `ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS embedding vector(${dimension});`
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON kb_chunks USING hnsw (embedding vector_cosine_ops);"
    );
    await pool.query(
      `ALTER TABLE document_embeddings ADD COLUMN IF NOT EXISTS embedding vector(${dimension});`
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON document_embeddings USING hnsw (embedding vector_cosine_ops);"
    );
  } finally {
    await pool.end();
  }
}

/**
 * Ajoute (idempotent) les valeurs d'enum `ai_usage_type` qui ne sont pas
 * toujours propagées par `drizzle-kit push`. `ALTER TYPE ... ADD VALUE` ne peut
 * pas tourner dans une transaction : on l'exécute en requête simple, hors
 * transaction (Pool pg dédié, comme `ensureKbVectorColumn`).
 */
async function ensureAiUsageEnumValues(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("ALTER TYPE ai_usage_type ADD VALUE IF NOT EXISTS 'help';");
    // Notes vocales : sans ces valeurs, la resolution du prompt compare la
    // colonne d'enum a un litteral inexistant et Postgres rejette la requete,
    // ce qui ferait echouer 100 % des syntheses et des remises au propre.
    await pool.query(
      "ALTER TYPE ai_usage_type ADD VALUE IF NOT EXISTS 'voice_note_summary';"
    );
    await pool.query(
      "ALTER TYPE ai_usage_type ADD VALUE IF NOT EXISTS 'voice_note_cleanup';"
    );
    // Reclassement des recherches : meme piege que les notes vocales, sans
    // cette valeur toute requete comparant usage_type a 'rerank' est rejetee
    // par Postgres et le reclassement echoue a 100 %.
    await pool.query(
      "ALTER TYPE ai_usage_type ADD VALUE IF NOT EXISTS 'rerank';"
    );
  } finally {
    await pool.end();
  }
}

/**
 * Renommage idempotent des tables d'automatisation AVANT `drizzle-kit push`
 * (Spec 1 — unification). `schema.ts` mappe désormais `userDatabaseAutomations`
 * sur la table physique `automations`. Sur une BDD prod existante, la table
 * s'appelle encore `user_database_automations` : si on laissait `push --force`
 * réconcilier, il verrait « ancienne table absente du schéma + nouvelle table
 * absente de la BDD » et générerait un DROP + CREATE → PERTE DE DONNÉES.
 * On renomme donc en amont (préserve les lignes) ; `push` voit ensuite une table
 * déjà conforme → no-op. Guardé par `information_schema` : sur BDD fraîche (aucune
 * des deux tables) le renommage est sauté, `push` créera `automations` à neuf.
 */
async function ensureAutomationsTablesRenamed(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_database_automations')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'automations') THEN
          ALTER TABLE "user_database_automations" RENAME TO "automations";
        END IF;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_database_automation_runs')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'automation_runs') THEN
          ALTER TABLE "user_database_automation_runs" RENAME TO "automation_runs";
        END IF;
      END $$;
    `);
  } finally {
    await pool.end();
  }
}

/**
 * Ajoute (idempotent) les valeurs d'enum d'automatisation que `drizzle-kit push`
 * ne propage pas toujours (`webhook_inbound` sur le déclencheur, `automation` sur
 * le type de notification). Même idiome que `ensureAiUsageEnumValues` : plain
 * query hors transaction, APRÈS `push` (le type existe alors à coup sûr).
 */
async function ensureAutomationEnumValues(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      "ALTER TYPE database_automation_trigger ADD VALUE IF NOT EXISTS 'webhook_inbound';"
    );
    await pool.query(
      "ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'automation';"
    );
    await pool.query(
      "ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'media';"
    );
  } finally {
    await pool.end();
  }
}

/**
 * Backfill idempotent de `meeting_rooms.organization_id` (cloisonnement
 * multi-tenant). `drizzle-kit push` crée la colonne mais ne renseigne pas les
 * lignes préexistantes ; sans org, une salle devient inaccessible (fail-closed).
 * On rattache chaque salle orpheline à l'org de son créateur (plus ancienne
 * appartenance `organization_members`). Ne touche que les lignes `NULL`.
 */
async function backfillMeetingRoomOrg(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query(
      `UPDATE meeting_rooms mr
         SET organization_id = om.organization_id
        FROM (
          SELECT DISTINCT ON (user_id) user_id, organization_id
            FROM organization_members
           ORDER BY user_id, created_at ASC
        ) om
       WHERE mr.organization_id IS NULL
         AND om.user_id = mr.created_by;`
    );
    if (res.rowCount && res.rowCount > 0) {
      console.log(`✓ Backfill meeting_rooms.organization_id : ${res.rowCount} salle(s)`);
    }
  } catch (e) {
    // Tables absentes sur BDD neuve (push pas encore joué au 1er run) → no-op.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/does not exist/i.test(msg)) throw e;
  } finally {
    await pool.end();
  }
}

/** Colonnes de plafonds d'organisation devant accepter NULL (migration 0047). */
const ORG_LIMIT_COLUMNS = ["max_users", "max_spaces", "max_storage_gb"] as const;

/** true si l'erreur signale un objet absent (table ou colonne pas encore créée). */
function isMissingObjectError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /does not exist/i.test(msg);
}

/**
 * Normalisation idempotente des plafonds d'organisation (migration 0047).
 *
 * `drizzle-kit push` rend bien les colonnes NULLables mais ne convertit pas les
 * valeurs déjà écrites. Trois sentinelles ont circulé pour dire « illimité » :
 * 9999 sur `max_users` et `max_spaces`, et 1000 Go sur `max_storage_gb` pour le
 * plan Enterprise, désormais sans plafond de grille. Sans cette conversion, une
 * organisation illimitée reste bloquée à un faux plafond dans les écrans
 * d'administration. Ne touche que les lignes portant exactement ces valeurs.
 *
 * Le retrait de la contrainte de non-nullité est refait ici, avant les
 * conversions, plutôt que d'être supposé acquis. `ALTER COLUMN ... DROP NOT
 * NULL` est idempotent en PostgreSQL (aucune erreur si la colonne est déjà
 * nullable) : la reprise de données ne dépend donc plus du comportement de
 * `drizzle-kit push`. Sans ce filet, une poussée de schéma qui ne retirerait
 * pas la contrainte ferait échouer l'UPDATE et bloquerait tout le déploiement.
 */
async function normalizeOrgLimitSentinels(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const column of ORG_LIMIT_COLUMNS) {
      try {
        await pool.query(
          `ALTER TABLE organizations ALTER COLUMN ${column} DROP NOT NULL;`
        );
      } catch (e) {
        // Table ou colonne absente sur BDD neuve : rien à assouplir.
        if (!isMissingObjectError(e)) throw e;
      }
    }

    const users = await pool.query(
      "UPDATE organizations SET max_users = NULL WHERE max_users = 9999;"
    );
    const spaces = await pool.query(
      "UPDATE organizations SET max_spaces = NULL WHERE max_spaces = 9999;"
    );
    const storage = await pool.query(
      "UPDATE organizations SET max_storage_gb = NULL WHERE plan = 'enterprise' AND max_storage_gb = 1000;"
    );
    const total =
      (users.rowCount ?? 0) + (spaces.rowCount ?? 0) + (storage.rowCount ?? 0);
    if (total > 0) {
      console.log(`✓ Plafonds d'organisation normalisés en NULL : ${total} valeur(s)`);
    }
  } catch (e) {
    // Table absente sur BDD neuve (push pas encore joué au 1er run) → no-op.
    if (!isMissingObjectError(e)) throw e;
  } finally {
    await pool.end();
  }
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquant");
    process.exit(1);
  }

  const empty = await isDatabaseEmpty();
  console.log(
    empty
      ? "BDD vide — push initial du schéma Drizzle"
      : "BDD existante — réconciliation du schéma (push idempotent du delta)"
  );

  // Renommage des tables d'automatisation AVANT push (préserve les données prod).
  await ensureAutomationsTablesRenamed();

  // Index gin_trgm_ops de media : l'extension doit exister avant le push.
  await ensureMediaExtensions();

  // Retrait gardé de attachments et studio_images : AVANT le push, qui détruit sans garde toute table
  // absente de schema.ts. Une copie incomplète vers media lève une erreur et arrête le déploiement.
  await ensureAttachmentsRetired();

  // Valeur d'enum database_row AVANT le push : la contrainte tasks_database_row_ctx du schema la cite.
  await ensureTaskKindRowValue();

  run("node_modules/.bin/drizzle-kit", ["push", "--force", "--config=drizzle.config.ts"]);

  console.log("Enregistrement du journal des migrations");
  run("node_modules/.bin/tsx", ["scripts/mark-migrations-applied.ts"]);

  await ensureKbVectorColumn();
  console.log("✓ Colonnes vectorielles (KB + documents) prêtes");

  await ensureAiUsageEnumValues();
  console.log("✓ Valeurs d'enum ai_usage_type à jour");

  await ensureAutomationEnumValues();
  console.log("✓ Valeurs d'enum d'automatisation à jour (webhook_inbound, automation)");

  // Historique de ligne (lot 2) : déclencheurs de capture, la table vient du push.
  await ensureRowHistoryTriggers();

  // Commentaires et tâches de ligne (lot 3) : valeur d'enum et contrainte, tables et colonnes viennent du push.
  await ensureRowCommentsAndTasks();

  // Organisation par defaut : sans elle, l'assistant de configuration echoue sur base vide.
  {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const org = await ensureDefaultOrganization(pool);
      if (org.created) console.log("✓ Organisation par défaut créée");
    } catch (e) {
      // Etat anormal (toutes les organisations inactives) : ne pas bloquer le deploiement.
      console.warn("Organisation par défaut non créée :", e instanceof Error ? e.message : e);
    } finally {
      await pool.end();
    }
  }

  await backfillMeetingRoomOrg();

  await normalizeOrgLimitSentinels();

  // Rattachement des canevas (tableau blanc / mind map / design) à leur
  // document porteur. Les routes sont fail-closed : sans ce backfill, tout
  // canevas antérieur au contrôle d'accès deviendrait inaccessible.
  const canvasStats = await backfillCanvasDocumentLinks();
  if (canvasStats) {
    const linked =
      canvasStats.whiteboard.linked +
      canvasStats.mindmap.linked +
      canvasStats.design.linked;
    const remaining =
      canvasStats.whiteboard.after +
      canvasStats.mindmap.after +
      canvasStats.design.after;
    if (linked > 0 || remaining > 0) {
      console.log(
        `✓ Backfill canevas → document : ${linked} rattaché(s), ${remaining} orphelin(s) restant(s)`
      );
    }
  }

  // Rattachement des tableurs à l'espace de leur document porteur. La route
  // `/api/spreadsheet/[sheetId]` est fail-closed : sans ce backfill, tout
  // tableur créé avant l'envoi du `spaceId` par le client (space_id NULL)
  // deviendrait illisible et non modifiable.
  const sheetStats = await backfillSpreadsheetSpace();
  if (sheetStats && (sheetStats.linked > 0 || sheetStats.after > 0)) {
    console.log(
      `✓ Backfill tableurs → espace : ${sheetStats.linked} rattaché(s), ` +
        `${sheetStats.after} orphelin(s) restant(s)`
    );
  }

  console.log("✓ Schéma BDD réconcilié");
}

main().catch((e) => {
  console.error("Erreur init-db :", e?.message ?? e);
  process.exit(1);
});
