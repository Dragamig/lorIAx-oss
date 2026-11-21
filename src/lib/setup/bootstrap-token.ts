// src/lib/setup/bootstrap-token.ts
import { NextResponse } from "next/server";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import logger from "@/lib/logger";
import {
  authIdentityBucket,
  checkRateLimitAsync,
  getClientIpOrNull,
  ipKeyPart,
} from "@/lib/rate-limit";
import {
  SETUP_TOKEN_COOKIE,
  SETUP_TOKEN_HEADER,
  SETUP_TOKEN_KEY,
} from "@/lib/setup/constants";

/**
 * Jeton d'amorçage de l'assistant d'installation (constat AZ-28, audit du
 * 2026-08-19).
 *
 * Avant correctif, les routes `/api/setup/*` n'étaient gardées que par le
 * booléen `setup_completed`. Entre le premier démarrage d'une instance et la
 * fin de l'assistant, n'importe qui sur le réseau pouvait appeler
 * `POST /api/setup/users` pour se fabriquer un `super_admin`, ou
 * `POST /api/setup/purge` pour détruire toutes les données.
 *
 * CONTRAT D'ENVIRONNEMENT : la variable `SETUP_BOOTSTRAP_TOKEN` est
 * FACULTATIVE et son absence ne bloque JAMAIS une installation légitime.
 * Une variable se juge contre le code DÉPLOYÉ, pas contre celui de la branche :
 * exiger une variable qu'une instance existante n'a pas posée reviendrait à
 * casser cette instance au moment du déploiement. Donc :
 *  - variable posée   → c'est elle qui fait foi ;
 *  - variable absente → un jeton aléatoire est engendré au premier appel,
 *    persisté en base (`system_settings.setup_bootstrap_token`) et écrit en
 *    clair dans les journaux du conteneur, pour que l'exploitant le lise.
 *
 * La persistance en base garantit la stabilité du jeton entre redémarrages ET
 * entre répliques : deux répliques qui engendrent un jeton en même temps
 * s'écrasent l'une l'autre sans dommage grâce au `onConflictDoNothing` suivi
 * d'une relecture, la gagnante imposant sa valeur, et les deux journaux
 * affichent la même.
 */

export {
  SETUP_TOKEN_KEY,
  SETUP_TOKEN_HEADER,
  SETUP_TOKEN_COOKIE,
  SETUP_COOKIE_MAX_AGE,
} from "@/lib/setup/constants";

/**
 * Débit autorisé sur `/api/setup/*`. Large pour un parcours légitime (une
 * dizaine d'appels, plus les téléversements), dérisoire face à une énumération
 * de jeton de 256 bits. Défini ici et non dans `RATE_LIMITS` :
 * `src/lib/rate-limit.ts` est hors du périmètre de ce lot.
 */
const SETUP_RATE_LIMIT = { maxRequests: 60, windowMs: 5 * 60 * 1000 };

/**
 * Dimension de la clé de quota (constat AZ-25).
 *
 * `getClientIp` rend la CONSTANTE `UNKNOWN_CLIENT_IP` quand aucune adresse
 * n'est déterminable, ce qui est le cas courant d'une instance auto-hébergée
 * sans proxy qui positionne `x-forwarded-for`. L'indexer comme une adresse
 * mettrait TOUT le trafic d'installation dans un seul seau de 60 requêtes par
 * 5 minutes : n'importe quel tiers pourrait alors le saturer et empêcher
 * l'exploitant d'installer son instance. On traite donc l'absence d'adresse
 * comme une absence, via `getClientIpOrNull`, et on retombe sur une autre
 * dimension :
 *  - adresse connue    → un seau par adresse, comportement historique ;
 *  - adresse inconnue mais jeton présenté → un seau par jeton, indexé sur son
 *    condensé. Un tiers ne peut pas saturer le seau de l'exploitant sans
 *    connaître son jeton, et la protection contre l'énumération reste portée
 *    par les 256 bits d'entropie, pas par le quota ;
 *  - ni adresse ni jeton → un seau commun explicitement distinct. Le saturer
 *    ne ferme la porte qu'à des appels qui étaient de toute façon refusés.
 */
function rateLimitKey(request: Request, presented: string | null): string {
  const ip = getClientIpOrNull(request);
  if (ip) return `setup:${ipKeyPart(ip)}`;
  if (presented) return `setup:noip:${authIdentityBucket(presented)}`;
  return `setup:${ipKeyPart(null)}`;
}

interface StoredToken {
  token: string;
  consumedAt: string | null;
}

interface TokenState {
  /** Jeton attendu, ou null si la base n'a rien et qu'on n'a pas pu engendrer. */
  expected: string | null;
  /** Vrai si l'assistant a déjà consommé le jeton (usage unique). */
  consumed: boolean;
  /** D'où vient le jeton attendu. */
  source: "env" | "db";
}

/** Valeur non vide de la variable d'environnement, sinon null. */
function envToken(): string | null {
  const raw = process.env.SETUP_BOOTSTRAP_TOKEN;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStored(value: unknown): StoredToken | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.token !== "string" || v.token.length === 0) return null;
  return {
    token: v.token,
    consumedAt: typeof v.consumedAt === "string" ? v.consumedAt : null,
  };
}

async function readStored(): Promise<StoredToken | null> {
  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, SETUP_TOKEN_KEY))
    .limit(1);
  return row ? parseStored(row.value) : null;
}

/** Lecture tolérante : une base indisponible ne doit pas masquer le jeton d'env. */
async function readStoredSafe(): Promise<StoredToken | null> {
  try {
    return await readStored();
  } catch {
    return null;
  }
}

function logBanner(token: string) {
  const line = "=".repeat(72);
  logger.warn(
    { setupBootstrapToken: token },
    [
      "",
      line,
      "  LorIAx : ASSISTANT D'INSTALLATION VERROUILLÉ",
      "",
      "  Aucune variable SETUP_BOOTSTRAP_TOKEN n'est posée : un jeton",
      "  d'amorçage a été engendré pour cette instance. Saisissez-le dans",
      "  l'écran d'ouverture de l'assistant (/setup) pour déverrouiller la",
      "  configuration initiale. Il est à usage unique et cesse d'être",
      "  accepté dès que l'assistant est terminé.",
      "",
      `  Jeton : ${token}`,
      line,
      "",
    ].join("\n")
  );
}

/**
 * Vrai si l'assistant d'installation a déjà été mené à son terme.
 *
 * Lecture faite ICI, et non via `@/lib/setup/guards`, pour ne pas créer de
 * cycle d'import : `guards` dépend de ce module.
 */
async function isSetupCompleted(): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, "setup_completed"))
      .limit(1);
    return row?.value === true;
  } catch {
    // Base illisible : on ne conclut pas « installation terminée ». L'appelant
    // reste protégé par l'échec de la résolution du jeton juste après.
    return false;
  }
}

/**
 * Rend le jeton attendu, en l'engendrant et en le journalisant au besoin.
 * Lève si la base est indisponible ET qu'aucune variable d'environnement n'est
 * posée (on refuse alors l'accès plutôt que de laisser passer).
 */
export async function getBootstrapTokenState(): Promise<TokenState> {
  const fromEnv = envToken();

  if (fromEnv) {
    const stored = await readStoredSafe();
    return { expected: fromEnv, consumed: stored?.consumedAt != null, source: "env" };
  }

  const stored = await readStored();
  if (stored) {
    return { expected: stored.token, consumed: stored.consumedAt != null, source: "db" };
  }

  // GÉNÉRATION PARESSEUSE (effet de bord du constat AZ-28).
  //
  // La garde juge le jeton AVANT l'état de l'installation, pour qu'un appelant
  // anonyme n'apprenne rien de l'instance. L'effet de bord n'avait pas été vu :
  // sur une instance DÉJÀ INSTALLÉE, chaque sollicitation anonyme engendrait
  // une ligne en base et journalisait la bannière d'avertissement. On ne
  // fabrique donc un jeton que si l'assistant peut encore servir.
  //
  // La propriété de non-divulgation est préservée : l'état rendu ici n'a pas
  // de jeton attendu, la garde répond exactement le même 401 générique que
  // pour un jeton faux, sans rien écrire ni journaliser.
  if (await isSetupCompleted()) {
    return { expected: null, consumed: false, source: "db" };
  }

  // Premier démarrage sans variable : on engendre, on persiste, on journalise.
  const generated = randomBytes(32).toString("base64url");
  const now = new Date();
  await db
    .insert(systemSettings)
    .values({
      key: SETUP_TOKEN_KEY,
      value: { token: generated, consumedAt: null },
      updatedAt: now,
    })
    .onConflictDoNothing({ target: systemSettings.key });

  // Relecture : en cas de course entre répliques, c'est la gagnante qui fait foi.
  const effective = (await readStored()) ?? { token: generated, consumedAt: null };
  logBanner(effective.token);
  return { expected: effective.token, consumed: effective.consumedAt != null, source: "db" };
}

/**
 * Marque le jeton comme consommé. Appelé à la toute fin de l'assistant, en
 * même temps que `setup_completed`, et JAMAIS en cours de parcours : un échec
 * au milieu du wizard ne doit pas condamner définitivement l'installation.
 */
export async function consumeBootstrapToken(): Promise<void> {
  const now = new Date();
  const stored = await readStoredSafe();

  // FAIL-CLOSED. `readStoredSafe` avale les erreurs de lecture : quand la
  // relecture échoue ET qu'aucune variable n'est posée, on ne connaît plus le
  // jeton à marquer. Écrire une chaîne vide serait le pire choix possible :
  // `parseStored` rejette un jeton vide, l'état repart donc de zéro, un jeton
  // NEUF est engendré et journalisé, et l'assistant d'installation ROUVRE sur
  // une instance pourtant configurée. On écrit à la place une valeur aléatoire
  // que personne ne peut présenter, portant `consumedAt` : la ligne reste
  // analysable, l'état reste « consommé », la porte reste fermée.
  const token = stored?.token ?? envToken() ?? randomBytes(32).toString("base64url");
  const value = { token, consumedAt: now.toISOString() };
  await db
    .insert(systemSettings)
    .values({ key: SETUP_TOKEN_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: now } });
}

/**
 * Comparaison en temps constant (constat AZ-40 : ne pas comparer un secret
 * partagé par simple inégalité). Le condensé préalable égalise les longueurs,
 * `timingSafeEqual` exigeant deux tampons de même taille.
 */
export function safeEqualToken(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Jeton présenté par l'appelant : en-tête dédié, sinon cookie d'amorçage. */
export function presentedToken(request: Request): string | null {
  const header = request.headers.get(SETUP_TOKEN_HEADER);
  if (header && header.trim().length > 0) return header.trim();

  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name.trim() === SETUP_TOKEN_COOKIE) {
      const value = decodeURIComponent(rest.join("=").trim());
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

const REFUS = { error: "Jeton d'amorçage invalide ou absent" } as const;

/**
 * Garde d'authentification des routes de l'assistant. Rend une NextResponse
 * d'échec, ou null si l'appelant est autorisé.
 *
 * Un jeton absent et un jeton faux reçoivent exactement la même réponse.
 */
export async function requireBootstrapToken(
  request: Request,
  options: { rateLimit?: boolean; candidate?: string } = {}
): Promise<NextResponse | null> {
  // `candidate` fourni : c'est LUI qui est jugé, sans repli sur le cookie.
  // Sinon on prend le jeton porté par la requête (en-tête, puis cookie).
  const presented =
    "candidate" in options
      ? (options.candidate ?? "").trim() || null
      : presentedToken(request);

  if (options.rateLimit !== false) {
    const limit = await checkRateLimitAsync(
      rateLimitKey(request, presented),
      SETUP_RATE_LIMIT
    );
    if (!limit.success) {
      return NextResponse.json(
        { error: "Trop de tentatives, réessayez plus tard" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } }
      );
    }
  }

  let state: TokenState;
  try {
    state = await getBootstrapTokenState();
  } catch (err) {
    logger.error({ err }, "[setup] Impossible de résoudre le jeton d'amorçage");
    return NextResponse.json(
      { error: "Configuration indisponible" },
      { status: 503 }
    );
  }

  if (state.consumed) {
    return NextResponse.json(
      { error: "Le jeton d'amorçage a déjà été consommé" },
      { status: 403 }
    );
  }

  if (!presented || !state.expected || !safeEqualToken(presented, state.expected)) {
    return NextResponse.json(REFUS, { status: 401 });
  }

  return null;
}
